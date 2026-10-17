/**
 * CHANNEL SKU MAPPING (tab EXTERNAL_SKU_MAPPINGS) — kode di luar SKU internal, dipetakan ke ID permanen:
 *   System = legacy | shopee | tiktok | tokopedia | beecloud | lainnya
 *   Target = VariantID (Child SKU) | ConversionID (kemasan trade item) | BundleID (multipack / bundle)
 * Field marketplace: StoreAccount, ExternalProductId (ID produk/listing), ExternalVariationId, ExternalParentSku
 * (SKU induk listing — TIDAK diasumsikan sama dengan Parent SKU internal), ExternalSku (Seller SKU variasi / Item Code BeeCloud).
 * Status: mapped → exported (belum terbukti) → confirmed (ada bukti dari kanal) ; error / mismatch. "Unmapped" = belum ada mapping.
 * MVP: import, ekspor, dan mapping manual — TIDAK ada sinkronisasi API otomatis.
 */

const MAPPING_SYSTEMS = ['legacy', 'shopee', 'tiktok', 'tokopedia', 'beecloud', 'lainnya'];
const MARKETPLACES = { shopee: 1, tiktok: 1, tokopedia: 1 };

/** Semua identitas yang bisa dijual: Child SKU, kemasan trade item, multipack & bundle aktif. */
function sellables_(opts) {
  opts = opts || {};
  const prods = indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID');
  const brands = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const cats = indexBy_(db_('MASTER_CATEGORIES').rows(), 'CategoryID');
  const variants = indexBy_(db_('PRODUCT_VARIANTS').rows(), 'VariantID');
  const attrs = attributesByVariant_();
  const legacy = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.IsActive && m.System === 'legacy')
    .forEach((m) => {
      const k = m.ConversionID || m.VariantID || m.BundleID;
      legacy[k] = (legacy[k] ? legacy[k] + ', ' : '') + m.ExternalSku;
    });
  const out = [];
  const ctx = (pid) => {
    const p = prods[pid] || {};
    const b = brands[p.BrandID] || {};
    const c = cats[p.CategoryID] || {};
    return { product_id: pid, product_code: p.ProductCode, legacy_code: p.LegacyCode || '', product_name: p.ProductName, product_status: p.Status, base_unit: p.BaseUnit, brand_name: b.BrandName, brand_code: b.BrandCode, category_name: c.CategoryName, category_code: c.CategoryCode };
  };
  const ok = (...st) => (opts.statuses ? st.every((s) => opts.statuses[s]) : opts.includeInactive || st.every((s) => s === STATUS.ACTIVE));
  const attrText = (vid) => (attrs[vid] || []).map((a) => a.name + ': ' + a.value).join(', ');
  db_('PRODUCT_VARIANTS')
    .rows()
    .forEach((v) => {
      if (!v.SKU) return;
      const c = ctx(v.ProductID);
      if (!ok(c.product_status, v.Status)) return;
      out.push(Object.assign(c, { kind: 'variant', sku: v.SKU, variant_id: v.VariantID, conversion_id: '', bundle_id: '', variant_name: v.IsDefault ? '' : v.VariantName, attributes: attrText(v.VariantID), display_name: cleanText(c.product_name + (v.IsDefault ? '' : ' ' + v.VariantName)), unit: c.base_unit, base_qty: 1, barcode: v.GTIN || v.InternalBarcode || '', barcode_type: v.GTIN ? 'GTIN' : v.InternalBarcode ? 'Internal' : '', legacy_sku: legacy[v.VariantID] || '', stockable: v.Stockable !== 'NON_STOCKABLE', batch: v.BatchTracking, expiry: v.ExpiryTracking, shelf_life: v.ShelfLifeMonths, purchase_unit: v.PurchaseUnit || '', sales_unit: v.SalesUnit || c.base_unit, status: c.product_status === STATUS.ACTIVE ? v.Status : c.product_status }));
    });
  db_('UNIT_CONVERSIONS')
    .rows()
    .forEach((u) => {
      if (!u.SKU || u.Status === STATUS.DELETED) return;
      const v = variants[u.VariantID] || {};
      const c = ctx(u.ProductID);
      if (!ok(c.product_status, v.Status, u.Status)) return;
      out.push(Object.assign(c, { kind: 'pack', sku: u.SKU, variant_id: u.VariantID, conversion_id: u.ConversionID, bundle_id: '', variant_name: v.IsDefault ? '' : v.VariantName, attributes: attrText(u.VariantID), display_name: cleanText(c.product_name + (v.IsDefault ? '' : ' ' + v.VariantName) + ' - ' + u.UnitName + ' isi ' + u.BaseUnitEquivalent + ' ' + c.base_unit), unit: u.UnitName, base_qty: u.BaseUnitEquivalent, barcode: u.GTIN || u.InternalBarcode || '', barcode_type: u.GTIN ? 'GTIN' : u.InternalBarcode ? 'Internal' : '', legacy_sku: legacy[u.ConversionID] || '', stockable: false, status: c.product_status === STATUS.ACTIVE && v.Status === STATUS.ACTIVE ? u.Status : STATUS.INACTIVE }));
    });
  if (opts.withBundles !== false)
    db_('BUNDLE_MASTERS')
      .rows()
      .forEach((b) => {
        if (!ok(b.Status)) return;
        const bc = db_('VARIANT_BARCODES').find((x) => x.BundleID === b.BundleID && x.Status === 'ACTIVE');
        out.push({ kind: 'bundle', sku: b.BundleSKU, variant_id: '', conversion_id: '', bundle_id: b.BundleID, product_id: '', product_code: '', product_name: b.BundleName, display_name: b.BundleName + ' (' + (BUNDLE_TYPES[b.BundleType] || b.BundleType) + ')', variant_name: '', attributes: '', brand_name: '', brand_code: '', category_name: '', category_code: '', base_unit: 'SET', unit: 'SET', base_qty: 1, barcode: bc ? bc.Code : '', barcode_type: bc ? (bc.BarcodeType === 'GTIN' ? 'GTIN' : 'Internal') : '', legacy_sku: legacy[b.BundleID] || '', legacy_code: '', stockable: b.Stockable === 'STOCKABLE', status: b.Status, bundle_type: b.BundleType, stock_mode: b.StockMode });
      });
  return out.sort((a, b) => String(a.brand_name + a.display_name).localeCompare(String(b.brand_name + b.display_name), 'id') || a.base_qty - b.base_qty);
}

