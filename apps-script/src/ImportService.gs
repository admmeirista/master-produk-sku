/**
 * Import data lama dari template Excel "Template_Master_Produk_SKU_BeeCloud" (dibaca di browser dengan SheetJS,
 * baris dikirim ke server sebagai teks). Alur: Pratinjau (dry-run, tanpa menulis) → Import (di dalam lock, atomik).
 *
 * Prinsip kompatibilitas:
 *  - Kode brand/kategori lama dipakai bila belum ada; bila nama sudah terdaftar dengan kode lain, kode aplikasi TIDAK
 *    diubah (dilaporkan untuk diputuskan manual).
 *  - 1 barcode fisik = 1 varian. Baris template dengan GTIN yang sama (mis. VAM100 & AIM100) TIDAK membuat produk ganda —
 *    SKU lamanya dicatat sebagai legacy SKU pada varian yang sama.
 *  - Baris "Isi" 1 → varian (SKU internal baru SKU000xxx); Isi > 1 → satuan kemasan PACKn (tanpa SKU baru).
 *    Semua SKU lama tersimpan di EXTERNAL_SKU_MAPPINGS (system "legacy") → tetap bisa ditelusuri & dipindai.
 *  - Barcode yang bukan GTIN valid TIDAK disimpan sebagai GTIN (dilaporkan). Prefix 2xx valid → barcode internal.
 *  - Idempoten: SKU lama yang sudah tercatat dilewati; import ulang tidak menggandakan produk.
 */

const IMPORT_TYPES = {
  reference: {
    label: 'Referensi Brand & Kategori',
    sheet: /referensi/i,
    fields: {
      brandName: ['nama brand', 'brand'],
      brandCode: ['kode brand'],
      categoryName: ['nama kategori', 'kategori'],
      categoryCode: ['kode kategori'],
    },
    required: [],
  },
  internal_barcodes: {
    label: 'Barcode Internal Terpakai',
    sheet: /generator/i,
    fields: {
      barcode: ['barcode internal (ean-13)', 'barcode internal', 'barcode'],
      status: ['status'],
      productName: ['nama produk yang menggunakan', 'nama produk'],
    },
    required: ['barcode'],
  },
  master: {
    label: 'Master Produk (template lama)',
    sheet: /master produk/i,
    fields: {
      brand: ['nama brand', 'brand'],
      brandCode: ['kode brand'],
      category: ['nama kategori', 'kategori'],
      categoryCode: ['kode kategori'],
      productCode: ['kode produk'],
      barcode: ['gtin/barcode', 'gtin', 'barcode'],
      qty: ['isi', 'qty', 'isi kemasan'],
      sku: ['sku (otomatis)', 'sku'],
      name: ['nama produk master', 'nama produk'],
      unit: ['satuan'],
    },
    required: ['brand', 'category', 'barcode', 'qty', 'name'],
  },
  channel_listing: {
    label: 'Listing marketplace (Shopee / TikTok / Tokopedia)',
    sheet: /performa|shopee|listing|tiktok|tokopedia/i,
    // ekspor Shopee: kolom "Kode Variasi" muncul dua kali — pertama = ID variasi, kedua = SKU variasi (seller SKU)
    fields: {
      productId: ['kode produk', 'product id', 'id produk', 'item id', 'id listing'],
      productName: ['produk', 'nama produk', 'product name', 'nama listing'],
      variationId: ['kode variasi', 'variation id', 'id variasi', 'model id', 'sku id'],
      variationName: ['nama variasi', 'variation name'],
      variationSku: ['kode variasi', 'sku variasi', 'seller sku', 'variation sku', 'sku penjual', 'sku'],
      parentSku: ['sku induk', 'parent sku'],
    },
    required: ['productId'],
  },
  supplier_mapping: {
    label: 'Kode produk supplier',
    sheet: /supplier/i,
    fields: {
      supplier: ['nama supplier', 'supplier'],
      supplierProductCode: ['kode produk supplier', 'kode barang supplier', 'kode supplier', 'supplier sku', 'supplier code'],
      supplierProductName: ['nama di supplier', 'nama produk supplier', 'nama barang supplier'],
      internal: ['child sku', 'sku internal', 'sku', 'gtin', 'barcode'],
      purchaseUnit: ['satuan beli', 'satuan'],
      factor: ['isi (satuan stok)', 'isi', 'faktor konversi', 'konversi'],
      moq: ['moq', 'minimum order', 'minimum order quantity'],
    },
    required: ['supplier', 'supplierProductCode', 'internal'],
  },
};

