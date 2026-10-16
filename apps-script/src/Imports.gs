/**
 * Import Excel/CSV: file dibaca di browser (SheetJS) → baris dikirim ke server.
 * Alur: prepare (deteksi header & mapping kolom) → validate (pratinjau per baris, tanpa menulis)
 *       → commit (validasi ulang di dalam lock, simpan HANYA baris valid, idempoten berdasarkan hash isi).
 */

const IMPORT_TYPES = {
  reference: {
    label: 'Referensi Brand & Kategori',
    description: 'Sheet "Referensi Kode": Nama Brand, Kode Brand, Nama Kategori, Kode Kategori.',
    sheet: /referensi/i,
    fields: [
      { key: 'brandName', label: 'Nama Brand', aliases: ['nama brand', 'brand'] },
      { key: 'brandCode', label: 'Kode Brand', aliases: ['kode brand'] },
      { key: 'categoryName', label: 'Nama Kategori', aliases: ['nama kategori', 'kategori'] },
      { key: 'categoryCode', label: 'Kode Kategori', aliases: ['kode kategori'] },
    ],
  },
  internal_barcodes: {
    label: 'Barcode Internal Terpakai',
    description: 'Sheet "Generator Barcode Internal": kode berstatus Terpakai didaftarkan agar tidak dialokasikan ulang.',
    sheet: /generator/i,
    fields: [
      { key: 'barcode', label: 'Barcode Internal', required: true, aliases: ['barcode internal (ean-13)', 'barcode internal', 'barcode'] },
      { key: 'status', label: 'Status', aliases: ['status'] },
      { key: 'productName', label: 'Nama Produk', aliases: ['nama produk yang menggunakan', 'nama produk'] },
      { key: 'note', label: 'Keterangan', aliases: ['keterangan'] },
    ],
  },
  legacy_master: {
    label: 'Master Produk (template lama)',
    description: 'Sheet "Master Produk": 1 baris = 1 SKU. SKU lama dipertahankan apa adanya.',
    sheet: /master produk/i,
    fields: [
      { key: 'brand', label: 'Nama Brand', required: true, aliases: ['nama brand', 'brand'] },
      { key: 'brandCode', label: 'Kode Brand', aliases: ['kode brand'] },
      { key: 'category', label: 'Nama Kategori', required: true, aliases: ['nama kategori', 'kategori'] },
      { key: 'categoryCode', label: 'Kode Kategori', aliases: ['kode kategori'] },
      { key: 'productCode', label: 'Kode Produk', required: true, aliases: ['kode produk'] },
      { key: 'barcode', label: 'GTIN/Barcode', required: true, aliases: ['gtin/barcode', 'gtin', 'barcode'] },
      { key: 'qty', label: 'Isi', required: true, aliases: ['isi', 'qty', 'isi kemasan'] },
      { key: 'sku', label: 'SKU', aliases: ['sku (otomatis)', 'sku'] },
      { key: 'name', label: 'Nama Produk Master', required: true, aliases: ['nama produk master', 'nama produk'] },
      { key: 'unit', label: 'Satuan', aliases: ['satuan'] },
      { key: 'purchasePrice', label: 'Harga Beli', aliases: ['harga beli'] },
      { key: 'sellingPrice', label: 'Harga Jual', aliases: ['harga jual'] },
    ],
  },
  shopee_listing: {
    label: 'Listing Shopee (konfirmasi mapping)',
    description: 'Ekspor Shopee Seller Center (mis. Data Performa Produk): ID Produk, ID Variasi, SKU. Mapping dibuat "confirmed".',
    sheet: /performa|shopee|listing/i,
    fields: [
      { key: 'productId', label: 'ID Produk Shopee', required: true, aliases: ['kode produk', 'product id', 'id produk'] },
      { key: 'productName', label: 'Nama Listing', aliases: ['produk', 'nama produk', 'product name'] },
      { key: 'status', label: 'Status Produk', aliases: ['status produk saat ini', 'status produk'] },
      { key: 'variationId', label: 'ID Variasi', aliases: ['kode variasi', 'variation id', 'id variasi'] },
      { key: 'variationName', label: 'Nama Variasi', aliases: ['nama variasi'] },
      { key: 'variationSku', label: 'SKU Variasi', aliases: ['sku variasi', 'kode variasi', 'variation sku'] },
      { key: 'parentSku', label: 'SKU Induk', aliases: ['sku induk', 'parent sku', 'sku'] },
    ],
  },
  beecloud_confirm: {
    label: 'Daftar SKU BeeCloud (konfirmasi)',
    description: 'Daftar barang yang diekspor dari BeeCloud. Kolom SKU wajib. SKU yang cocok ditandai "confirmed".',
    fields: [
      { key: 'sku', label: 'SKU / Kode Barang', required: true, aliases: ['sku', 'kode barang', 'kode sku', 'kode produk'] },
      { key: 'name', label: 'Nama Barang', aliases: ['nama barang', 'nama produk', 'nama'] },
    ],
  },
};

