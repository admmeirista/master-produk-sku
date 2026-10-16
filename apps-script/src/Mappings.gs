/**
 * Mapping SKU internal ↔ BeeCloud / Shopee + ekspor.
 * Status dibedakan tegas: mapped (dipetakan) → exported (diekspor, belum terbukti) → confirmed (ada bukti
 * dari sistem eksternal) ; mismatch / error. Aplikasi TIDAK mengubah listing Shopee secara otomatis.
 */

function mappingList_(f) {
  const skus = {};
  db_('SKUs').rows().forEach((s) => (skus[s.id] = s));
  const q = String(f.search || '').toUpperCase();
  const rows = db_('Mappings')
    .filter((m) => m.is_active && (!f.system || m.system === f.system) && (!f.status || m.mapping_status === f.status))
    .map((m) => {
      const s = skus[m.sku_id] || {};
      return Object.assign({}, m, { sku_code: s.sku_code, display_name: s.display_name, product_id: s.product_id, sku_matches: String(m.external_sku || '').toUpperCase() === String(s.sku_code || '').toUpperCase() });
    })
    .filter((m) => !q || [m.sku_code, m.external_sku, m.external_product_id, m.display_name].join(' ').toUpperCase().indexOf(q) >= 0)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return paginate_(rows, f.page, 50);
}

function unmappedSkus_(system) {
  const mapped = {};
  db_('Mappings').filter((m) => m.system === system && m.is_active).forEach((m) => (mapped[m.sku_id] = 1));
  return db_('SKUs')
    .filter((s) => s.status === 'active' && !mapped[s.id])
    .slice(0, 500);
}

function createMapping_(user, input, status) {
  const s = db_('SKUs').byId(input.skuId);
  if (!s) throw new AppError('SKU tidak ditemukan');
  if (['draft', 'archived'].indexOf(s.status) >= 0) throw new AppError('Hanya SKU aktif/nonaktif yang dapat dipetakan');
  const system = input.system;
  if (['beecloud', 'shopee'].indexOf(system) < 0) throw new AppError('Sistem tidak dikenal');
  const pid = String(input.externalProductId || '').trim();
  const vid = String(input.externalVariationId || '').trim();
  if (system === 'shopee' && !/^\d+$/.test(pid)) throw new AppError('ID Produk Shopee wajib berupa angka');
  if (vid && !/^\d+$/.test(vid)) throw new AppError('ID Variasi Shopee harus berupa angka');
  const ext = String(input.externalSku || s.sku_code).trim().toUpperCase();
  const M = db_('Mappings');
  if (system === 'beecloud') {
    if (M.find((m) => m.system === 'beecloud' && m.is_active && m.sku_id === s.id)) throw new AppError('SKU ini sudah dipetakan ke BeeCloud', [], 'DUPLICATE');
    if (M.find((m) => m.system === 'beecloud' && m.is_active && String(m.external_sku).toUpperCase() === ext)) throw new AppError('SKU BeeCloud tersebut sudah dipetakan ke SKU lain', [], 'DUPLICATE');
  } else if (M.find((m) => m.system === 'shopee' && m.is_active && m.external_product_id === pid && (m.external_variation_id || '') === vid)) {
    throw new AppError('Listing/variasi Shopee tersebut sudah dipetakan', [], 'DUPLICATE');
  }
  const st = status || 'mapped';
  const rec = M.insert({
    id: uuid_(),
    sku_id: s.id,
    system,
    external_sku: ext,
    external_product_id: pid,
    external_variation_id: vid,
    listing_name: cleanText(input.listingName).slice(0, 300),
    mapping_status: st,
    is_active: true,
    last_confirmed_at: st === 'confirmed' ? now_() : '',
    notes: input.notes || '',
    created_by: user.email,
    created_at: now_(),
    updated_at: now_(),
  });
  audit_(user.email, 'mapping.create', 'mapping', rec.id, null, { sku: s.sku_code, system, ext, pid, vid, status: st });
  return rec;
}

