/**
 * Mapping SKU internal ↔ BeeCloud / Shopee + ekspor data master.
 * "Sellable" = SKU varian (unit dasar) + SKU kemasan yang menjadi trade item sendiri.
 * Status dibedakan tegas: mapped → exported (diekspor, belum terbukti) → confirmed (ada bukti dari sistem
 * eksternal) ; mismatch / error. Aplikasi TIDAK mengubah listing Shopee secara otomatis.
 */

/** Semua SKU yang bisa dijual, lengkap dengan konteks produk. */
function sellables_(opts) {
  opts = opts || {};
  const prods = indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID');
  const brands = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const cats = indexBy_(db_('MASTER_CATEGORIES').rows(), 'CategoryID');
  const variants = indexBy_(db_('PRODUCT_VARIANTS').rows(), 'VariantID');
  const out = [];
  const ctx = (pid) => {
    const p = prods[pid] || {};
    const b = brands[p.BrandID] || {};
    const c = cats[p.CategoryID] || {};
    return { product_id: pid, product_no: productNoLabel(p.ProductNo), product_name: p.ProductName, product_code: p.ProductCode, product_status: p.Status, base_unit: p.BaseUnit, brand_name: b.BrandName, brand_code: b.BrandCode, category_name: c.CategoryName, category_code: c.CategoryCode };
  };
  const live = (pStatus, ...st) => opts.includeInactive || (pStatus === STATUS.ACTIVE && st.every((s) => s === STATUS.ACTIVE));
  db_('PRODUCT_VARIANTS')
    .rows()
    .forEach((v) => {
      if (!v.SKU) return;
      const c = ctx(v.ProductID);
      if (!live(c.product_status, v.Status)) return;
      out.push(Object.assign(c, { kind: 'variant', sku: v.SKU, variant_id: v.VariantID, variant_name: v.VariantName, attributes: (v.VariantAttributes || []).map((a) => a.name + ': ' + a.value).join(', '), display_name: cleanText(c.product_name + (v.IsDefault ? '' : ' ' + v.VariantName)), unit: c.base_unit, base_qty: 1, barcode: v.GTIN || v.InternalBarcode || '', barcode_type: v.GTIN ? 'GTIN' : v.InternalBarcode ? 'Internal' : '', status: c.product_status === STATUS.ACTIVE ? v.Status : STATUS.INACTIVE }));
    });
  db_('UNIT_CONVERSIONS')
    .rows()
    .forEach((u) => {
      if (!u.SKU) return;
      const v = variants[u.VariantID] || {};
      const c = ctx(u.ProductID);
      if (!live(c.product_status, v.Status, u.Status)) return;
      out.push(Object.assign(c, { kind: 'pack', sku: u.SKU, variant_id: u.VariantID, variant_name: v.VariantName, attributes: (v.VariantAttributes || []).map((a) => a.name + ': ' + a.value).join(', '), display_name: cleanText(c.product_name + (v.IsDefault ? '' : ' ' + v.VariantName) + ' - ' + u.UnitName + ' isi ' + u.BaseUnitEquivalent + ' ' + c.base_unit), unit: u.UnitName, base_qty: u.BaseUnitEquivalent, barcode: u.GTIN || u.InternalBarcode || '', barcode_type: u.GTIN ? 'GTIN' : u.InternalBarcode ? 'Internal' : '', status: c.product_status === STATUS.ACTIVE && v.Status === STATUS.ACTIVE ? u.Status : STATUS.INACTIVE }));
    });
  return out.sort((a, b) => String(a.brand_name + a.display_name).localeCompare(String(b.brand_name + b.display_name), 'id') || a.base_qty - b.base_qty);
}

function mappingList_(f) {
  f = f || {};
  const bySku = {};
  sellables_({ includeInactive: true }).forEach((s) => (bySku[s.sku.toUpperCase()] = s));
  const q = String(f.search || '').toUpperCase();
  const rows = db_('SKU_MAPPINGS')
    .filter((m) => m.IsActive && (!f.system || m.System === f.system) && (!f.status || m.MappingStatus === f.status))
    .map((m) => {
      const s = bySku[String(m.SKU).toUpperCase()] || {};
      return { id: m.MappingID, sku: m.SKU, system: m.System, externalSku: m.ExternalSku, externalProductId: m.ExternalProductId, externalVariationId: m.ExternalVariationId, listingName: m.ListingName, status: m.MappingStatus, lastError: m.LastError, notes: m.Notes, updatedAt: m.UpdatedAt, displayName: s.display_name, productId: s.product_id, skuMatches: String(m.ExternalSku || '').toUpperCase() === String(m.SKU).toUpperCase() };
    })
    .filter((m) => !q || [m.sku, m.externalSku, m.externalProductId, m.displayName, m.listingName].join(' ').toUpperCase().indexOf(q) >= 0)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return paginate_(rows, f.page, 50);
}

