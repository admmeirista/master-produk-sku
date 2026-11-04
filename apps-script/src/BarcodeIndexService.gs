/**
 * Pencocokan barcode cepat (scan HP & cari kode).
 * barcodeLookup_ lama membaca 7 tab penuh setiap scan. Di sini semua kode (GTIN, barcode internal, Kode SKU Produk,
 * SKU Parent, SKU kemasan, SKU kanal/lama, SKU bundle) disusun SEKALI menjadi indeks yang di-cache per versi data
 * (versi naik otomatis setiap ada perubahan data produk), lalu setiap scan cukup membaca cache.
 *
 * Hasil identik dengan barcodeLookup_ (diuji di test). Kasus yang jarang & butuh rincian tambahan — konflik
 * (satu barcode aktif di >1 barang), barcode pensiun, barcode dicadangkan, pencarian nama — tetap memakai
 * barcodeLookup_ yang lengkap. Hanya untuk aksi baca: di dalam transaksi tulis tetap pakai barcodeLookup_.
 */

const BARCODE_INDEX_KEY_ = 'bx1:';

function barcodeIndex_() {
  const key = BARCODE_INDEX_KEY_ + dataVersion_();
  const hit = cacheGetBig_(key);
  if (hit) return hit;
  const P = indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID');
  const Bn = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const up = (s) => String(s || '').toUpperCase();
  const idx = { rows: {}, vsku: {}, pcode: {}, csku: {}, ext: {}, bsku: {}, V: {}, C: {}, B: {} };
  const add = (m, k, val) => (m[k] = m[k] || []).push(val);
  // kartu SKU Produk (hanya yang tidak dihapus & produknya tidak dihapus) — sama dengan push() di barcodeLookup_
  const vars = db_('PRODUCT_VARIANTS').rows();
  vars.forEach((v) => {
    const p = P[v.ProductID];
    if (v.Status === STATUS.DELETED || !p || p.Status === STATUS.DELETED) return;
    const b = Bn[p.BrandID] || {};
    idx.V[v.VariantID] = { productId: p.ProductID, productCode: p.ProductCode, parentSku: p.ProductCode, productName: p.ProductName, productStatus: p.Status, brandName: b.BrandName, variantId: v.VariantID, variantName: v.IsDefault ? '' : v.VariantName, skuName: variantDisplayName_(v) || cleanText(p.ProductName + ' ' + (v.IsDefault ? '' : v.VariantName)), imageUrl: v.ImageUrl || '', variantStatus: v.Status, sku: v.SKU, childSku: v.SKU, gtin: v.GTIN, internalBarcode: v.InternalBarcode, baseUnit: v.BaseUnit || p.BaseUnit };
  });
  vars.filter((v) => v.SKU).forEach((v) => add(idx.vsku, up(v.SKU), v.VariantID));
  const byProduct = {};
  vars.slice().sort((a, b) => a.SortOrder - b.SortOrder).forEach((v) => add(byProduct, v.ProductID, v.VariantID));
  Object.keys(P).forEach((pid) => add(idx.pcode, up(P[pid].ProductCode), byProduct[pid] || []));
  db_('UNIT_CONVERSIONS')
    .rows()
    .forEach((c) => {
      idx.C[c.ConversionID] = { variantId: c.VariantID, unitName: c.UnitName, baseUnitEquivalent: c.BaseUnitEquivalent, sku: c.SKU, gtin: c.GTIN, internalBarcode: c.InternalBarcode };
      if (c.SKU) add(idx.csku, up(c.SKU), c.ConversionID);
    });
  db_('VARIANT_BARCODES')
    .rows()
    .forEach((b) => b.Code && add(idx.rows, b.Code, { s: b.Status, t: b.BarcodeType, v: b.VariantID || '', c: b.ConversionID || '', b: b.BundleID || '', n: b.Notes || '' }));
  db_('BUNDLE_MASTERS')
    .rows()
    .forEach((b) => {
      idx.B[b.BundleID] = { bundleId: b.BundleID, bundleSku: b.BundleSKU, bundleName: b.BundleName, type: b.BundleType, stockMode: b.StockMode, status: b.Status };
      add(idx.bsku, up(b.BundleSKU), b.BundleID);
    });
  db_('EXTERNAL_SKU_MAPPINGS')
    .rows()
    .forEach((m) => m.IsActive && add(idx.ext, up(m.ExternalSku), { via: m.System === 'legacy' ? 'SKU lama' : 'SKU ' + (CHANNEL_LABEL[m.System] || m.System), v: m.VariantID || '', c: m.ConversionID || '', b: m.BundleID || '' }));
  cachePutBig_(key, idx);
  return idx;
}