function importTypes_() {
  return Object.keys(IMPORT_TYPES).map((id) => ({
    id,
    label: IMPORT_TYPES[id].label,
    description: IMPORT_TYPES[id].description,
    sheetPattern: IMPORT_TYPES[id].sheet ? IMPORT_TYPES[id].sheet.source : '',
    fields: IMPORT_TYPES[id].fields.map((f) => ({ key: f.key, label: f.label, required: !!f.required })),
  }));
}

const nrm_ = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function importPrepare_(p) {
  const def = IMPORT_TYPES[p.type];
  if (!def) throw new AppError('Jenis import tidak dikenal');
  const rows = p.rows || [];
  let best = { idx: 0, score: -1 };
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map(nrm_);
    const score = def.fields.filter((f) => f.aliases.some((a) => cells.indexOf(a) >= 0)).length;
    if (score > best.score) best = { idx: i, score };
  }
  const headers = (rows[best.idx] || []).map((h) => cleanText(h));
  const used = {};
  const mapping = {};
  def.fields.forEach((f) => {
    mapping[f.key] = null;
    for (let k = 0; k < f.aliases.length; k++) {
      const idx = headers.findIndex((h, i) => !used[i] && nrm_(h) === f.aliases[k]);
      if (idx >= 0) {
        mapping[f.key] = idx;
        used[idx] = 1;
        break;
      }
    }
  });
  const dataRows = rows.length - best.idx - 1;
  return { headerIndex: best.idx, headers, mapping, dataRows };
}

/** Bangun daftar kerja per baris dari input client. */
function importWork_(p) {
  const def = IMPORT_TYPES[p.type];
  if (!def) throw new AppError('Jenis import tidak dikenal');
  const map = p.mapping || {};
  const missing = def.fields.filter((f) => f.required && (map[f.key] === null || map[f.key] === undefined || map[f.key] === ''));
  if (missing.length) throw new AppError('Kolom wajib belum dipetakan: ' + missing.map((m) => m.label).join(', '));
  const work = [];
  (p.rows || []).forEach((raw, i) => {
    if (i <= p.headerIndex) return;
    if (!(raw || []).some((c) => String(c === null || c === undefined ? '' : c).trim() !== '')) return;
    const v = {};
    def.fields.forEach((f) => {
      const idx = map[f.key];
      v[f.key] = idx === null || idx === undefined || idx === '' ? '' : cleanText(raw[Number(idx)]);
    });
    work.push({ rowNumber: i + 1, raw, v, n: {}, issues: [], skip: null });
  });
  return work;
}

function issue_(w, severity, code, message) {
  w.issues.push({ severity, code, message });
}