/** Label target pemetaan (varian / kemasan / bundle) dari ID. */
/** Pencarian SKU untuk dropdown (Child SKU / kemasan / bundle aktif). */
function skuSearch_(q, kinds) {
  const k = kinds && kinds.length ? kinds : ['variant', 'pack', 'bundle'];
  const u = String(q || '').toUpperCase();
  return sellables_()
    .filter((s) => k.indexOf(s.kind) >= 0 && (!u || (s.sku + ' ' + s.display_name + ' ' + s.barcode + ' ' + s.legacy_sku).toUpperCase().indexOf(u) >= 0))
    .slice(0, 30)
    .map((s) => ({ sku: s.sku, kind: s.kind, displayName: s.display_name, barcode: s.barcode, variantId: s.variant_id, bundleId: s.bundle_id, productId: s.product_id, baseUnit: s.base_unit }));
}

function mappingTarget_(m) {
  if (m.BundleID) {
    const b = db_('BUNDLE_MASTERS').byId(m.BundleID) || {};
    return { productId: '', bundleId: m.BundleID, internalSku: b.BundleSKU || '', displayName: b.BundleName || '', targetStatus: b.Status, kind: 'bundle' };
  }
  const conv = m.ConversionID ? db_('UNIT_CONVERSIONS').byId(m.ConversionID) : null;
  const v = db_('PRODUCT_VARIANTS').byId(m.VariantID || (conv && conv.VariantID));
  const p = v ? db_('MASTER_PRODUCTS').byId(v.ProductID) : null;
  return {
    productId: p ? p.ProductID : '',
    internalSku: conv ? conv.SKU || '' : v ? v.SKU : '',
    displayName: p ? cleanText(p.ProductName + (v.IsDefault ? '' : ' ' + v.VariantName) + (conv ? ' - ' + conv.UnitName + ' isi ' + conv.BaseUnitEquivalent : '')) : '',
    targetStatus: p && v ? (p.Status !== STATUS.ACTIVE ? p.Status : v.Status) : '',
    kind: conv ? 'pack' : 'variant',
  };
}