const nrm_ = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Deteksi baris header (20 baris pertama) & kolom tiap field berdasarkan alias. */
function importMap_(def, rows) {
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map(nrm_);
    const score = Object.keys(def.fields).filter((k) => def.fields[k].some((a) => cells.indexOf(a) >= 0)).length;
    if (score > best.score) best = { idx: i, score };
  }
  if (best.idx < 0) throw new AppError('Header kolom tidak dikenali. Pastikan sheet yang dipilih sesuai jenis import.');
  const head = (rows[best.idx] || []).map(nrm_);
  const map = {};
  const used = {};
  Object.keys(def.fields).forEach((k) => {
    map[k] = -1;
    for (const a of def.fields[k]) {
      const i = head.findIndex((h, j) => !used[j] && h === a);
      if (i >= 0) {
        map[k] = i;
        used[i] = 1;
        break;
      }
    }
  });
  const missing = def.required.filter((k) => map[k] < 0);
  if (missing.length) throw new AppError('Kolom wajib tidak ditemukan: ' + missing.map((k) => def.fields[k][0]).join(', '));
  return { headerIndex: best.idx, map };
}

function importRun_(user, p, opts) {
  opts = opts || {};
  const def = IMPORT_TYPES[p.type];
  if (!def) throw new AppError('Jenis import tidak dikenal');
  const rows = (p.rows || []).map((r) => (r || []).map((c) => (c === null || c === undefined ? '' : String(c))));
  if (rows.length > 5000) throw new AppError('Maksimal 5.000 baris per import');
  const m = importMap_(def, rows);
  const work = [];
  rows.forEach((raw, i) => {
    if (i <= m.headerIndex || !raw.some((c) => String(c).trim())) return;
    const v = {};
    Object.keys(m.map).forEach((k) => (v[k] = m.map[k] >= 0 ? cleanText(raw[m.map[k]]) : ''));
    work.push({ row: i + 1, v });
  });
  const rep = { type: p.type, label: def.label, fileName: cleanText(p.fileName), totalRows: work.length, created: { brands: 0, categories: 0, products: 0, variants: 0, conversions: 0, bundles: 0, legacySkus: 0, barcodes: 0, mappings: 0, suppliers: 0 }, skipped: 0, errors: [], warnings: [], dryRun: !!opts.dryRun };
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, p.type + JSON.stringify(rows), Utilities.Charset.UTF_8));
  if (p.type === 'reference') importReference_(user, work, rep);
  else if (p.type === 'internal_barcodes') importInternalBarcodes_(user, work, rep);
  else if (p.type === 'channel_listing') importChannelListing_(user, work, rep, p);
  else if (p.type === 'supplier_mapping') importSupplierMapping_(user, work, rep);
  else importMaster_(user, work, rep);
  const cap = (a) => a.slice(0, 300);
  rep.errorCount = rep.errors.length;
  rep.warningCount = rep.warnings.length;
  const allIssues = rep.errors.map((e) => Object.assign({ severity: 'ERROR' }, e)).concat(rep.warnings.map((e) => Object.assign({ severity: 'WARNING' }, e)));
  rep.errors = cap(rep.errors);
  rep.warnings = cap(rep.warnings);
  if (!opts.dryRun) {
    const createdRows = Object.keys(rep.created).reduce((s, k) => s + rep.created[k], 0);
    const batchId = uuid_();
    rep.batchId = batchId;
    db_('IMPORT_BATCHES').insert({ BatchID: batchId, ImportType: p.type, FileName: rep.fileName, ContentHash: hash, Status: 'COMMITTED', TotalRows: rep.totalRows, CreatedRows: createdRows, SkippedRows: rep.skipped, ErrorRows: rep.errorCount, ReportJson: rep, CreatedBy: user.email, CreatedAt: now_() });
    // seluruh baris bermasalah (tanpa batas 300) untuk dicek manual / diunduh
    allIssues.slice(0, 5000).forEach((e) => db_('IMPORT_ERRORS').insert({ ErrorID: uuid_(), BatchID: batchId, RowNumber: e.row, Severity: e.severity, Message: e.message, CreatedAt: now_() }));
    audit_(user.email, 'import.' + p.type, 'import', '', null, { file: rep.fileName, created: rep.created, skipped: rep.skipped, errors: rep.errorCount });
  }
  return rep;
}

