/**
 * EXTERNAL_SKU_MAPPINGS — kode di luar SKU internal, dipetakan ke VariantID / ConversionID (ID permanen):
 *   - legacy   : SKU format lama (mis. PRB-BSR-GH180-8999225912415-1) — tetap bisa ditelusuri & dipindai
 *   - beecloud : SKU di BeeCloud
 *   - shopee   : Seller SKU / ID listing & variasi Shopee
 * Status BeeCloud/Shopee: mapped → exported (belum terbukti) → confirmed (ada bukti) ; mismatch / error.
 * Aplikasi TIDAK mengubah listing Shopee secara otomatis.
 */

const MAPPING_SYSTEMS = ['legacy', 'beecloud', 'shopee'];

/** Semua SKU yang bisa dijual (SKU varian + SKU kemasan trade item), lengkap dengan konteks produk. */
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
      const k = m.ConversionID || m.VariantID;
      legacy[k] = (legacy[k] ? legacy[k] + ', ' : '') + m.ExternalSku;
    });
  const out = [];
  const ctx = (pid) => {
    const p = prods[pid] || {};
    const b = brands[p.BrandID] || {};
    const c = cats[p.CategoryID] || {};
    return { product_id: pid, product_code: p.ProductCode, legacy_code: p.LegacyCode || '', product_name: p.ProductName, product_status: p.Status, base_unit: p.BaseUnit, brand_name: b.BrandName, brand_code: b.BrandCode, category_name: c.CategoryName, category_code: c.CategoryCode };
  };
  const live = (pStatus, ...st) => opts.includeInactive || (pStatus === STATUS.ACTIVE && st.every((s) => s === STATUS.ACTIVE));
  const attrText = (vid) => (attrs[vid] || []).map((a) => a.name + ': ' + a.value).join(', ');
  db_('PRODUCT_VARIANTS')
    .rows()
    .forEach((v) => {
      if (!v.SKU) return;
      const c = ctx(v.ProductID);
      if (!live(c.product_status, v.Status)) return;
      out.push(Object.assign(c, { kind: 'variant', sku: v.SKU, variant_id: v.VariantID, conversion_id: '', variant_name: v.IsDefault ? '' : v.VariantName, attributes: attrText(v.VariantID), display_name: cleanText(c.product_name + (v.IsDefault ? '' : ' ' + v.VariantName)), unit: c.base_unit, base_qty: 1, barcode: v.GTIN || v.InternalBarcode || '', barcode_type: v.GTIN ? 'GTIN' : v.InternalBarcode ? 'Internal' : '', legacy_sku: legacy[v.VariantID] || '', status: c.product_status === STATUS.ACTIVE ? v.Status : STATUS.INACTIVE }));
    });
  db_('UNIT_CONVERSIONS')
    .rows()
    .forEach((u) => {
      if (!u.SKU || u.Status === STATUS.DELETED) return;
      const v = variants[u.VariantID] || {};
      const c = ctx(u.ProductID);
      if (!live(c.product_status, v.Status, u.Status)) return;
      out.push(Object.assign(c, { kind: 'pack', sku: u.SKU, variant_id: u.VariantID, conversion_id: u.ConversionID, variant_name: v.IsDefault ? '' : v.VariantName, attributes: attrText(u.VariantID), display_name: cleanText(c.product_name + (v.IsDefault ? '' : ' ' + v.VariantName) + ' - ' + u.UnitName + ' isi ' + u.BaseUnitEquivalent + ' ' + c.base_unit), unit: u.UnitName, base_qty: u.BaseUnitEquivalent, barcode: u.GTIN || u.InternalBarcode || '', barcode_type: u.GTIN ? 'GTIN' : u.InternalBarcode ? 'Internal' : '', legacy_sku: legacy[u.ConversionID] || '', status: c.product_status === STATUS.ACTIVE && v.Status === STATUS.ACTIVE ? u.Status : STATUS.INACTIVE }));
    });
  return out.sort((a, b) => String(a.brand_name + a.display_name).localeCompare(String(b.brand_name + b.display_name), 'id') || a.base_qty - b.base_qty);
}