function mappingView_(m) {
  const t = mappingTarget_(m);
  return { id: m.MappingID, system: m.System, channelLabel: CHANNEL_LABEL[m.System] || m.System, storeAccount: m.StoreAccount || '', externalSku: m.ExternalSku, externalParentSku: m.ExternalParentSku || '', internalSku: t.internalSku, targetKind: t.kind, targetStatus: t.targetStatus, externalProductId: m.ExternalProductId, externalVariationId: m.ExternalVariationId, listingName: m.ListingName, status: m.MappingStatus, lastError: m.LastError, notes: m.Notes, updatedAt: m.UpdatedAt, lastExportedAt: m.LastExportedAt, lastConfirmedAt: m.LastConfirmedAt, displayName: t.displayName, productId: t.productId, bundleId: t.bundleId || '', skuMatches: String(m.ExternalSku || '').toUpperCase() === String(t.internalSku).toUpperCase() };
}

function mappingList_(f) {
  f = f || {};
  const q = String(f.search || '').toUpperCase();
  const rows = db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.IsActive && (!f.system || m.System === f.system) && (!f.status || m.MappingStatus === f.status) && (!f.store || String(m.StoreAccount || '').toUpperCase() === String(f.store).toUpperCase()) && (!f.productId || m.ProductID === f.productId) && (!f.variantId || m.VariantID === f.variantId) && (!f.bundleId || m.BundleID === f.bundleId))
    .map(mappingView_)
    .filter((m) => !q || [m.internalSku, m.externalSku, m.externalParentSku, m.externalProductId, m.externalVariationId, m.displayName, m.listingName, m.storeAccount].join(' ').toUpperCase().indexOf(q) >= 0)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return paginate_(rows, f.page, Math.min(Number(f.pageSize) || 50, 200));
}

/** Identitas aktif yang BELUM punya mapping di kanal tsb (status "Unmapped"). */
function unmappedSkus_(system, search) {
  const mapped = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.System === system && m.IsActive)
    .forEach((m) => (mapped[m.BundleID || m.ConversionID || m.VariantID] = 1));
  const q = String(search || '').toUpperCase();
  return sellables_()
    .filter((s) => !mapped[s.bundle_id || s.conversion_id || s.variant_id])
    .filter((s) => !q || (s.sku + ' ' + s.display_name + ' ' + s.barcode + ' ' + s.legacy_sku).toUpperCase().indexOf(q) >= 0)
    .slice(0, 50)
    .map((s) => ({ sku: s.sku, displayName: s.display_name, barcode: s.barcode, kind: s.kind, legacySku: s.legacy_sku }));
}

function unmappedCount_(system) {
  const mapped = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.System === system && m.IsActive)
    .forEach((m) => (mapped[m.BundleID || m.ConversionID || m.VariantID] = 1));
  return sellables_().filter((s) => !mapped[s.bundle_id || s.conversion_id || s.variant_id]).length;
}

/**
 * Buat mapping kanal. input: { system, sku (SKU internal / SKU kemasan / SKU bundle), storeAccount, externalProductId,
 * externalVariationId, externalParentSku, externalSku, listingName, notes, status?('confirmed' untuk import dari kanal) }
 */