function importHistory_() {
  return db_('IMPORT_BATCHES')
    .rows()
    .slice()
    .reverse()
    .slice(0, 50)
    .map((b) => ({ id: b.BatchID, type: b.ImportType, label: (IMPORT_TYPES[b.ImportType] || {}).label, fileName: b.FileName, totalRows: b.TotalRows, createdRows: b.CreatedRows, skippedRows: b.SkippedRows, errorRows: b.ErrorRows, createdBy: b.CreatedBy, createdAt: b.CreatedAt, report: b.ReportJson }));
}

// ------------------------------------------------------------------ referensi brand / kategori

/** Cari/buat brand atau kategori dengan kode lama. Mengembalikan record (atau null bila nama kosong). */
function importMaster__ref_(user, kind, name, legacyCode, row, rep, cache) {
  const k = MASTER_KIND[kind];
  const n = cleanText(name);
  if (!n) return null;
  const key = masterNameKey(n);
  if (cache[key]) return cache[key];
  const T = db_(k.table);
  let rec = T.find((r) => r.NameKey === key && r.Status !== STATUS.DELETED);
  const code = normalizeCode(legacyCode);
  if (rec) {
    if (code && String(rec[k.code]).toUpperCase() !== code)
      rep.warnings.push({ row, message: `${k.label} "${rec[k.name]}" sudah terdaftar dengan kode ${rec[k.code]}; kode lama ${code} tidak diterapkan otomatis (SKU lama tetap tercatat).` });
    cache[key] = rec;
    return rec;
  }
  const used = masterUsedCodes_(k);
  let finalCode = code;
  if (!/^[A-Z0-9]{2,6}$/.test(code) || used[code]) {
    finalCode = generateMasterCode(n, (c) => !!used[c], getSettings_().master_code_length);
    if (code) rep.warnings.push({ row, message: `${k.label} "${n}": kode lama ${code} sudah dipakai/tidak valid → kode baru ${finalCode}` });
  }
  rec = T.insert({ [k.id]: uuid_(), [k.code]: finalCode, [k.name]: n, NameKey: key, Status: STATUS.ACTIVE, CreatedBy: user.email, CreatedAt: now_(), UpdatedBy: user.email, UpdatedAt: now_() });
  rep.created[kind === 'brand' ? 'brands' : 'categories']++;
  cache[key] = rec;
  return rec;
}

function importReference_(user, work, rep) {
  const bc = {};
  const cc = {};
  work.forEach((w) => {
    const before = rep.created.brands + rep.created.categories;
    if (w.v.brandName) importMaster__ref_(user, 'brand', w.v.brandName, w.v.brandCode, w.row, rep, bc);
    if (w.v.categoryName) importMaster__ref_(user, 'category', w.v.categoryName, w.v.categoryCode, w.row, rep, cc);
    if (rep.created.brands + rep.created.categories === before) rep.skipped++;
  });
}

// ------------------------------------------------------------------ barcode internal terpakai