function runValidators_(type, work) {
  ({ reference: validateReference_, internal_barcodes: validateInternalBarcodes_, legacy_master: validateLegacy_, shopee_listing: validateShopee_, beecloud_confirm: validateBeecloud_ })[type](work);
  work.forEach((w) => {
    const err = w.issues.some((i) => i.severity === 'error');
    w.status = err ? 'error' : w.skip ? 'skipped' : w.issues.length ? 'warning' : 'valid';
    if (w.skip && !err) w.issues.push({ severity: 'warning', code: 'SKIPPED', message: w.skip });
  });
  const count = (s) => work.filter((w) => w.status === s).length;
  return { valid: count('valid'), warning: count('warning'), error: count('error'), skipped: count('skipped'), total: work.length };
}

function importValidate_(p) {
  const work = importWork_(p);
  const summary = runValidators_(p.type, work);
  const errorSummary = {};
  work.forEach((w) => w.issues.forEach((i) => (errorSummary[i.severity + ':' + i.code] = (errorSummary[i.severity + ':' + i.code] || 0) + 1)));
  return {
    summary,
    errorSummary: Object.keys(errorSummary).map((k) => ({ severity: k.split(':')[0], code: k.split(':')[1], n: errorSummary[k] })).sort((a, b) => b.n - a.n),
    rows: work.map((w) => ({ rowNumber: w.rowNumber, status: w.status, issues: w.issues, raw: w.raw })),
  };
}

function contentHash_(p) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, p.type + '|' + JSON.stringify(p.rows), Utilities.Charset.UTF_8);
  return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function importCommit_(user, p) {
  const hash = contentHash_(p);
  const prev = db_('ImportBatches').find((b) => b.import_type === p.type && b.content_hash === hash && b.status === 'committed');
  if (prev) throw new AppError(`Data yang sama persis sudah pernah diimport (batch #${prev.batch_no}). Dibatalkan untuk mencegah data ganda.`, [], 'ALREADY_IMPORTED');
  if (p.type === 'reference' && !can_(user, 'reference.manage') && !can_(user, 'reference.propose')) throw new AppError('Tidak berhak', [], 'FORBIDDEN');
  const work = importWork_(p);
  const summary = runValidators_(p.type, work); // validasi ulang dengan data terbaru (di dalam lock)
  const ok = work.filter((w) => w.status === 'valid' || w.status === 'warning');
  ({ reference: commitReference_, internal_barcodes: commitInternal_, legacy_master: commitLegacy_, shopee_listing: commitShopee_, beecloud_confirm: commitBeecloud_ })[p.type](user, ok);
  const batch = db_('ImportBatches').insert({
    id: uuid_(),
    batch_no: nextSeq_('batch_no'),
    import_type: p.type,
    file_name: p.fileName || '',
    sheet_name: p.sheetName || '',
    content_hash: hash,
    status: 'committed',
    total_rows: summary.total,
    committed_rows: ok.length,
    error_rows: summary.error,
    skipped_rows: summary.skipped,
    created_by: user.email,
    created_at: now_(),
  });
  const errs = [];
  work.forEach((w) => w.issues.forEach((i) => errs.push({ batch_id: batch.id, row_number: w.rowNumber, severity: i.severity, code: i.code, message: i.message })));
  db_('ImportErrors').insertMany(errs.slice(0, 5000));
  audit_(user.email, 'import.commit', 'import', batch.id, null, { type: p.type, file: p.fileName, committed: ok.length, errors: summary.error });
  return { batchNo: batch.batch_no, committed: ok.length, summary };
}

function importHistory_() {
  return db_('ImportBatches')
    .rows()
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 100);
}

// ------------------------------------------------------------------ Validator

function parseMoney_(s) {
  if (!s) return null;
  const c = String(s).replace(/rp/i, '').replace(/\s/g, '');
  const n = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(c) ? Number(c.replace(/\./g, '').replace(',', '.')) : Number(c.replace(',', '.'));
  return isFinite(n) && n >= 0 ? n : 'invalid';
}

function refLists_() {
  return { brands: db_('Brands').filter((b) => b.status !== 'rejected'), cats: db_('Categories').filter((c) => c.status !== 'rejected') };
}