function createMapping_(user, input, opts) {
  opts = opts || {};
  const system = input.system;
  if (MAPPING_SYSTEMS.indexOf(system) < 0 || system === 'legacy') throw new AppError('Kanal tidak dikenal');
  const sku = String(input.sku || '').trim().toUpperCase();
  const s = sellables_({ includeInactive: true }).find((x) => x.sku.toUpperCase() === sku);
  if (!s) throw new AppError(`SKU internal ${sku || '(kosong)'} tidak ditemukan`, [{ path: 'sku', message: 'Tidak ditemukan' }], 'VALIDATION_FAILED');
  if (s.status !== STATUS.ACTIVE) throw new AppError(`SKU ${s.sku} berstatus ${STATUS_LABEL[s.status] || s.status} — hanya SKU aktif yang dapat dipetakan baru`, [{ path: 'sku', message: 'Tidak aktif' }], 'VALIDATION_FAILED');
  const store = cleanText(input.storeAccount).slice(0, 60);
  const pid = String(input.externalProductId || '').trim();
  const vid = String(input.externalVariationId || '').trim();
  const ext = String(input.externalSku || (system === 'beecloud' ? s.sku : '')).trim().toUpperCase();
  const parentSku = String(input.externalParentSku || '').trim().toUpperCase();
  const errs = [];
  if (MARKETPLACES[system]) {
    if (!/^\d{3,25}$/.test(pid)) errs.push({ path: 'externalProductId', message: 'ID produk/listing wajib berupa angka' });
    if (vid && !/^\d{1,25}$/.test(vid)) errs.push({ path: 'externalVariationId', message: 'ID variasi harus berupa angka' });
  } else if (!ext) errs.push({ path: 'externalSku', message: system === 'beecloud' ? 'Item Code BeeCloud wajib' : 'Kode eksternal wajib' });
  if (ext.length > 80 || parentSku.length > 80) errs.push({ path: 'externalSku', message: 'Kode maksimal 80 karakter' });
  const M = db_('EXTERNAL_SKU_MAPPINGS');
  const target = s.bundle_id || s.conversion_id || s.variant_id;
  if (MARKETPLACES[system]) {
    const dup = M.find((m) => m.System === system && m.IsActive && String(m.StoreAccount || '').toUpperCase() === store.toUpperCase() && m.ExternalProductId === pid && (m.ExternalVariationId || '') === vid);
    if (dup) errs.push({ path: 'externalVariationId', message: `Listing ${pid}${vid ? ' variasi ' + vid : ''} di ${CHANNEL_LABEL[system]}${store ? ' (' + store + ')' : ''} sudah dipetakan ke ${mappingTarget_(dup).internalSku}`, code: 'DUPLICATE' });
  } else {
    if (M.find((m) => m.System === system && m.IsActive && (m.BundleID || m.ConversionID || m.VariantID) === target && String(m.StoreAccount || '').toUpperCase() === store.toUpperCase()))
      errs.push({ path: 'sku', message: `SKU ini sudah dipetakan ke ${CHANNEL_LABEL[system]}`, code: 'DUPLICATE' });
    if (M.find((m) => m.System === system && m.IsActive && String(m.ExternalSku).toUpperCase() === ext && String(m.StoreAccount || '').toUpperCase() === store.toUpperCase()))
      errs.push({ path: 'externalSku', message: `Kode ${ext} di ${CHANNEL_LABEL[system]} sudah dipetakan ke SKU lain`, code: 'DUPLICATE' });
  }
  if (errs.length) throw new AppError(errs.map((e) => e.message).join('; '), errs, errs.some((e) => e.code === 'DUPLICATE') ? 'DUPLICATE' : 'VALIDATION_FAILED');
  const st = opts.status || 'mapped';
  const rec = M.insert({
    MappingID: uuid_(),
    System: system,
    ExternalSku: ext,
    ProductID: s.product_id || '',
    VariantID: s.conversion_id || s.bundle_id ? '' : s.variant_id,
    ConversionID: s.conversion_id || '',
    BundleID: s.bundle_id || '',
    InternalSku: s.sku,
    ExternalProductId: pid,
    ExternalVariationId: vid,
    ExternalParentSku: parentSku,
    StoreAccount: store,
    ListingName: cleanText(input.listingName).slice(0, 300),
    MappingStatus: st,
    IsActive: true,
    LastConfirmedAt: st === 'confirmed' ? now_() : '',
    Notes: cleanText(input.notes),
    CreatedBy: user.email,
    CreatedAt: now_(),
    UpdatedAt: now_(),
  });
  if (!opts.silentAudit) audit_(user.email, 'mapping.create', 'mapping', rec.MappingID, null, { sku: s.sku, system, store, ext, pid, vid, status: st }, { productId: s.product_id });
  return { id: rec.MappingID };
}

