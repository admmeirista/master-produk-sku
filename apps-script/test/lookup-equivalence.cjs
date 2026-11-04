/**
 * Pencocokan barcode cepat (indeks cache) harus memberi hasil IDENTIK dengan barcodeLookup_ (baca tab langsung)
 * untuk setiap kode yang ada di database + kode acak/tidak valid/teks. Dipakai di akhir suite yang datanya kaya.
 */
const assert = require('node:assert/strict');

function codesOf(ctx) {
  const set = new Set(['8999999999994', '8991234567890', '2000000000015', 'TIDAK-ADA-123', 'xx', '12345678', 'air mawar', 'serum']);
  const add = (x) => x && set.add(String(x));
  ctx.db_('VARIANT_BARCODES').rows().forEach((b) => add(b.Code));
  ctx.db_('PRODUCT_VARIANTS').rows().forEach((v) => { add(v.SKU); add(v.GTIN); add(v.InternalBarcode); add(String(v.SKU || '').toLowerCase()); });
  ctx.db_('MASTER_PRODUCTS').rows().forEach((p) => add(p.ProductCode));
  ctx.db_('UNIT_CONVERSIONS').rows().forEach((c) => { add(c.SKU); add(c.GTIN); });
  ctx.db_('BUNDLE_MASTERS').rows().forEach((b) => add(b.BundleSKU));
  ctx.db_('EXTERNAL_SKU_MAPPINGS').rows().forEach((m) => add(m.ExternalSku));
  return [...set];
}

function checkLookupEquivalence(G) {
  const ctx = G.ctx;
  ctx.resetDbCache_();
  ctx.bumpDataVersion_(); // indeks dibangun dari data terbaru
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const codes = codesOf(ctx);
  let compared = 0;
  codes.forEach((c) => {
    let slow, fast;
    try { slow = plain(ctx.barcodeLookup_(c)); } catch (e) { slow = { error: e.message }; }
    ctx.resetDbCache_();
    try { fast = plain(ctx.barcodeLookupFast_(c)); } catch (e) { fast = { error: e.message }; }
    ctx.resetDbCache_();
    assert.deepEqual(fast, slow, 'hasil beda untuk kode ' + c);
    compared++;
  });
  return compared;
}

module.exports = { checkLookupEquivalence };