function mappingAction_(user, id, action, note) {
  const m = db_('Mappings').byId(id);
  if (!m || !m.is_active) throw new AppError('Mapping tidak ditemukan');
  if (['confirm', 'mark_error', 'deactivate'].indexOf(action) >= 0 && !cleanText(note))
    throw new AppError('Catatan/bukti wajib diisi (mis. "dicek di BeeCloud 14/10, SKU tampil")');
  const s = db_('SKUs').byId(m.sku_id) || {};
  const before = Object.assign({}, m);
  const patch = { updated_at: now_(), notes: note || m.notes };
  if (action === 'mark_exported') Object.assign(patch, { mapping_status: 'exported', last_exported_at: now_() });
  else if (action === 'confirm') {
    if (m.system === 'beecloud' && String(m.external_sku).toUpperCase() !== String(s.sku_code).toUpperCase())
      throw new AppError(`SKU BeeCloud (${m.external_sku}) berbeda dari SKU internal (${s.sku_code}). Reset mapping dulu.`);
    Object.assign(patch, { mapping_status: 'confirmed', last_confirmed_at: now_(), last_error: '' });
  } else if (action === 'mark_error') Object.assign(patch, { mapping_status: 'error', last_error: note });
  else if (action === 'reset') Object.assign(patch, { mapping_status: 'mapped', last_error: '', external_sku: m.system === 'beecloud' ? s.sku_code : m.external_sku });
  else if (action === 'deactivate') patch.is_active = false;
  else throw new AppError('Aksi tidak dikenal');
  db_('Mappings').update(m, patch);
  audit_(user.email, 'mapping.' + action, 'mapping', id, before, m, note ? { note } : null);
  return m;
}

// ---------------------------------------------------------------- Ekspor

function skuExportRows_(onlyUnsynced, includeInactive) {
  const prods = {};
  db_('Products').rows().forEach((p) => (prods[p.id] = p));
  const brands = {};
  db_('Brands').rows().forEach((b) => (brands[b.id] = b));
  const cats = {};
  db_('Categories').rows().forEach((c) => (cats[c.id] = c));
  const varBc = {};
  const skuBc = {};
  db_('BarcodeAssignments')
    .filter((a) => !a.unassigned_at)
    .forEach((a) => (a.sku_id ? (skuBc[a.sku_id] = a.code) : (varBc[a.variant_id] = a.code)));
  const confirmed = {};
  const shopee = {};
  db_('Mappings')
    .filter((m) => m.is_active)
    .forEach((m) => {
      if (m.system === 'beecloud' && m.mapping_status === 'confirmed') confirmed[m.sku_id] = 1;
      if (m.system === 'shopee' && m.mapping_status === 'confirmed') shopee[m.sku_id] = 1;
    });
  return db_('SKUs')
    .filter((s) => s.sku_code && (includeInactive ? s.status !== 'archived' : s.status === 'active') && (!onlyUnsynced || !confirmed[s.id]))
    .map((s) => {
      const p = prods[s.product_id] || {};
      return Object.assign({}, s, {
        product_no: p.product_no,
        product_code: p.product_code,
        is_legacy: p.is_legacy,
        brand_name: (brands[p.brand_id] || {}).name,
        brand_code: (brands[p.brand_id] || {}).code,
        category_name: (cats[p.category_id] || {}).name,
        category_code: (cats[p.category_id] || {}).code,
        barcode: skuBc[s.id] || varBc[s.variant_id] || '',
        shopee_confirmed: !!shopee[s.id],
        opening_stock: '',
      });
    })
    .sort((a, b) => String(a.brand_name + a.display_name).localeCompare(String(b.brand_name + b.display_name)) || a.pack_qty - b.pack_qty);
}