function mappingAction_(user, id, action, note) {
  const m = db_('EXTERNAL_SKU_MAPPINGS').byId(id);
  if (!m || !m.IsActive) throw new AppError('Mapping tidak ditemukan');
  if (m.System === 'legacy' && action !== 'deactivate') throw new AppError('SKU lama hanya untuk penelusuran — tidak memiliki status sinkronisasi');
  if (['confirm', 'mark_error', 'deactivate'].indexOf(action) >= 0 && !cleanText(note)) throw new AppError('Catatan/bukti wajib diisi (mis. "dicek di Seller Centre 14/10, SKU tampil")');
  const internal = mappingTarget_(m).internalSku;
  const before = { status: m.MappingStatus, externalSku: m.ExternalSku };
  const patch = { UpdatedAt: now_(), Notes: cleanText(note) || m.Notes };
  if (action === 'mark_exported') Object.assign(patch, { MappingStatus: 'exported', LastExportedAt: now_() });
  else if (action === 'confirm') {
    if (m.System === 'beecloud' && String(m.ExternalSku).toUpperCase() !== String(internal).toUpperCase()) throw new AppError(`Item Code BeeCloud (${m.ExternalSku}) berbeda dari SKU internal (${internal}). Reset mapping dulu.`);
    Object.assign(patch, { MappingStatus: 'confirmed', LastConfirmedAt: now_(), LastError: '' });
  } else if (action === 'mark_error') Object.assign(patch, { MappingStatus: 'error', LastError: cleanText(note) });
  else if (action === 'reset') Object.assign(patch, { MappingStatus: 'mapped', LastError: '', ExternalSku: m.System === 'beecloud' ? internal : m.ExternalSku });
  else if (action === 'deactivate') patch.IsActive = false;
  else throw new AppError('Aksi tidak dikenal');
  db_('EXTERNAL_SKU_MAPPINGS').update(m, patch);
  audit_(user.email, 'mapping.' + action, 'mapping', id, before, { status: m.MappingStatus, externalSku: m.ExternalSku }, Object.assign({ productId: m.ProductID }, note ? { note } : {}));
  return { id, status: m.MappingStatus };
}

function mappingSummary_() {
  const out = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.IsActive && m.System !== 'legacy')
    .forEach((m) => {
      const k = m.System;
      out[k] = out[k] || { mapped: 0, exported: 0, confirmed: 0, error: 0, mismatch: 0 };
      out[k][m.MappingStatus] = (out[k][m.MappingStatus] || 0) + 1;
    });
  Object.keys(out).forEach((k) => (out[k].unmapped = unmappedCount_(k)));
  return out;
}

// ---------------------------------------------------------------- Ekspor

function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmm');
}

/** Master per SKU (Child SKU, kemasan ber-SKU, bundle) termasuk SKU lama untuk penelusuran. */
function exportMaster_() {
  // Draft & Archived tidak diekspor ke sistem downstream
  const rows = sellables_({ statuses: INVENTORY_STATUSES });
  return {
    fileName: 'master-produk-sku-' + stamp_(),
    headers: ['No', 'SKU', 'Jenis SKU', 'Parent SKU', 'Nama Produk', 'Varian', 'Atribut', 'Satuan', 'Isi (Satuan Dasar)', 'Satuan Dasar', 'Barcode', 'Jenis Barcode', 'Brand', 'Kode Brand', 'Kategori', 'Kode Kategori', 'Stockable', 'SKU Lama', 'Kode Produk Lama', 'Status'],
    rows: rows.map((r, i) => [i + 1, r.sku, r.kind === 'pack' ? 'Kemasan' : r.kind === 'bundle' ? 'Bundle' : 'Child SKU', r.product_code, r.product_name, r.variant_name, r.attributes, r.unit, r.base_qty, r.base_unit, r.barcode, r.barcode_type, r.brand_name, r.brand_code, r.category_name, r.category_code, r.stockable ? 'Ya' : 'Tidak', r.legacy_sku, r.legacy_code, STATUS_LABEL[r.status] || r.status]),
    textColumns: [1, 3, 10, 17, 18],
  };
}