/** Label target pemetaan (varian / kemasan) dari ID. */
function mappingTarget_(m) {
  const conv = m.ConversionID ? db_('UNIT_CONVERSIONS').byId(m.ConversionID) : null;
  const v = db_('PRODUCT_VARIANTS').byId(m.VariantID || (conv && conv.VariantID));
  const p = v ? db_('MASTER_PRODUCTS').byId(v.ProductID) : null;
  return {
    productId: p ? p.ProductID : '',
    internalSku: conv ? conv.SKU || '' : v ? v.SKU : '',
    displayName: p ? cleanText(p.ProductName + (v.IsDefault ? '' : ' ' + v.VariantName) + (conv ? ' - ' + conv.UnitName + ' isi ' + conv.BaseUnitEquivalent : '')) : '',
  };
}

function mappingList_(f) {
  f = f || {};
  const q = String(f.search || '').toUpperCase();
  const rows = db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.IsActive && (!f.system || m.System === f.system) && (!f.status || m.MappingStatus === f.status))
    .map((m) => {
      const t = mappingTarget_(m);
      return { id: m.MappingID, system: m.System, externalSku: m.ExternalSku, internalSku: t.internalSku, externalProductId: m.ExternalProductId, externalVariationId: m.ExternalVariationId, listingName: m.ListingName, status: m.MappingStatus, lastError: m.LastError, notes: m.Notes, updatedAt: m.UpdatedAt, displayName: t.displayName, productId: t.productId, skuMatches: String(m.ExternalSku || '').toUpperCase() === String(t.internalSku).toUpperCase() };
    })
    .filter((m) => !q || [m.internalSku, m.externalSku, m.externalProductId, m.displayName, m.listingName].join(' ').toUpperCase().indexOf(q) >= 0)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return paginate_(rows, f.page, 50);
}

function unmappedSkus_(system, search) {
  const mapped = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.System === system && m.IsActive)
    .forEach((m) => (mapped[m.ConversionID || m.VariantID] = 1));
  const q = String(search || '').toUpperCase();
  return sellables_()
    .filter((s) => !mapped[s.conversion_id || s.variant_id])
    .filter((s) => !q || (s.sku + ' ' + s.display_name + ' ' + s.barcode + ' ' + s.legacy_sku).toUpperCase().indexOf(q) >= 0)
    .slice(0, 50)
    .map((s) => ({ sku: s.sku, displayName: s.display_name, barcode: s.barcode, kind: s.kind, legacySku: s.legacy_sku }));
}

function createMapping_(user, input) {
  const sku = String(input.sku || '').trim().toUpperCase();
  const s = sellables_({ includeInactive: true }).find((x) => x.sku.toUpperCase() === sku);
  if (!s) throw new AppError('SKU tidak ditemukan');
  const system = input.system;
  if (['beecloud', 'shopee'].indexOf(system) < 0) throw new AppError('Sistem tidak dikenal');
  const pid = String(input.externalProductId || '').trim();
  const vid = String(input.externalVariationId || '').trim();
  if (system === 'shopee' && !/^\d+$/.test(pid)) throw new AppError('ID Produk Shopee wajib berupa angka');
  if (vid && !/^\d+$/.test(vid)) throw new AppError('ID Variasi Shopee harus berupa angka');
  const ext = String(input.externalSku || s.sku).trim().toUpperCase();
  const M = db_('EXTERNAL_SKU_MAPPINGS');
  const target = s.conversion_id || s.variant_id;
  if (system === 'beecloud') {
    if (M.find((m) => m.System === 'beecloud' && m.IsActive && (m.ConversionID || m.VariantID) === target)) throw new AppError('SKU ini sudah dipetakan ke BeeCloud', [], 'DUPLICATE');
    if (M.find((m) => m.System === 'beecloud' && m.IsActive && String(m.ExternalSku).toUpperCase() === ext)) throw new AppError('SKU BeeCloud tersebut sudah dipetakan ke SKU lain', [], 'DUPLICATE');
  } else if (M.find((m) => m.System === 'shopee' && m.IsActive && m.ExternalProductId === pid && (m.ExternalVariationId || '') === vid)) {
    throw new AppError('Listing/variasi Shopee tersebut sudah dipetakan', [], 'DUPLICATE');
  }
  const rec = M.insert({
    MappingID: uuid_(),
    System: system,
    ExternalSku: ext,
    ProductID: s.product_id,
    VariantID: s.conversion_id ? '' : s.variant_id,
    ConversionID: s.conversion_id || '',
    InternalSku: s.sku,
    ExternalProductId: pid,
    ExternalVariationId: vid,
    ListingName: cleanText(input.listingName).slice(0, 300),
    MappingStatus: 'mapped',
    IsActive: true,
    Notes: cleanText(input.notes),
    CreatedBy: user.email,
    CreatedAt: now_(),
    UpdatedAt: now_(),
  });
  audit_(user.email, 'mapping.create', 'mapping', rec.MappingID, null, { sku: s.sku, system, ext, pid, vid }, { productId: s.product_id });
  return { id: rec.MappingID };
}