function validateReference_(work) {
  const { brands, cats } = refLists_();
  const seen = { brand: { code: {}, name: {} }, category: { code: {}, name: {} } };
  work.forEach((w) => {
    ['brand', 'category'].forEach((kind) => {
      const name = kind === 'brand' ? w.v.brandName : w.v.categoryName;
      const raw = kind === 'brand' ? w.v.brandCode : w.v.categoryCode;
      if (!name && !raw) return;
      const label = kind === 'brand' ? 'Brand' : 'Kategori';
      const code = normalizeCode(raw);
      if (!name || !code) return issue_(w, 'error', 'INCOMPLETE', `${label}: nama dan kode wajib diisi`);
      if (!/^[A-Z0-9]{2,6}$/.test(code)) return issue_(w, 'error', 'BAD_CODE', `${label}: kode "${raw}" harus 2–6 huruf/angka`);
      const nn = normalizeName(name);
      const s = seen[kind];
      if (s.code[code]) return issue_(w, 'error', 'DUP_IN_FILE', `${label}: kode ${code} ganda di file (baris ${s.code[code]})`);
      if (s.name[nn]) return issue_(w, 'error', 'DUP_IN_FILE', `${label}: "${name}" ganda di file (baris ${s.name[nn]})`);
      s.code[code] = s.name[nn] = w.rowNumber;
      const list = kind === 'brand' ? brands : cats;
      const byCode = list.find((x) => x.code === code);
      const byName = list.find((x) => x.name_norm === nn);
      if (byCode && byName && byCode.id === byName.id) return (w.n[kind] = { skip: true });
      if (byCode) return issue_(w, 'error', 'CODE_TAKEN', `${label}: kode ${code} sudah dipakai "${byCode.name}"`);
      if (byName) return issue_(w, 'error', 'NAME_TAKEN', `${label}: "${name}" sudah terdaftar dengan kode ${byName.code}`);
      const similar = list.find((x) => nameSimilarity(x.name, name) >= 0.9);
      if (similar) issue_(w, 'warning', 'SIMILAR', `${label}: mirip dengan "${similar.name}" (${similar.code})`);
      w.n[kind] = { code, name: cleanText(name) };
    });
    const real = ['brand', 'category'].filter((k) => w.n[k] && !w.n[k].skip);
    if (!real.length && !w.issues.some((i) => i.severity === 'error')) w.skip = w.n.brand || w.n.category ? 'Sudah terdaftar' : 'Baris kosong';
  });
}

function validateInternalBarcodes_(work) {
  const reg = {};
  db_('Barcodes').rows().forEach((b) => (reg[b.code] = 1));
  const used = [];
  work.forEach((w) => {
    const code = cleanBarcode(w.v.barcode);
    const st = nrm_(w.v.status);
    w.n = { code, productName: w.v.productName, note: w.v.note };
    if (!st || st === 'tersedia' || st === 'available') return (w.skip = 'Kode masih tersedia — tidak perlu didaftarkan');
    const v = validateGtin(code);
    if (!v.ok) return issue_(w, 'error', v.errorCode, v.message);
    if (code[0] !== '2') issue_(w, 'warning', 'NOT_INTERNAL_PREFIX', 'Kode tidak berada di rentang internal (prefix 2)');
    if (reg[code]) return (w.skip = 'Sudah terdaftar di registry');
    used.forEach((o) => {
      if (o.n.productName && w.n.productName && nameSimilarity(o.n.productName, w.n.productName) >= 0.85)
        issue_(w, 'warning', 'TWO_CODES_SAME_PRODUCT', `Kemungkinan satu barang punya dua kode internal: "${w.n.productName}" mirip "${o.n.productName}" (${o.n.code}, baris ${o.rowNumber})`);
    });
    used.push(w);
  });
}