/**
 * Master untuk sistem inventory / FMS / stock opname: hanya identitas STOCKABLE (Child SKU & bundle rakitan),
 * dengan konfigurasi batch/expiry, satuan stok/beli/jual, dan semua barcode yang dapat dipindai.
 * Parent SKU & bundle virtual tidak pernah muncul sebagai item stok (mencegah double counting).
 */
function exportInventoryMaster_() {
  const rows = sellables_({ statuses: INVENTORY_STATUSES }).filter((r) => r.stockable);
  const codes = {};
  db_('VARIANT_BARCODES')
    .filter((b) => b.Status === 'ACTIVE')
    .forEach((b) => {
      const k = b.BundleID || b.VariantID || (db_('UNIT_CONVERSIONS').byId(b.ConversionID) || {}).VariantID;
      const conv = b.ConversionID ? db_('UNIT_CONVERSIONS').byId(b.ConversionID) : null;
      (codes[k] = codes[k] || []).push(b.Code + (conv ? ' (' + conv.UnitName + ' ×' + conv.BaseUnitEquivalent + ')' : ''));
    });
  const packs = {};
  db_('UNIT_CONVERSIONS')
    .filter((c) => !c.IsBaseUnit && c.Status === STATUS.ACTIVE)
    .forEach((c) => (packs[c.VariantID] = (packs[c.VariantID] ? packs[c.VariantID] + '; ' : '') + c.UnitName + '=' + c.BaseUnitEquivalent));
  return {
    fileName: 'inventory-master-' + stamp_(),
    headers: ['Child SKU', 'Jenis', 'Parent SKU', 'Nama Barang', 'Brand', 'Kategori', 'Satuan Stok', 'Satuan Beli', 'Satuan Jual', 'Kemasan (= satuan stok)', 'Batch Tracking', 'Expiry Tracking', 'Masa Simpan (bulan)', 'Semua Barcode', 'SKU Lama', 'Status'],
    rows: rows.map((r) => [r.sku, r.kind === 'bundle' ? 'Bundle rakitan' : 'Child SKU', r.product_code, r.display_name, r.brand_name, r.category_name, r.base_unit, r.purchase_unit || r.base_unit, r.sales_unit || r.base_unit, packs[r.variant_id] || '', r.batch ? 'Ya' : 'Tidak', r.expiry ? 'Ya' : 'Tidak', r.shelf_life || '', (codes[r.bundle_id || r.variant_id] || []).join(', '), r.legacy_sku, STATUS_LABEL[r.status] || r.status]),
    textColumns: [0, 2, 13, 14],
    note: 'Hanya identitas stockable. Bundle virtual & Parent SKU tidak punya saldo stok — stok bundle virtual dihitung dari komponennya (lihat ekspor Bundle & BOM).',
  };
}