/** Sama dengan barcodeLookup_(raw), tetapi dari indeks cache. */
function barcodeLookupFast_(raw) {
  const code = cleanBarcode(raw);
  const up = String(raw || '').trim().toUpperCase();
  if (!code && !up) throw new AppError('Scan atau ketik barcode / SKU');
  const X = barcodeIndex_();
  const rowsAll = (code && X.rows[code]) || [];
  const liveRows = rowsAll.filter((b) => b.s === 'ACTIVE' || b.s === 'ALLOCATED');
  const activeRows = liveRows.filter((b) => b.s === 'ACTIVE');
  if (activeRows.length > 1) return barcodeLookup_(raw); // konflik → rincian pemilik dari jalur lengkap
  const matches = [];
  const seen = {};
  const push = (via, variantId, conversionId) => {
    const k = via + '|' + variantId + '|' + (conversionId || '');
    if (seen[k]) return;
    seen[k] = 1;
    const card = X.V[variantId];
    if (!card) return;
    const c = conversionId ? X.C[conversionId] : null;
    matches.push(Object.assign({ via }, card, { childSku: c && c.sku ? c.sku : card.sku, conversion: c ? { unitName: c.unitName, baseUnitEquivalent: c.baseUnitEquivalent, sku: c.sku, gtin: c.gtin, internalBarcode: c.internalBarcode } : null }));
  };
  const bundles = [];
  const pushBundle = (via, id) => {
    const bd = X.B[id];
    if (bd && !bundles.some((x) => x.bundleId === bd.bundleId)) bundles.push(Object.assign({ via }, bd));
  };
  const row = activeRows[0] || liveRows[0] || null;
  if (row && row.s === 'ACTIVE' && row.b) pushBundle(row.t === 'GTIN' ? 'GTIN produsen' : 'Barcode internal', row.b);
  (X.bsku[up] || []).forEach((id) => pushBundle('SKU bundle', id));
  if (row && row.s === 'ACTIVE' && !row.b) push(row.t === 'GTIN' ? 'GTIN produsen' : 'Barcode internal', row.v || (row.c && X.C[row.c] ? X.C[row.c].variantId : ''), row.c);
  (X.vsku[up] || []).forEach((vid) => push('Child SKU', vid));
  (X.pcode[up] || []).forEach((list) => list.forEach((vid) => push('Parent SKU', vid)));
  (X.csku[up] || []).forEach((cid) => push('SKU kemasan', X.C[cid].variantId, cid));
  (X.ext[up] || []).forEach((m) => {
    if (m.b) return pushBundle(m.via, m.b);
    push(m.via, m.v || (m.c && X.C[m.c] ? X.C[m.c].variantId : ''), m.c);
  });
  const isText = !/^\d+$/.test(code);
  const hasRetired = rowsAll.some((b) => b.s === 'RETIRED');
  // pencarian nama / barcode pensiun tanpa pemilik aktif → jalur lengkap
  if (!matches.length && !bundles.length && ((isText && normalizeName(raw).length >= 3) || hasRetired)) return barcodeLookup_(raw);
  const gtin = validateManufacturerGtin(code);
  const anyGtin = validateGtin(code);
  const kind = gtin.ok ? 'gtin' : anyGtin.ok && /^2|^02|^04/.test(code) ? 'internal' : /^\d+$/.test(code) && code.length >= 8 ? 'invalid_numeric' : 'text';
  return {
    code: kind === 'text' ? up : code,
    kind,
    validation: gtin.ok ? { ok: true, symbology: gtin.symbology } : { ok: false, message: anyGtin.ok ? anyGtin.warnings[0] || gtin.message : anyGtin.message || gtin.message },
    found: matches.length > 0 || bundles.length > 0,
    matches,
    bundles,
    retired: [],
    reserved: row && row.s === 'ALLOCATED' ? { type: row.t, notes: row.n } : null,
  };
}

/**
 * Indeks ringkas untuk perangkat (hasil scan instan tanpa menunggu jaringan): kode → SKU Produk aktif.
 * Hanya data tampilan; keputusan akhir (konflik, belum terdaftar) tetap dari server.
 */
function barcodeIndexLite_() {
  const X = barcodeIndex_();
  const out = [];
  Object.keys(X.V).forEach((vid) => {
    const v = X.V[vid];
    const codes = [v.gtin, v.internalBarcode, v.sku].filter(Boolean);
    if (codes.length) out.push([codes.join(' '), vid, v.productId, v.skuName, v.sku, v.gtin || v.internalBarcode || '', v.imageUrl || '', v.productStatus === 'ACTIVE' ? v.variantStatus : v.productStatus]);
  });
  return { version: dataVersion_(), rows: out };
}