function importInternalBarcodes_(user, work, rep) {
  work.forEach((w) => {
    const code = cleanBarcode(w.v.barcode);
    if (!/terpakai|dipakai|used/i.test(w.v.status)) return rep.skipped++;
    const g = validateGtin(code);
    if (!g.ok || code[0] !== '2') return rep.errors.push({ row: w.row, message: `Barcode ${code}: bukan barcode internal valid (${g.ok ? 'tidak berawalan 2' : g.message})` });
    if (db_('VARIANT_BARCODES').find((b) => b.Code === code)) return rep.skipped++;
    db_('VARIANT_BARCODES').insert({ BarcodeID: uuid_(), Code: code, BarcodeType: 'INTERNAL', Symbology: 'EAN13', Status: 'ALLOCATED', VerifiedOfficial: false, Notes: 'Import template lama: ' + cleanText(w.v.productName), CreatedBy: user.email, CreatedAt: now_() });
    rep.created.barcodes++;
  });
}

// ------------------------------------------------------------------ master produk template lama

function importMaster_(user, work, rep) {
  const S = getSettings_();
  const bc = {};
  const cc = {};
  const skuOwner = skuOwnerMap_();
  const legacy = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.System === 'legacy')
    .forEach((m) => (legacy[String(m.ExternalSku).toUpperCase()] = 1));
  const liveBc = {};
  db_('VARIANT_BARCODES')
    .filter((b) => b.Status === 'ACTIVE')
    .forEach((b) => (liveBc[b.Code] = b));
  const variantOfRaw = {}; // barcode mentah (termasuk yang tidak valid) → VariantID (dalam import ini)
  const codeOfRaw = {}; // barcode → kode produk lama pertama (untuk peringatan identitas ganda)
  const productOf = {}; // brandId|kodeLama → product (dalam import ini)
  const convOf = {}; // VariantID|isi → ConversionID
  const ts = now_();
  const baseUnits = (S.base_units || []).slice();
  let unitsChanged = false;

  // baris Isi 1 diproses lebih dulu agar nama varian/produk diambil dari baris satuan
  const ordered = work.slice().sort((a, b) => (Number(a.v.qty) === 1 ? 0 : 1) - (Number(b.v.qty) === 1 ? 0 : 1) || a.row - b.row);
  ordered.forEach((w) => {
    const v = w.v;
    const missing = ['brand', 'category', 'barcode', 'qty', 'name'].filter((k) => !v[k]);
    if (missing.length) return rep.errors.push({ row: w.row, message: 'Data tidak lengkap: ' + missing.map((k) => IMPORT_TYPES.master.fields[k][0]).join(', ') });
    const qty = Number(String(v.qty).replace(',', '.'));
    if (!(Number.isInteger(qty) && qty >= 1 && qty <= 100000)) return rep.errors.push({ row: w.row, message: `Isi "${v.qty}" tidak valid` });
    const sku = String(v.sku || '').trim().toUpperCase();
    if (sku && legacy[sku]) return rep.skipped++;
    const raw = cleanBarcode(v.barcode);
    const gtin = validateManufacturerGtin(raw);
    const any = validateGtin(raw);
    const bcType = gtin.ok ? 'GTIN' : any.ok && raw[0] === '2' ? 'INTERNAL' : '';
    if (!bcType) rep.warnings.push({ row: w.row, message: `Barcode ${raw} bukan GTIN valid (${gtin.message}) — tidak disimpan sebagai barcode; SKU lama tetap tercatat` });

    // ---- varian: barcode yang sudah terdaftar → pakai varian yang ada (tidak membuat produk duplikat)
    let variantId = variantOfRaw[raw];
    const legacyCode0 = normalizeCode(v.productCode);
    if (variantId && legacyCode0 && codeOfRaw[raw] && codeOfRaw[raw] !== legacyCode0 && !codeOfRaw[raw + '|' + legacyCode0]) {
      codeOfRaw[raw + '|' + legacyCode0] = 1;
      rep.warnings.push({ row: w.row, message: `Barcode ${raw} dipakai kode produk lama ${codeOfRaw[raw]} dan ${legacyCode0} — digabung menjadi satu varian (1 barang fisik), semua SKU lama tetap tercatat` });
    }
    let productId;
    const live = bcType ? liveBc[raw] : null;
    if (!variantId && live) {
      const conv = live.ConversionID ? db_('UNIT_CONVERSIONS').byId(live.ConversionID) : null;
      variantId = live.VariantID || (conv && conv.VariantID);
      variantOfRaw[raw] = variantId;
      rep.warnings.push({ row: w.row, message: `Barcode ${raw} sudah terdaftar — SKU lama ${sku || '(kosong)'} dicatat pada varian yang ada, tanpa produk baru` });
    }
    if (variantId) productId = (db_('PRODUCT_VARIANTS').byId(variantId) || {}).ProductID;
    else {
      const brand = importMaster__ref_(user, 'brand', v.brand, v.brandCode, w.row, rep, bc);
      const cat = importMaster__ref_(user, 'category', v.category, v.categoryCode, w.row, rep, cc);
      if (brand.Status !== STATUS.ACTIVE || cat.Status !== STATUS.ACTIVE) return rep.errors.push({ row: w.row, message: `Brand/kategori "${v.brand}" / "${v.category}" nonaktif` });
      const unit = normalizeUnit(v.unit) || 'PCS';
      if (baseUnits.indexOf(unit) < 0 && /^[A-Z][A-Z0-9]{1,11}$/.test(unit)) {
        baseUnits.push(unit);
        unitsChanged = true;
      }
      const legacyCode = normalizeCode(v.productCode);
      const pkey = brand.BrandID + '|' + (legacyCode || normalizeName(v.name));
      let p = productOf[pkey];
      if (!p) {
        const pc = allocateProductCode_();
        p = db_('MASTER_PRODUCTS').insert({ ProductID: uuid_(), ProductNo: pc.no, BrandID: brand.BrandID, CategoryID: cat.CategoryID, ProductName: cleanText(v.name).slice(0, 120), NameKey: normalizeName(v.name), ProductCode: pc.code, BaseUnit: unit, HasVariants: false, Status: STATUS.ACTIVE, CreatedBy: user.email, CreatedAt: ts, UpdatedBy: user.email, UpdatedAt: ts, Version: 1, LegacyCode: legacyCode });
        productOf[pkey] = p;
        rep.created.products++;
      }
      const siblings = db_('PRODUCT_VARIANTS').filter((x) => x.ProductID === p.ProductID);
      if (siblings.length === 1 && !siblings[0].AttributeKey) {
        // produk lama berisi lebih dari satu barcode → jadikan multi-varian dengan atribut "Varian"
        const first = siblings[0];
        const fa = [{ name: 'Varian', value: first.VariantName === 'Standar' ? p.ProductName : first.VariantName }];
        db_('PRODUCT_VARIANTS').update(first, { VariantName: fa[0].value, VariantAttributes: fa, AttributeKey: attributeKey(fa), IsDefault: false });
        writeAttributes_(first, fa);
        db_('MASTER_PRODUCTS').update(p, { HasVariants: true });
      }
      let attrs = [];
      if (siblings.length) {
        let val = cleanText(v.name).slice(0, 40);
        if (siblings.some((x) => x.AttributeKey === attributeKey([{ name: 'Varian', value: val }]))) val = (val.slice(0, 26) + ' ' + raw.slice(-13)).trim();
        attrs = [{ name: 'Varian', value: val }];
      }
      const newSku = allocateSku_(skuOwner);
      skuOwner[newSku] = p.ProductName;
      const nv = db_('PRODUCT_VARIANTS').insert({ VariantID: uuid_(), ProductID: p.ProductID, VariantCode: '', VariantName: attrs.length ? attrs[0].value : 'Standar', VariantAttributes: attrs, AttributeKey: attributeKey(attrs), SKU: newSku, GTIN: '', InternalBarcode: '', IsDefault: !attrs.length, Status: STATUS.ACTIVE, SortOrder: siblings.length + 1, CreatedBy: user.email, CreatedAt: ts, UpdatedAt: ts });
      writeAttributes_(nv, attrs);
      db_('UNIT_CONVERSIONS').insert({ ConversionID: uuid_(), VariantID: nv.VariantID, ProductID: p.ProductID, UnitName: p.BaseUnit, ConversionFactor: 1, ContainsUnit: p.BaseUnit, BaseUnitEquivalent: 1, IsBaseUnit: true, IsTradeItem: false, SKU: '', GTIN: '', InternalBarcode: '', Status: STATUS.ACTIVE, SortOrder: 0, CreatedAt: ts, UpdatedAt: ts });
      if (bcType) {
        const existingRow = liveBarcodeRow_(raw);
        if (existingRow && existingRow.Status === 'ALLOCATED' && existingRow.BarcodeType === bcType) db_('VARIANT_BARCODES').update(existingRow, { Status: 'ACTIVE', ProductID: p.ProductID, VariantID: nv.VariantID, Reason: 'import template lama' });
        else if (!existingRow) db_('VARIANT_BARCODES').insert({ BarcodeID: uuid_(), Code: raw, BarcodeType: bcType, Symbology: bcType === 'GTIN' ? gtin.symbology : 'EAN13', Status: 'ACTIVE', ProductID: p.ProductID, VariantID: nv.VariantID, VerifiedOfficial: false, Notes: 'Import template lama', CreatedBy: user.email, CreatedAt: ts, Reason: 'import template lama' });
        db_('PRODUCT_VARIANTS').update(nv, bcType === 'GTIN' ? { GTIN: raw } : { InternalBarcode: raw });
        liveBc[raw] = { VariantID: nv.VariantID, ConversionID: '' };
        rep.created.barcodes++;
      }
      variantId = nv.VariantID;
      productId = p.ProductID;
      variantOfRaw[raw] = variantId;
      codeOfRaw[raw] = legacyCode0;
      rep.created.variants++;
    }

    // ---- isi > 1 → paket jual = MULTIPACK virtual (SKU MP…, komponen N × Child SKU). Bukan konversi kemasan
    //      karena baris template ini adalah identitas penjualan (listing paket di Shopee), bukan satuan pembelian.
    let target = { p: productId, v: variantId, c: '', b: '' };
    if (qty > 1) {
      const mk = variantId + '|' + qty;
      let bid = convOf[mk];
      if (!bid) {
        const before = db_('BUNDLE_MASTERS').rows().length;
        bid = ensureMultipack_(user, variantId, qty, ts);
        if (db_('BUNDLE_MASTERS').rows().length > before) rep.created.bundles++;
        convOf[mk] = bid;
      }
      target = { p: '', v: '', c: '', b: bid };
    }
    if (sku) {
      db_('EXTERNAL_SKU_MAPPINGS').insert({ MappingID: uuid_(), System: 'legacy', ExternalSku: sku, ProductID: target.p, VariantID: target.v, ConversionID: target.c, BundleID: target.b, InternalSku: '', MappingStatus: 'legacy', IsActive: true, Notes: `Import template lama baris ${w.row}`, CreatedBy: user.email, CreatedAt: ts, UpdatedAt: ts });
      legacy[sku] = 1;
      rep.created.legacySkus++;
    }
  });
  if (unitsChanged) {
    const rec = db_('Settings').find((r) => r.key === 'base_units');
    const val = JSON.stringify(baseUnits);
    if (rec) db_('Settings').update(rec, { value: val, updated_by: user.email, updated_at: now_() });
    else db_('Settings').insert({ key: 'base_units', value: val, updated_by: user.email, updated_at: now_() });
  }
}