function unmappedSkus_(system, search) {
  const mapped = {};
  db_('SKU_MAPPINGS')
    .filter((m) => m.System === system && m.IsActive)
    .forEach((m) => (mapped[String(m.SKU).toUpperCase()] = 1));
  const q = String(search || '').toUpperCase();
  return sellables_()
    .filter((s) => !mapped[s.sku.toUpperCase()])
    .filter((s) => !q || (s.sku + ' ' + s.display_name + ' ' + s.barcode).toUpperCase().indexOf(q) >= 0)
    .slice(0, 50)
    .map((s) => ({ sku: s.sku, displayName: s.display_name, barcode: s.barcode, kind: s.kind }));
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
  const M = db_('SKU_MAPPINGS');
  if (system === 'beecloud') {
    if (M.find((m) => m.System === 'beecloud' && m.IsActive && String(m.SKU).toUpperCase() === sku)) throw new AppError('SKU ini sudah dipetakan ke BeeCloud', [], 'DUPLICATE');
    if (M.find((m) => m.System === 'beecloud' && m.IsActive && String(m.ExternalSku).toUpperCase() === ext)) throw new AppError('SKU BeeCloud tersebut sudah dipetakan ke SKU lain', [], 'DUPLICATE');
  } else if (M.find((m) => m.System === 'shopee' && m.IsActive && m.ExternalProductId === pid && (m.ExternalVariationId || '') === vid)) {
    throw new AppError('Listing/variasi Shopee tersebut sudah dipetakan', [], 'DUPLICATE');
  }
  const rec = M.insert({
    MappingID: uuid_(),
    SKU: s.sku,
    System: system,
    ExternalSku: ext,
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
  audit_(user.email, 'mapping.create', 'mapping', rec.MappingID, null, { sku: s.sku, system, ext, pid, vid });
  return { id: rec.MappingID };
}

function mappingAction_(user, id, action, note) {
  const m = db_('SKU_MAPPINGS').byId(id);
  if (!m || !m.IsActive) throw new AppError('Mapping tidak ditemukan');
  if (['confirm', 'mark_error', 'deactivate'].indexOf(action) >= 0 && !cleanText(note)) throw new AppError('Catatan/bukti wajib diisi (mis. "dicek di BeeCloud 14/10, SKU tampil")');
  const before = { status: m.MappingStatus, externalSku: m.ExternalSku };
  const patch = { UpdatedAt: now_(), Notes: cleanText(note) || m.Notes };
  if (action === 'mark_exported') Object.assign(patch, { MappingStatus: 'exported', LastExportedAt: now_() });
  else if (action === 'confirm') {
    if (m.System === 'beecloud' && String(m.ExternalSku).toUpperCase() !== String(m.SKU).toUpperCase()) throw new AppError(`SKU BeeCloud (${m.ExternalSku}) berbeda dari SKU internal (${m.SKU}). Reset mapping dulu.`);
    Object.assign(patch, { MappingStatus: 'confirmed', LastConfirmedAt: now_(), LastError: '' });
  } else if (action === 'mark_error') Object.assign(patch, { MappingStatus: 'error', LastError: cleanText(note) });
  else if (action === 'reset') Object.assign(patch, { MappingStatus: 'mapped', LastError: '', ExternalSku: m.System === 'beecloud' ? m.SKU : m.ExternalSku });
  else if (action === 'deactivate') patch.IsActive = false;
  else throw new AppError('Aksi tidak dikenal');
  db_('SKU_MAPPINGS').update(m, patch);
  audit_(user.email, 'mapping.' + action, 'mapping', id, before, { status: m.MappingStatus, externalSku: m.ExternalSku }, note ? { note } : null);
  return { id, status: m.MappingStatus };
}

// ---------------------------------------------------------------- Ekspor

function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmm');
}

/** Master per SKU (varian + kemasan ber-SKU). */
function exportMaster_() {
  const rows = sellables_({ includeInactive: true });
  return {
    fileName: 'master-produk-sku-' + stamp_(),
    headers: ['No', 'SKU', 'Jenis SKU', 'Nama Produk', 'Varian', 'Atribut', 'Satuan', 'Isi (Satuan Dasar)', 'Satuan Dasar', 'Barcode', 'Jenis Barcode', 'Brand', 'Kode Brand', 'Kategori', 'Kode Kategori', 'Kode Produk', 'No Produk', 'Status'],
    rows: rows.map((r, i) => [i + 1, r.sku, r.kind === 'pack' ? 'Kemasan' : 'Varian', r.product_name, r.variant_name, r.attributes, r.unit, r.base_qty, r.base_unit, r.barcode, r.barcode_type, r.brand_name, r.brand_code, r.category_name, r.category_code, r.product_code, r.product_no, STATUS_LABEL[r.status] || r.status]),
    textColumns: [1, 9, 15],
  };
}

/** Seluruh konversi satuan per varian (termasuk kemasan operasional). */
function exportConversions_() {
  const prods = indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID');
  const variants = indexBy_(db_('PRODUCT_VARIANTS').rows(), 'VariantID');
  const brands = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const rows = db_('UNIT_CONVERSIONS')
    .rows()
    .map((c) => {
      const p = prods[c.ProductID] || {};
      const v = variants[c.VariantID] || {};
      return [(brands[p.BrandID] || {}).BrandName, p.ProductName, v.VariantName, v.SKU, c.UnitName, c.ConversionFactor, c.ContainsUnit, c.BaseUnitEquivalent, p.BaseUnit, c.IsBaseUnit ? 'Satuan dasar' : c.IsTradeItem ? 'Kemasan ber-SKU' : 'Kemasan operasional', c.SKU, c.GTIN || c.InternalBarcode, STATUS_LABEL[c.Status] || c.Status];
    })
    .sort((a, b) => String(a[0] + a[1] + a[2]).localeCompare(String(b[0] + b[1] + b[2]), 'id') || a[7] - b[7]);
  return {
    fileName: 'konversi-satuan-' + stamp_(),
    headers: ['Brand', 'Produk', 'Varian', 'SKU Varian', 'Satuan', 'Isi', 'Satuan Isi', 'Ekuivalen Satuan Dasar', 'Satuan Dasar', 'Jenis', 'SKU Kemasan', 'Barcode Kemasan', 'Status'],
    rows,
    textColumns: [3, 10, 11],
  };
}

/** Mengembalikan baris tabel; file XLSX/CSV dibuat di browser (kolom SKU/Barcode tetap teks). */
function exportBeecloud_(user, p) {
  const confirmed = {};
  db_('SKU_MAPPINGS')
    .filter((m) => m.IsActive && m.System === 'beecloud' && m.MappingStatus === 'confirmed')
    .forEach((m) => (confirmed[String(m.SKU).toUpperCase()] = 1));
  const rows = sellables_().filter((r) => !p.onlyUnsynced || !confirmed[r.sku.toUpperCase()]);
  if (p.markExported) {
    assertPerm_(user, 'mapping.write');
    rows.forEach((r) => {
      const m = db_('SKU_MAPPINGS').find((x) => String(x.SKU).toUpperCase() === r.sku.toUpperCase() && x.System === 'beecloud' && x.IsActive);
      if (!m)
        db_('SKU_MAPPINGS').insert({ MappingID: uuid_(), SKU: r.sku, System: 'beecloud', ExternalSku: r.sku, MappingStatus: 'exported', IsActive: true, LastExportedAt: now_(), CreatedBy: user.email, CreatedAt: now_(), UpdatedAt: now_() });
      else db_('SKU_MAPPINGS').update(m, { MappingStatus: ['mapped', 'mismatch'].indexOf(m.MappingStatus) >= 0 ? 'exported' : m.MappingStatus, LastExportedAt: now_(), UpdatedAt: now_() });
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
  const rows = db_('SKU_MAPPINGS').filter((m) => m.IsActive && m.System === system);
  return {
    fileName: 'mapping-' + system + '-' + stamp_(),
    headers: ['SKU Internal', 'SKU Eksternal', 'ID Produk', 'ID Variasi', 'Nama Listing', 'Status', 'Terakhir Ekspor', 'Terakhir Konfirmasi', 'Catatan Error'],
    rows: rows.map((m) => [m.SKU, m.ExternalSku, m.ExternalProductId, m.ExternalVariationId, m.ListingName, m.MappingStatus, m.LastExportedAt, m.LastConfirmedAt, m.LastError]),
    textColumns: [0, 1, 2, 3],
  };
}

function exportData_(user, p) {
  if (p.kind === 'beecloud') return exportBeecloud_(user, p);
  if (p.kind === 'conversions') return exportConversions_();
  if (p.kind === 'mappings') return exportMappings_(p.system || 'shopee');
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