function validateLegacy_(work) {
  const { brands, cats } = refLists_();
  const prods = {};
  db_('Products').rows().forEach((p) => (prods[p.id] = p));
  const skuMap = {};
  db_('SKUs').rows().forEach((s) => s.sku_code && (skuMap[s.sku_code.toUpperCase()] = s));
  const owners = {};
  db_('BarcodeAssignments').filter((a) => !a.unassigned_at).forEach((a) => (owners[a.code] = prods[a.product_id]));
  const prodBc = {};
  db_('BarcodeAssignments').filter((a) => !a.unassigned_at && a.variant_id).forEach((a) => (prodBc[a.product_id] = a.code));
  const seenSku = {}, codeBc = {}, bcCode = {}, packs = {};
  work.forEach((w) => {
    const v = w.v;
    const missing = ['brand', 'category', 'productCode', 'barcode', 'qty', 'name'].filter((k) => !v[k]);
    if (missing.length) {
      const labels = IMPORT_TYPES.legacy_master.fields.filter((f) => missing.indexOf(f.key) >= 0).map((f) => f.label);
      return issue_(w, 'error', 'INCOMPLETE', 'Data tidak lengkap: ' + labels.join(', ') + ' kosong');
    }
    const brand = brands.find((b) => b.name_norm === normalizeName(v.brand)) || brands.find((b) => b.code === normalizeCode(v.brandCode));
    if (!brand) issue_(w, 'error', 'BRAND_UNKNOWN', `Brand "${v.brand}" belum terdaftar — import Referensi Kode terlebih dahulu`);
    else if (v.brandCode && normalizeCode(v.brandCode) !== brand.code) issue_(w, 'warning', 'BRAND_CODE_DIFF', `Kode brand di file (${v.brandCode}) berbeda dengan master (${brand.code})`);
    const cat = cats.find((c) => c.name_norm === normalizeName(v.category)) || cats.find((c) => c.code === normalizeCode(v.categoryCode));
    if (!cat) issue_(w, 'error', 'CATEGORY_UNKNOWN', `Kategori "${v.category}" belum terdaftar`);
    const pc = normalizeCode(v.productCode);
    if (!/^[A-Z0-9]{2,16}$/.test(pc)) issue_(w, 'error', 'BAD_PRODUCT_CODE', `Kode produk "${v.productCode}" tidak valid`);
    const code = cleanBarcode(v.barcode);
    const gv = validateGtin(code);
    if (!gv.ok) issue_(w, 'error', gv.errorCode, `Barcode ${code}: ${gv.message}`);
    const qty = Number(v.qty);
    if (!Number.isInteger(qty) || qty < 1) issue_(w, 'error', 'BAD_QTY', `Isi "${v.qty}" harus bilangan bulat ≥ 1`);
    const buy = parseMoney_(v.purchasePrice), sell = parseMoney_(v.sellingPrice);
    if (buy === 'invalid') issue_(w, 'error', 'BAD_PRICE', 'Harga beli tidak valid');
    if (sell === 'invalid') issue_(w, 'error', 'BAD_PRICE', 'Harga jual tidak valid');
    if (typeof buy === 'number' && typeof sell === 'number' && sell < buy) issue_(w, 'warning', 'NEGATIVE_MARGIN', `Harga jual (${sell}) lebih kecil dari harga beli (${buy})`);
    if (w.issues.some((i) => i.severity === 'error')) return;
    const barcodeType = code[0] === '2' ? 'internal' : 'gtin';
    if (barcodeType === 'internal') issue_(w, 'warning', 'INTERNAL_BARCODE', 'Barcode internal (prefix 2) — bukan GTIN resmi produsen');
    const generated = buildSku(DEFAULT_SETTINGS.sku_template, { brand: brand.code, category: cat.code, product: pc, barcode: code, qty }).sku;
    let sku = String(v.sku || '').toUpperCase();
    if (!sku) {
      sku = generated;
      issue_(w, 'warning', 'SKU_GENERATED', 'SKU kosong — dibuat otomatis: ' + sku);
    } else if (sku !== generated) issue_(w, 'warning', 'SKU_PATTERN', `SKU tidak sesuai pola (seharusnya ${generated}); SKU file dipertahankan`);
    let unit = String(v.unit || (qty === 1 ? 'PCS' : 'PACK')).toUpperCase();
    if (SALES_UNITS.indexOf(unit) < 0) unit = qty === 1 ? 'PCS' : 'PACK';
    const gk = brand.id + '|' + pc;
    w.n = { brandId: brand.id, categoryId: cat.id, productCode: pc, barcode: code, barcodeType, qty, sku, name: cleanText(v.name), unit, purchasePrice: typeof buy === 'number' ? buy : null, sellingPrice: typeof sell === 'number' ? sell : null, groupKey: gk };
    if (seenSku[sku]) return issue_(w, 'error', 'DUP_SKU_IN_FILE', `SKU ${sku} ganda di file (baris ${seenSku[sku]})`);
    seenSku[sku] = w.rowNumber;
    if (codeBc[gk] && codeBc[gk].barcode !== code) return issue_(w, 'error', 'CODE_MULTI_BARCODE', `Kode produk ${pc} dipakai untuk barcode berbeda (${codeBc[gk].barcode} di baris ${codeBc[gk].row})`);
    if (!codeBc[gk]) codeBc[gk] = { barcode: code, row: w.rowNumber };
    if (bcCode[code] && bcCode[code].gk !== gk)
      return issue_(w, 'error', 'BARCODE_MULTI_PRODUCT', `Barcode ${code} sudah dipakai kode produk ${bcCode[code].pc} (baris ${bcCode[code].row}). Satu barang fisik = satu master — gabungkan baris ini`);
    if (!bcCode[code]) bcCode[code] = { gk, pc, row: w.rowNumber };
    if (packs[gk + '|' + qty]) return issue_(w, 'error', 'DUP_PACK', `Isi ${qty} untuk produk ${pc} sudah ada di baris ${packs[gk + '|' + qty]}`);
    packs[gk + '|' + qty] = w.rowNumber;
    const ex = skuMap[sku];
    if (ex) {
      const ep = prods[ex.product_id] || {};
      if (ep.brand_id === brand.id && ep.product_code === pc && ex.pack_qty === qty) return (w.skip = 'SKU sudah ada di master (import ulang dilewati)');
      return issue_(w, 'error', 'SKU_TAKEN', `SKU ${sku} sudah dipakai produk lain di master`);
    }
    const owner = owners[code];
    if (owner && (owner.brand_id !== brand.id || owner.product_code !== pc)) return issue_(w, 'error', 'BARCODE_TAKEN', `Barcode ${code} sudah dipakai "${owner.name}" (${owner.product_code}) di master`);
    const exProd = db_('Products').find((p) => p.brand_id === brand.id && p.product_code === pc && p.status !== 'archived');
    if (exProd && prodBc[exProd.id] && prodBc[exProd.id] !== code) issue_(w, 'error', 'PRODUCT_BARCODE_DIFF', `Produk ${pc} di master memakai barcode ${prodBc[exProd.id]}`);
  });
  const groups = {};
  work.forEach((w) => w.n.groupKey && !w.issues.some((i) => i.severity === 'error') && (groups[w.n.groupKey] = (groups[w.n.groupKey] || []).concat([w])));
  Object.keys(groups).forEach((k) => {
    if (!groups[k].some((w) => w.n.qty === 1)) groups[k].forEach((w) => issue_(w, 'warning', 'NO_SINGLE_UNIT', 'Tidak ada baris isi 1 (SKU satuan) untuk produk ini'));
  });
}