/** Baris bermasalah satu batch import (untuk laporan cek manual). */
function importErrors_(batchId) {
  return db_('IMPORT_ERRORS')
    .filter((e) => e.BatchID === batchId)
    .map((e) => ({ row: e.RowNumber, severity: e.Severity, message: e.Message }));
}

// ------------------------------------------------------------------ listing marketplace (ekspor Seller Center)

/**
 * Setiap baris listing dicocokkan ke SKU internal lewat Seller SKU variasi (atau SKU induk bila listing tanpa variasi):
 * SKU internal, SKU kemasan/bundle, SKU lama (legacy), atau mapping kanal yang sudah ada. Mapping dibuat berstatus
 * "confirmed" karena data berasal dari kanal itu sendiri. SKU yang tidak dikenal dilaporkan, tidak ditebak.
 */
function importChannelListing_(user, work, rep, p) {
  const system = p.channel || 'shopee';
  if (!MARKETPLACES[system]) throw new AppError('Pilih kanal marketplace: Shopee, TikTok Shop, atau Tokopedia');
  const store = cleanText(p.storeAccount);
  const bySku = {};
  sellables_({ includeInactive: true }).forEach((x) => (bySku[x.sku.toUpperCase()] = x.sku));
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.IsActive && m.System === 'legacy')
    .forEach((m) => {
      const t = mappingTarget_(m);
      if (t.internalSku) bySku[String(m.ExternalSku).toUpperCase()] = t.internalSku;
    });
  const clean = (x) => (/^-+$/.test(String(x).trim()) ? '' : cleanText(x));
  work.forEach((w) => {
    const pid = clean(w.v.productId);
    const vid = clean(w.v.variationId);
    const vsku = clean(w.v.variationSku).toUpperCase();
    const psku = clean(w.v.parentSku).toUpperCase();
    const seller = vsku || psku;
    if (!/^\d+$/.test(pid)) return rep.errors.push({ row: w.row, message: 'ID produk listing tidak valid: ' + (pid || '(kosong)') });
    if (!seller) return rep.warnings.push({ row: w.row, message: `Listing ${pid}${vid ? ' variasi ' + vid : ''} tanpa Seller SKU — petakan manual` });
    const internal = bySku[seller];
    if (!internal) return rep.warnings.push({ row: w.row, message: `Seller SKU ${seller} tidak dikenal di master — perlu dipetakan manual / disamakan di Seller Center` });
    const dup = db_('EXTERNAL_SKU_MAPPINGS').find((m) => m.System === system && m.IsActive && String(m.StoreAccount || '').toUpperCase() === store.toUpperCase() && m.ExternalProductId === pid && (m.ExternalVariationId || '') === vid);
    if (dup) return rep.skipped++;
    try {
      createMapping_(user, { system, sku: internal, storeAccount: store, externalProductId: pid, externalVariationId: vid, externalParentSku: psku, externalSku: seller, listingName: w.v.productName + (clean(w.v.variationName) ? ' — ' + w.v.variationName : ''), notes: 'Import ' + rep.fileName }, { status: 'confirmed', silentAudit: true });
      rep.created.mappings++;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      rep.errors.push({ row: w.row, message: e.message });
    }
  });
}