/** Mengembalikan baris tabel; file XLSX/CSV dibuat di browser (kolom SKU/Barcode tetap teks). */
function exportBeecloud_(user, p) {
  const rows = skuExportRows_(!!p.onlyUnsynced, false);
  if (p.markExported) {
    assertPerm_(user, 'mapping.write');
    rows.forEach((r) => {
      const m = db_('Mappings').find((x) => x.sku_id === r.id && x.system === 'beecloud' && x.is_active);
      if (!m)
        db_('Mappings').insert({ id: uuid_(), sku_id: r.id, system: 'beecloud', external_sku: r.sku_code, mapping_status: 'exported', is_active: true, last_exported_at: now_(), created_by: user.email, created_at: now_(), updated_at: now_() });
      else db_('Mappings').update(m, { mapping_status: ['mapped', 'mismatch'].indexOf(m.mapping_status) >= 0 ? 'exported' : m.mapping_status, last_exported_at: now_(), updated_at: now_() });
    });
  }
  audit_(user.email, 'export.beecloud', 'export', '', null, { rows: rows.length, markExported: !!p.markExported });
  return {
    fileName: 'beecloud-import-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmm'),
    headers: BEECLOUD_EXPORT_COLUMNS.map((c) => c[0]),
    rows: rows.map((r) => BEECLOUD_EXPORT_COLUMNS.map((c) => (r[c[1]] === null || r[c[1]] === undefined ? '' : r[c[1]]))),
    textColumns: [0, 4],
    note: 'Format kolom BELUM diverifikasi terhadap template import resmi BeeCloud.',
  };
}

function exportMaster_() {
  const rows = skuExportRows_(false, true);
  return {
    fileName: 'master-produk-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmm'),
    headers: ['No', 'Nama Brand', 'Kode Brand', 'Nama Kategori', 'Kode Kategori', 'Kode Produk', 'GTIN/Barcode', 'Isi', 'SKU', 'Nama Produk Master', 'Satuan', 'Harga Beli', 'Harga Jual', 'Stok Awal', 'Sudah Disamakan di Shopee?', 'Keterangan', 'ID Produk Internal', 'Status SKU'],
    rows: rows.map((r, i) => [i + 1, r.brand_name, r.brand_code, r.category_name, r.category_code, r.product_code, r.barcode, r.pack_qty, r.sku_code, r.display_name, r.sales_unit, r.purchase_price === null ? '' : r.purchase_price, r.selling_price === null ? '' : r.selling_price, '', r.shopee_confirmed ? 'Sudah' : 'Belum', r.is_legacy ? 'Migrasi template lama' : '', productNoLabel(r.product_no), r.status]),
    textColumns: [6, 8],
  };
}

function exportMappings_(system) {
  const skus = {};
  db_('SKUs').rows().forEach((s) => (skus[s.id] = s));
  const rows = db_('Mappings').filter((m) => m.is_active && m.system === system);
  return {
    fileName: 'mapping-' + system,
    headers: ['SKU Internal', 'Nama', 'SKU Eksternal', 'ID Produk', 'ID Variasi', 'Nama Listing', 'Status', 'Terakhir Ekspor', 'Terakhir Konfirmasi', 'Catatan Error'],
    rows: rows.map((m) => [(skus[m.sku_id] || {}).sku_code, (skus[m.sku_id] || {}).display_name, m.external_sku, m.external_product_id, m.external_variation_id, m.listing_name, m.mapping_status, m.last_exported_at, m.last_confirmed_at, m.last_error]),
    textColumns: [0, 2, 3, 4],
  };
}

/** Alternatif unduhan: tulis hasil ekspor ke tab baru di spreadsheet ini (kolom teks tetap teks). */
function exportToSheet_(user, p) {
  const d = p.kind === 'beecloud' ? exportBeecloud_(user, p) : p.kind === 'mappings' ? exportMappings_(p.system || 'shopee') : exportMaster_();
  const name = ('Ekspor ' + d.fileName).slice(0, 90);
  const ss = ss_();
  const old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  const sh = ss.insertSheet(name);
  const rows = [d.headers].concat(d.rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : v))));
  const range = sh.getRange(1, 1, rows.length, d.headers.length);
  (d.textColumns || []).forEach((c) => sh.getRange(1, c + 1, rows.length, 1).setNumberFormat('@'));
  range.setValues(rows);
  sh.getRange(1, 1, 1, d.headers.length).setFontWeight('bold').setBackground('#e8eef7');
  sh.setFrozenRows(1);
  audit_(user.email, 'export.to_sheet', 'export', '', null, { sheet: name, rows: d.rows.length });
  return { sheetName: name, rows: d.rows.length, url: ss.getUrl ? ss.getUrl() + '#gid=' + sh.getSheetId() : '' };
}