function validateShopee_(work) {
  const skuMap = {};
  db_('SKUs').rows().forEach((s) => s.sku_code && (skuMap[s.sku_code.toUpperCase()] = s));
  const mapped = {};
  db_('Mappings').filter((m) => m.system === 'shopee' && m.is_active).forEach((m) => (mapped[m.external_product_id + '|' + (m.external_variation_id || '')] = m));
  const seen = {};
  work.forEach((w) => {
    const pid = String(w.v.productId).replace(/\D/g, '');
    const vid = w.v.variationId && w.v.variationId !== '-' ? String(w.v.variationId).replace(/\D/g, '') : '';
    const sku = String((w.v.variationSku && w.v.variationSku !== '-' ? w.v.variationSku : w.v.parentSku && w.v.parentSku !== '-' ? w.v.parentSku : '') || '').toUpperCase();
    w.n = { productId: pid, variationId: vid, sku, listingName: cleanText([w.v.productName, w.v.variationName !== '-' ? w.v.variationName : ''].filter(Boolean).join(' / ')).slice(0, 300) };
    if (!pid) return issue_(w, 'error', 'NO_PRODUCT_ID', 'ID Produk Shopee kosong');
    if (/dihapus|deleted/i.test(w.v.status)) return (w.skip = 'Listing berstatus Dihapus');
    if (!sku) return issue_(w, 'error', 'NO_SKU', 'Listing tidak memiliki SKU — isi SKU di Seller Center agar dapat dipetakan');
    const key = pid + '|' + vid;
    if (seen[key]) return issue_(w, 'error', 'DUP_IN_FILE', `Listing/variasi ganda di file (baris ${seen[key]})`);
    seen[key] = w.rowNumber;
    const s = skuMap[sku];
    if (!s) return issue_(w, 'error', 'SKU_NOT_IN_MASTER', `SKU "${sku}" tidak ditemukan di master — samakan SKU listing dengan SKU master`);
    if (['draft', 'archived'].indexOf(s.status) >= 0) return issue_(w, 'error', 'SKU_NOT_ACTIVE', `SKU ${sku} berstatus ${s.status}`);
    w.n.skuId = s.id;
    const ex = mapped[key];
    if (ex) {
      if (ex.sku_id === s.id) w.skip = 'Mapping sudah ada';
      else issue_(w, 'error', 'LISTING_MAPPED_ELSEWHERE', 'Listing ini sudah dipetakan ke SKU lain');
    }
  });
}