// ------------------------------------------------------------------ kode produk supplier

function importSupplierMapping_(user, work, rep) {
  const sups = {};
  db_('MASTER_SUPPLIERS')
    .filter((x) => x.Status !== STATUS.DELETED)
    .forEach((x) => (sups[x.NameKey] = x));
  work.forEach((w) => {
    const v = w.v;
    const key = masterNameKey(v.supplier);
    let sup = sups[key];
    try {
      if (!sup) {
        const created = supplierSave_(user, { name: v.supplier });
        sup = db_('MASTER_SUPPLIERS').byId(created.id);
        sups[key] = sup;
        rep.created.suppliers++;
      }
      const hit = barcodeLookup_(v.internal);
      const m = (hit.matches || []).find((x) => !x.conversion) || (hit.matches || [])[0];
      if (!m) return rep.errors.push({ row: w.row, message: `SKU/barcode internal ${v.internal} tidak ditemukan` });
      const code = normalizeCode(v.supplierProductCode);
      if (db_('SUPPLIER_PRODUCT_MAPPING').find((x) => x.SupplierID === sup.SupplierID && x.SupplierCodeKey === code && x.Status === STATUS.ACTIVE)) return rep.skipped++;
      supplierMapSave_(user, { supplierId: sup.SupplierID, supplierProductCode: v.supplierProductCode, supplierProductName: v.supplierProductName, variantId: m.variantId, purchaseUnit: v.purchaseUnit, conversionFactor: v.factor || 1, moq: v.moq });
      rep.created.mappings++;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      rep.errors.push({ row: w.row, message: e.message + (e.details && e.details.length ? ': ' + e.details.map((d) => d.message).join('; ') : '') });
    }
  });
}