/** Seluruh konversi satuan per varian (termasuk kemasan operasional). */
function exportConversions_() {
  const prods = indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID');
  const variants = indexBy_(db_('PRODUCT_VARIANTS').rows(), 'VariantID');
  const brands = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const rows = db_('UNIT_CONVERSIONS')
    .rows()
    .filter((c) => c.Status !== STATUS.DELETED)
    .map((c) => {
      const p = prods[c.ProductID] || {};
      const v = variants[c.VariantID] || {};
      return [(brands[p.BrandID] || {}).BrandName, p.ProductCode, p.ProductName, v.VariantName, v.SKU, c.UnitName, c.ConversionFactor, c.ContainsUnit, c.BaseUnitEquivalent, p.BaseUnit, c.IsBaseUnit ? 'Satuan dasar' : c.IsTradeItem ? 'Kemasan ber-SKU' : 'Kemasan operasional', c.SKU, c.GTIN || c.InternalBarcode, c.EffectiveFrom || c.CreatedAt, STATUS_LABEL[c.Status] || c.Status];
    })
    .sort((a, b) => String(a[0] + a[2] + a[3]).localeCompare(String(b[0] + b[2] + b[3]), 'id') || a[8] - b[8]);
  return {
    fileName: 'konversi-satuan-' + stamp_(),
    headers: ['Brand', 'Parent SKU', 'Produk', 'Varian', 'Child SKU', 'Satuan', 'Isi', 'Satuan Isi', 'Ekuivalen Satuan Dasar', 'Satuan Dasar', 'Jenis', 'SKU Kemasan', 'Barcode Kemasan', 'Berlaku Sejak', 'Status'],
    rows,
    textColumns: [1, 4, 11, 12],
  };
}

function exportBundles_() {
  const rows = [];
  db_('BUNDLE_MASTERS')
    .rows()
    .forEach((b) => {
      const v = bundleView_(b);
      v.components.forEach((c) => rows.push([v.sku, v.name, v.typeLabel, v.stockMode === 'PREASSEMBLED' ? 'Dirakit (stockable)' : 'Virtual (non-stockable)', v.pickQuantity || '', c.sku, c.name, c.quantity, c.selectable ? 'Pilihan customer' : 'Tetap', v.barcode, STATUS_LABEL[v.status] || v.status]));
    });
  return { fileName: 'bundle-bom-' + stamp_(), headers: ['Bundle SKU', 'Nama Bundle', 'Jenis', 'Mode Stok', 'Jumlah Isi (request mix)', 'Komponen SKU', 'Nama Komponen', 'Jumlah', 'Sifat', 'Barcode Bundle', 'Status'], rows, textColumns: [0, 5, 9] };
}

function exportSuppliers_() {
  const ctx = supplierMapCtx_();
  const rows = db_('SUPPLIER_PRODUCT_MAPPING')
    .filter((m) => m.Status !== STATUS.DELETED)
    .map((m) => supplierMapView_(m, ctx))
    .map((m) => [m.supplierCode, m.supplierName, m.supplierProductCode, m.supplierProductName, m.sku, cleanText(m.productName + ' ' + m.variantName), m.purchaseUnit, m.conversionFactor, m.baseUnit, m.moq || '', m.specMismatch ? 'Perlu evaluasi: ' + m.specNote : '', STATUS_LABEL[m.status] || m.status]);
  return { fileName: 'supplier-sku-' + stamp_(), headers: ['Kode Supplier', 'Supplier', 'Kode Produk Supplier', 'Nama di Supplier', 'Child SKU', 'Nama Barang', 'Satuan Beli', 'Isi (Satuan Stok)', 'Satuan Stok', 'MOQ', 'Catatan Spesifikasi', 'Status'], rows, textColumns: [0, 2, 4] };
}