function validateBeecloud_(work) {
  const skuMap = {};
  db_('SKUs').rows().forEach((s) => s.sku_code && (skuMap[s.sku_code.toUpperCase()] = s));
  const conf = {};
  db_('Mappings').filter((m) => m.system === 'beecloud' && m.is_active && m.mapping_status === 'confirmed').forEach((m) => (conf[m.sku_id] = 1));
  const seen = {};
  work.forEach((w) => {
    const sku = String(w.v.sku || '').toUpperCase();
    w.n = { sku };
    if (!sku) return issue_(w, 'error', 'NO_SKU', 'SKU kosong');
    if (seen[sku]) return issue_(w, 'error', 'DUP_IN_FILE', `SKU ganda di file (baris ${seen[sku]})`);
    seen[sku] = w.rowNumber;
    const s = skuMap[sku];
    if (!s) return issue_(w, 'error', 'SKU_NOT_IN_MASTER', `SKU ${sku} ada di BeeCloud tetapi tidak ada di master`);
    w.n.skuId = s.id;
    if (conf[s.id]) w.skip = 'Sudah terkonfirmasi';
  });
}

// ------------------------------------------------------------------ Commit

function commitReference_(user, rows) {
  const status = can_(user, 'reference.manage') ? 'active' : 'pending';
  rows.forEach((w) =>
    ['brand', 'category'].forEach((kind) => {
      const d = w.n[kind];
      if (!d || d.skip) return;
      db_(kind === 'brand' ? 'Brands' : 'Categories').insert({
        id: uuid_(), code: d.code, name: d.name, name_norm: normalizeName(d.name), status, proposed_by: user.email,
        approved_by: status === 'active' ? user.email : '', approved_at: status === 'active' ? now_() : '', created_at: now_(), updated_at: now_(), version: 1,
      });
    }),
  );
}

function commitInternal_(user, rows) {
  rows.forEach((w) =>
    db_('Barcodes').insert({ code: w.n.code, barcode_type: 'internal', symbology: 'EAN13', status: 'allocated', verified_official: false, notes: 'Import sheet Generator — dipakai: ' + (w.n.productName || '-'), allocated_by: user.email, allocated_at: now_() }),
  );
}