function mappingAction_(user, id, action, note) {
  const m = db_('EXTERNAL_SKU_MAPPINGS').byId(id);
  if (!m || !m.IsActive) throw new AppError('Mapping tidak ditemukan');
  if (m.System === 'legacy' && action !== 'deactivate') throw new AppError('SKU lama hanya untuk penelusuran — tidak memiliki status sinkronisasi');
  if (['confirm', 'mark_error', 'deactivate'].indexOf(action) >= 0 && !cleanText(note)) throw new AppError('Catatan/bukti wajib diisi (mis. "dicek di BeeCloud 14/10, SKU tampil")');
  const internal = mappingTarget_(m).internalSku;
  const before = { status: m.MappingStatus, externalSku: m.ExternalSku };
  const patch = { UpdatedAt: now_(), Notes: cleanText(note) || m.Notes };
  if (action === 'mark_exported') Object.assign(patch, { MappingStatus: 'exported', LastExportedAt: now_() });
  else if (action === 'confirm') {
    if (m.System === 'beecloud' && String(m.ExternalSku).toUpperCase() !== String(internal).toUpperCase()) throw new AppError(`SKU BeeCloud (${m.ExternalSku}) berbeda dari SKU internal (${internal}). Reset mapping dulu.`);
    Object.assign(patch, { MappingStatus: 'confirmed', LastConfirmedAt: now_(), LastError: '' });
  } else if (action === 'mark_error') Object.assign(patch, { MappingStatus: 'error', LastError: cleanText(note) });
  else if (action === 'reset') Object.assign(patch, { MappingStatus: 'mapped', LastError: '', ExternalSku: m.System === 'beecloud' ? internal : m.ExternalSku });
  else if (action === 'deactivate') patch.IsActive = false;
  else throw new AppError('Aksi tidak dikenal');
  db_('EXTERNAL_SKU_MAPPINGS').update(m, patch);
  audit_(user.email, 'mapping.' + action, 'mapping', id, before, { status: m.MappingStatus, externalSku: m.ExternalSku }, Object.assign({ productId: m.ProductID }, note ? { note } : {}));
  return { id, status: m.MappingStatus };
}

// ---------------------------------------------------------------- Ekspor

function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmm');
}

/** Master per SKU (varian + kemasan ber-SKU) termasuk SKU lama untuk penelusuran. */
function exportMaster_() {
  const rows = sellables_({ includeInactive: true });
  return {
    fileName: 'master-produk-sku-' + stamp_(),
    headers: ['No', 'SKU', 'Jenis SKU', 'Kode Produk', 'Nama Produk', 'Varian', 'Atribut', 'Satuan', 'Isi (Satuan Dasar)', 'Satuan Dasar', 'Barcode', 'Jenis Barcode', 'Brand', 'Kode Brand', 'Kategori', 'Kode Kategori', 'SKU Lama', 'Kode Produk Lama', 'Status'],
    rows: rows.map((r, i) => [i + 1, r.sku, r.kind === 'pack' ? 'Kemasan' : 'Varian', r.product_code, r.product_name, r.variant_name, r.attributes, r.unit, r.base_qty, r.base_unit, r.barcode, r.barcode_type, r.brand_name, r.brand_code, r.category_name, r.category_code, r.legacy_sku, r.legacy_code, STATUS_LABEL[r.status] || r.status]),
    textColumns: [1, 3, 10, 16, 17],
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
      return [(brands[p.BrandID] || {}).BrandName, p.ProductCode, p.ProductName, v.VariantName, v.SKU, c.UnitName, c.ConversionFactor, c.ContainsUnit, c.BaseUnitEquivalent, p.BaseUnit, c.IsBaseUnit ? 'Satuan dasar' : c.IsTradeItem ? 'Kemasan ber-SKU' : 'Kemasan operasional', c.SKU, c.GTIN || c.InternalBarcode, STATUS_LABEL[c.Status] || c.Status];
    })
    .sort((a, b) => String(a[0] + a[2] + a[3]).localeCompare(String(b[0] + b[2] + b[3]), 'id') || a[8] - b[8]);
  return {
    fileName: 'konversi-satuan-' + stamp_(),
    headers: ['Brand', 'Kode Produk', 'Produk', 'Varian', 'SKU Varian', 'Satuan', 'Isi', 'Satuan Isi', 'Ekuivalen Satuan Dasar', 'Satuan Dasar', 'Jenis', 'SKU Kemasan', 'Barcode Kemasan', 'Status'],
    rows,
    textColumns: [1, 4, 11, 12],
  };
}