/** Mengembalikan baris tabel; file XLSX/CSV dibuat di browser (kolom SKU/Barcode tetap teks). */
function exportBeecloud_(user, p) {
  const confirmed = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.IsActive && m.System === 'beecloud' && m.MappingStatus === 'confirmed')
    .forEach((m) => (confirmed[m.BundleID || m.ConversionID || m.VariantID] = 1));
  const rows = sellables_({ withBundles: false }).filter((r) => !p.onlyUnsynced || !confirmed[r.conversion_id || r.variant_id]);
  if (p.markExported) {
    assertPerm_(user, 'mapping.write');
    rows.forEach((r) => {
      const t = r.conversion_id || r.variant_id;
      const m = db_('EXTERNAL_SKU_MAPPINGS').find((x) => (x.ConversionID || x.VariantID) === t && x.System === 'beecloud' && x.IsActive);
      if (!m)
        db_('EXTERNAL_SKU_MAPPINGS').insert({ MappingID: uuid_(), System: 'beecloud', ExternalSku: r.sku, ProductID: r.product_id, VariantID: r.conversion_id ? '' : r.variant_id, ConversionID: r.conversion_id, BundleID: '', InternalSku: r.sku, StoreAccount: '', MappingStatus: 'exported', IsActive: true, LastExportedAt: now_(), CreatedBy: user.email, CreatedAt: now_(), UpdatedAt: now_() });
      else db_('EXTERNAL_SKU_MAPPINGS').update(m, { MappingStatus: ['mapped', 'mismatch'].indexOf(m.MappingStatus) >= 0 ? 'exported' : m.MappingStatus, LastExportedAt: now_(), UpdatedAt: now_() });
    });
  }
  audit_(user.email, 'export.beecloud', 'export', '', null, { rows: rows.length, markExported: !!p.markExported });
  return {
    fileName: 'beecloud-import-' + stamp_(),
    headers: BEECLOUD_EXPORT_COLUMNS.map((c) => c[0]),
    rows: rows.map((r) => BEECLOUD_EXPORT_COLUMNS.map((c) => (r[c[1]] === null || r[c[1]] === undefined ? '' : r[c[1]]))),
    textColumns: [0, 4],
    note: 'Format kolom BELUM diverifikasi terhadap template import resmi BeeCloud. Status "Diekspor" ≠ sudah tersinkron.',
  };
}

function exportMappings_(system) {
  const rows = db_('EXTERNAL_SKU_MAPPINGS').filter((m) => m.IsActive && m.System === system);
  return {
    fileName: 'mapping-' + system + '-' + stamp_(),
    headers: ['Kanal', 'Toko/Akun', 'SKU Internal', 'Produk', 'ID Produk/Listing', 'ID Variasi', 'SKU Induk Listing', 'Seller SKU / Item Code', 'Nama Listing', 'Status', 'Terakhir Ekspor', 'Terakhir Konfirmasi', 'Catatan Error'],
    rows: rows.map((m) => {
      const v = mappingView_(m);
      return [v.channelLabel, v.storeAccount, v.internalSku, v.displayName, v.externalProductId, v.externalVariationId, v.externalParentSku, v.externalSku, v.listingName, v.status, v.lastExportedAt, v.lastConfirmedAt, v.lastError];
    }),
    textColumns: [2, 4, 5, 6, 7],
  };
}

function exportData_(user, p) {
  if (p.kind === 'beecloud') return exportBeecloud_(user, p);
  if (p.kind === 'conversions') return exportConversions_();
  if (p.kind === 'inventory') return exportInventoryMaster_();
  if (p.kind === 'bundles') return exportBundles_();
  if (p.kind === 'suppliers') return exportSuppliers_();
  if (p.kind === 'mappings') return exportMappings_(MAPPING_SYSTEMS.indexOf(p.system) >= 0 ? p.system : 'shopee');
  return exportMaster_();
}

/** Alternatif unduhan: tulis hasil ekspor ke tab baru di file database (kolom teks tetap teks). */
function exportToSheet_(user, p) {
  const d = exportData_(user, p);
  const name = ('Ekspor ' + d.fileName).slice(0, 90);
  const ss = ss_();
  const old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  const sh = ss.insertSheet(name);
  const rows = [d.headers].concat(d.rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : v))));
  (d.textColumns || []).forEach((c) => sh.getRange(1, c + 1, rows.length, 1).setNumberFormat('@'));
  sh.getRange(1, 1, rows.length, d.headers.length).setValues(rows);
  sh.getRange(1, 1, 1, d.headers.length).setFontWeight('bold').setBackground('#f1efe8');
  sh.setFrozenRows(1);
  audit_(user.email, 'export.to_sheet', 'export', '', null, { sheet: name, rows: d.rows.length });
  return { sheetName: name, rows: d.rows.length, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
}