function commitLegacy_(user, rows) {
  const groups = {};
  rows.forEach((w) => (groups[w.n.groupKey] = (groups[w.n.groupKey] || []).concat([w])));
  Object.keys(groups).forEach((k) => {
    const list = groups[k].sort((a, b) => a.n.qty - b.n.qty);
    const f = list[0].n;
    let p = db_('Products').find((x) => x.brand_id === f.brandId && x.product_code === f.productCode && x.status !== 'archived');
    if (!p) {
      const single = list.find((w) => w.n.qty === 1);
      const name = single ? single.n.name : f.name.replace(/\s*-\s*\d+\s*(PCS|PACK|PC)\s*$/i, '');
      p = db_('Products').insert({
        id: uuid_(), product_no: nextSeq_('product_no'), brand_id: f.brandId, category_id: f.categoryId, product_code: f.productCode, name, name_norm: normalizeName(name), token_key: tokenKey(name),
        product_type: 'standard', base_unit: 'PCS', has_variants: false, status: 'active', is_legacy: true, version: 1, created_by: user.email, created_at: now_(),
        updated_by: user.email, updated_at: now_(), approved_by: user.email, approved_at: now_(), activated_at: now_(),
      });
      approval_({ entityType: 'product', entityId: p.id, action: 'legacy_import', to: 'active', actor: user.email, reason: 'Migrasi dari template Excel lama' });
    }
    let v = db_('Variants').find((x) => x.product_id === p.id && x.status !== 'archived');
    if (!v)
      v = db_('Variants').insert({ id: uuid_(), variant_no: nextSeq_('variant_no'), product_id: p.id, variant_code: '', name: '', attributes_json: [], signature: '', is_default: true, status: 'active', sort_order: 0, created_by: user.email, created_at: now_() });
    let bc = findBarcode_(f.barcode);
    if (!bc) bc = db_('Barcodes').insert({ code: f.barcode, barcode_type: f.barcodeType, symbology: 'EAN13', status: 'allocated', verified_official: false, notes: 'Import template lama', allocated_by: user.email, allocated_at: now_() });
    if (!primaryBarcode_({ variantId: v.id })) assignBarcode_(user, bc, { productId: p.id, variantId: v.id }, 'import template lama');
    list.forEach((w) => {
      const d = w.n;
      const s = db_('SKUs').insert({
        id: uuid_(), sku_no: nextSeq_('sku_no'), sku_code: d.sku, product_id: p.id, variant_id: v.id, sku_type: d.qty === 1 ? 'single' : 'multipack', pack_qty: d.qty,
        sales_unit: d.unit, display_name: d.name, status: 'active', sku_source: 'legacy_import', created_by: user.email, created_at: now_(), updated_at: now_(),
      });
      if (d.purchasePrice !== null) setPrice_(user, s.id, 'purchase', d.purchasePrice, 'import template lama');
      if (d.sellingPrice !== null) setPrice_(user, s.id, 'selling', d.sellingPrice, 'import template lama');
    });
  });
}

function commitShopee_(user, rows) {
  rows.forEach((w) =>
    createMapping_(user, { skuId: w.n.skuId, system: 'shopee', externalSku: w.n.sku, externalProductId: w.n.productId, externalVariationId: w.n.variationId, listingName: w.n.listingName, notes: 'Dikonfirmasi dari file ekspor Shopee' }, 'confirmed'),
  );
}

function commitBeecloud_(user, rows) {
  rows.forEach((w) => {
    const m = db_('Mappings').find((x) => x.sku_id === w.n.skuId && x.system === 'beecloud' && x.is_active);
    if (m) db_('Mappings').update(m, { mapping_status: 'confirmed', external_sku: w.n.sku, last_confirmed_at: now_(), last_error: '', notes: 'Dikonfirmasi dari file ekspor BeeCloud', updated_at: now_() });
    else createMapping_(user, { skuId: w.n.skuId, system: 'beecloud', externalSku: w.n.sku, notes: 'Dikonfirmasi dari file ekspor BeeCloud' }, 'confirmed');
  });
}