/** Mengembalikan baris tabel; file XLSX/CSV dibuat di browser (kolom SKU/Barcode tetap teks). */
function exportBeecloud_(user, p) {
  const confirmed = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.IsActive && m.System === 'beecloud' && m.MappingStatus === 'confirmed')
    .forEach((m) => (confirmed[m.ConversionID || m.VariantID] = 1));
  const rows = sellables_().filter((r) => !p.onlyUnsynced || !confirmed[r.conversion_id || r.variant_id]);
  if (p.markExported) {
    assertPerm_(user, 'mapping.write');
    rows.forEach((r) => {
      const t = r.conversion_id || r.variant_id;
      const m = db_('EXTERNAL_SKU_MAPPINGS').find((x) => (x.ConversionID || x.VariantID) === t && x.System === 'beecloud' && x.IsActive);
      if (!m)
        db_('EXTERNAL_SKU_MAPPINGS').insert({ MappingID: uuid_(), System: 'beecloud', ExternalSku: r.sku, ProductID: r.product_id, VariantID: r.conversion_id ? '' : r.variant_id, ConversionID: r.conversion_id, InternalSku: r.sku, MappingStatus: 'exported', IsActive: true, LastExportedAt: now_(), CreatedBy: user.email, CreatedAt: now_(), UpdatedAt: now_() });
      else db_('EXTERNAL_SKU_MAPPINGS').update(m, { MappingStatus: ['mapped', 'mismatch'].indexOf(m.MappingStatus) >= 0 ? 'exported' : m.MappingStatus, LastExportedAt: now_(), UpdatedAt: now_() });
    });
  }
  audit_(user.email, 'export.beecloud', 'export', '', null, { rows: rows.length, markExported: !!p.markExported });
  return {
    fileName: 'beecloud-import-' + stamp_(),
    headers: BEECLOUD_EXPORT_COLUMNS.map((c) => c[0]),
    rows: rows.map((r) => BEECLOUD_EXPORT_COLUMNS.map((c) => (r[c[1]] === null || r[c[1]] === undefined ? '' : r[c[1]]))),
    textColumns: [0, 4],
    note: 'Format kolom BELUM diverifikasi terhadap template import resmi BeeCloud.',
  };
}

function exportMappings_(system) {
  const rows = db_('EXTERNAL_SKU_MAPPINGS').filter((m) => m.IsActive && m.System === system);
  return {
    fileName: 'mapping-' + system + '-' + stamp_(),
    headers: ['SKU Internal', 'Produk', 'SKU Eksternal', 'ID Produk', 'ID Variasi', 'Nama Listing', 'Status', 'Terakhir Ekspor', 'Terakhir Konfirmasi', 'Catatan Error'],
    rows: rows.map((m) => {
      const t = mappingTarget_(m);
      return [t.internalSku, t.displayName, m.ExternalSku, m.ExternalProductId, m.ExternalVariationId, m.ListingName, m.MappingStatus, m.LastExportedAt, m.LastConfirmedAt, m.LastError];
    }),
    textColumns: [0, 2, 3, 4],
  };
}

function exportData_(user, p) {
  if (p.kind === 'beecloud') return exportBeecloud_(user, p);
  if (p.kind === 'conversions') return exportConversions_();
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
