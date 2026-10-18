/**
 * Pengujian v4: lifecycle, draft, GTIN lookup (mock UrlFetchApp dengan bentuk respons asli Open Beauty Facts),
 * supplier mapping, channel mapping multi-listing, multipack/bundle/request-mix, kesiapan inventory, data quality,
 * controlled deprecation, idempotency. Nomor [AC-n] = acceptance test pada brief revisi v4.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness.cjs');

const G = createGas();
const call = (token, action, payload) => JSON.parse(JSON.stringify(G.ctx.api(token, action, JSON.parse(JSON.stringify(payload === undefined ? null : payload)))));
const ok = (r) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message} ${JSON.stringify(r.error.details)}`);
  return r.data;
};
const fail = (r, code) => {
  assert.equal(r.ok, false, 'seharusnya gagal');
  if (code) assert.equal(r.error.code, code, r.error.message + ' ' + JSON.stringify(r.error.details));
  return r.error;
};
function gtin(body12) {
  let sum = 0;
  for (let i = 11, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body12[i]) * w;
  return body12 + ((10 - (sum % 10)) % 10);
}
let T, V;
const ids = {};

test('persiapan: setup, user, brand & kategori', () => {
  const out = JSON.parse(JSON.stringify(G.ctx.setup()));
  for (const t of ['BUNDLE_MASTERS', 'BUNDLE_COMPONENTS', 'MASTER_SUPPLIERS', 'SUPPLIER_PRODUCT_MAPPING', 'PRODUCT_LIFECYCLE_HISTORY', 'PACKAGING_HISTORY', 'GTIN_LOOKUP_CACHE', 'IMPORT_ERRORS', 'ATTRIBUTE_VALUES']) assert.ok(G.sheets.get(t), t);
  const admin = ok(call(null, 'auth.login', { email: out.admin.email, password: out.admin.password })).token;
  ok(call(admin, 'user.create', { email: 'entry@toko.local', fullName: 'Rina', role: 'data_entry', password: 'Password#2026' }));
  ok(call(admin, 'user.create', { email: 'viewer@toko.local', fullName: 'Budi', role: 'viewer', password: 'Password#2026' }));
  T = ok(call(null, 'auth.login', { email: 'entry@toko.local', password: 'Password#2026' })).token;
  V = ok(call(null, 'auth.login', { email: 'viewer@toko.local', password: 'Password#2026' })).token;
  for (const n of ['Wardah', 'Viva', 'Scarlett']) ids[n] = ok(call(T, 'brand.create', { name: n })).id;
  for (const n of ['Face Mask', 'Toner', 'Parfum']) ids[n] = ok(call(T, 'category.create', { name: n })).id;
  ok(call(T, 'attribute.save', { name: 'Volume', value: '100 ml' }));
});

const OBF_FOUND = { code: '8993137699549', product: { brands: '', categories_tags: ['en:non-food-products', 'en:open-beauty-facts', 'en:face-masks'], code: '8993137699549', image_front_url: 'https://images.openbeautyfacts.org/images/products/899/313/769/9549/front_en.3.400.jpg', product_name: 'Wardah nature daily MINERAL + clarifying clay mask 100ML', quantity: '' }, status: 1, status_verbose: 'product found' };

test('[AC-5] GTIN lookup: internal dulu → Open Beauty Facts → usulan auto-fill, cache, tidak membuat data otomatis', () => {
  G.state.fetch = (url) => (url.indexOf('8993137699549') > 0 ? { code: 200, body: JSON.stringify(OBF_FOUND) } : { code: 404, body: '{"status":0}' });
  const r = ok(call(T, 'gtin.lookup', { gtin: '8993137699549' }));
  assert.equal(r.stage, 'external');
  assert.equal(r.external.provider, 'openbeautyfacts');
  assert.equal(r.suggestion.brand.name, 'Wardah', 'brand ditebak dari nama produk karena field brand kosong');
  assert.equal(r.suggestion.category.name, 'Face Mask');
  assert.deepEqual(r.suggestion.attributes, [{ name: 'Volume', value: '100 ml' }], 'ukuran dinormalisasi ke master atribut');
  assert.match(r.suggestion.imageUrl, /^https:\/\//);
  assert.ok(G.state.fetchLog[0].opt.headers['User-Agent'].indexOf('MeiristaMasterSKU') === 0);
  // tidak ada produk yang dibuat otomatis
  assert.equal(ok(call(V, 'product.list', { status: 'all' })).total, 0);
  // panggilan kedua dari cache (tidak memanggil API lagi)
  const n = G.state.fetchLog.length;
  assert.equal(ok(call(T, 'gtin.lookup', { gtin: '8993137699549' })).external.cached, true);
  assert.equal(G.state.fetchLog.length, n);
  // tidak ditemukan → registrasi manual tetap jalan
  const nf = ok(call(T, 'gtin.lookup', { gtin: gtin('899123456700') }));
  assert.equal(nf.stage, 'manual');
  assert.equal(nf.external.status, 'NOT_FOUND');
  // GTIN tidak valid / bukan GTIN produsen → tidak dicari ke luar
  assert.equal(ok(call(T, 'gtin.lookup', { gtin: '8993137699540' })).stage, 'invalid');
  assert.equal(ok(call(T, 'gtin.lookup', { gtin: gtin('200000000777') })).stage, 'invalid');
  // gangguan jaringan → pesan jelas, workflow manual
  G.state.fetch = () => ({ throw: 'Timeout' });
  const er = ok(call(T, 'gtin.lookup', { gtin: gtin('899123456711') }));
  assert.equal(er.external.status, 'ERROR');
  assert.equal(er.stage, 'manual');
  // batas laju
  G.state.fetch = () => ({ code: 404, body: '{}' });
  let limited = false;
  for (let i = 0; i < 25 && !limited; i++) limited = ok(call(T, 'gtin.lookup', { gtin: gtin('8997000' + String(10000 + i)) })).external.status === 'RATE_LIMITED';
  assert.ok(limited, 'rate limit aktif');
  [...G.cache.keys()].forEach((k) => k.indexOf('sess_') !== 0 && G.cache.delete(k));
});

test('[AC-1][AC-4][AC-14][AC-15] Quick Entry dari hasil auto-fill: Parent non-stockable, Child stockable + konfigurasi batch/expiry', () => {
  const d = ok(call(T, 'product.save', { input: { brandId: ids.Wardah, categoryId: ids['Face Mask'], name: 'Wardah Nature Daily Mineral Clarifying Clay Mask', baseUnit: 'JAR', hasVariants: false, description: 'Masker clay', imageUrl: OBF_FOUND.product.image_front_url, dataSource: 'openbeautyfacts:8993137699549', variants: [{ barcode: { mode: 'gtin', code: '8993137699549' }, batchTracking: true, expiryTracking: true, shelfLifeMonths: 36 }] } }));
  ids.mask = d.id;
  assert.equal(d.stockable, false);
  assert.match(d.productCode, /^PRD\d{6}$/);
  assert.equal(d.variants[0].sku, d.productCode + '-001');
  assert.deepEqual([d.variants[0].stockable, d.variants[0].batchTracking, d.variants[0].expiryTracking, d.variants[0].shelfLifeMonths], [true, true, true, 36]);
  assert.equal(d.dataSource, 'openbeautyfacts:8993137699549');
  // scan ulang → produk existing, bukan registrasi baru
  assert.equal(ok(call(T, 'gtin.lookup', { gtin: '8993137699549' })).stage, 'internal');
  // inventory master: hanya Child SKU, Parent tidak pernah jadi item stok; batch/expiry diekspor
  const inv = ok(call(T, 'export.data', { kind: 'inventory' }));
  assert.equal(inv.rows.length, 1);
  assert.equal(inv.rows[0][0], d.variants[0].sku);
  assert.notEqual(inv.rows[0][0], d.productCode);
  assert.deepEqual([inv.rows[0][6], inv.rows[0][12]], ['JAR', 'Belum lengkap'], 'v5: kolom batch/expiry diganti satuan dasar & kelengkapan data kemasan');
});

test('Save Draft: tersimpan tapi belum tersedia downstream; aktivasi mengaktifkan Child SKU', () => {
  const d = ok(call(T, 'product.save', { input: { brandId: ids.Viva, categoryId: ids.Toner, name: 'Viva Face Tonic Bengkoang', baseUnit: 'BOTOL', saveAsDraft: true, variants: [{ barcode: { mode: 'internal' } }] } }));
  assert.equal(d.status, 'DRAFT');
  assert.equal(d.variants[0].status, 'DRAFT');
  assert.ok(!ok(call(T, 'export.data', { kind: 'master' })).rows.some((r) => r[1] === d.variants[0].sku), 'draft tidak diekspor sebagai aktif');
  const live = ok(call(T, 'export.data', { kind: 'inventory' }));
  assert.ok(!live.rows.some((r) => r[0] === d.variants[0].sku));
  fail(call(T, 'mapping.create', { system: 'beecloud', sku: d.variants[0].sku }), 'VALIDATION_FAILED');
  const a = ok(call(T, 'product.setStatus', { id: d.id, status: 'ACTIVE' }));
  assert.equal(a.variants[0].status, 'ACTIVE');
  ids.tonic = d.id;
});

test('idempotency key: kirim ganda tidak membuat produk dua kali', () => {
  const input = { brandId: ids.Viva, categoryId: ids.Toner, name: 'Viva Air Mawar 100ml', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'gtin', code: '8992796011501' } }] };
  const a = call(T, 'product.save', { input, requestKey: 'k-123' });
  const b = call(T, 'product.save', { input, requestKey: 'k-123' });
  assert.equal(ok(a).id, ok(b).id);
  assert.equal(b.replayed, true);
  assert.equal(ok(call(V, 'product.list', { search: 'air mawar' })).total, 1);
  ids.viva = ok(a).id;
});

test('[AC-2][AC-3][AC-10] Parent 4 Child SKU + satuan beli BOX: 5 BOX = 120 BOTOL; histori perubahan isi kemasan', () => {
  const variants = [['Ocean Blue', '50 ml', '899000000001'], ['Ocean Blue', '100 ml', '899000000002'], ['Rose Garden', '50 ml', '899000000003'], ['Vanilla', '50 ml', '899000000004']].map(([a, v, g]) => ({ attributes: [{ name: 'Aroma', value: a }, { name: 'Volume', value: v }], barcode: { mode: 'gtin', code: gtin(g) }, conversions: [{ unitName: 'BOX', factor: 24 }], purchaseUnit: 'BOX', salesUnit: 'BOTOL' }));
  const d = ok(call(T, 'product.save', { input: { brandId: ids.Scarlett, categoryId: ids.Parfum, name: 'Eau de Parfum', baseUnit: 'BOTOL', hasVariants: true, variants } }));
  ids.parfum = d.id;
  assert.equal(d.variants.length, 4);
  assert.equal(new Set(d.variants.map((v) => v.gtin)).size, 4);
  assert.equal(d.variants[0].purchaseUnit, 'BOX');
  assert.equal(ok(call(V, 'unit.convert', { variantId: d.variants[0].id, qty: 5, unit: 'BOX' })).baseQty, 120);
  // satuan beli harus kemasan yang terdefinisi
  const bad = JSON.parse(JSON.stringify(variants));
  bad[0].purchaseUnit = 'KARTON';
  fail(call(T, 'product.save', { input: { brandId: ids.Scarlett, categoryId: ids.Parfum, name: 'Eau de Parfum Lain', baseUnit: 'BOTOL', hasVariants: true, acknowledgeSimilar: true, variants: [Object.assign(bad[0], { barcode: { mode: 'internal' } })] } }), 'VALIDATION_FAILED');
  // ubah isi BOX varian 2 → histori dengan tanggal efektif
  const x = toInput(d);
  x.variants[1].conversions[0].factor = 12;
  x.variants[1].conversions[0].changeReason = 'Supplier ganti kemasan';
  ok(call(T, 'product.save', { input: x }));
  const h = G.sheets.get('PACKAGING_HISTORY').data.slice(1);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0][5], h[0][6], h[0][13]], ['24', '12', 'Supplier ganti kemasan']);
});

function toInput(x) {
  return {
    productId: x.id,
    version: x.version,
    name: x.name,
    brandId: x.brand.id,
    categoryId: x.category.id,
    baseUnit: x.baseUnit,
    hasVariants: x.hasVariants,
    variants: x.variants.map((v) => ({ id: v.id, name: v.name, attributes: v.attributes, status: v.status, barcode: { mode: v.barcodeType, code: v.gtin || v.internalBarcode }, purchaseUnit: v.purchaseUnit, salesUnit: v.salesUnit, batchTracking: v.batchTracking, expiryTracking: v.expiryTracking, shelfLifeMonths: v.shelfLifeMonths, conversions: v.conversions.filter((c) => !c.isBaseUnit).map((c) => ({ id: c.id, unitName: c.unitName, factor: c.factor, containsUnit: c.containsUnit, isTradeItem: c.isTradeItem, status: c.status, barcode: { mode: 'none' } })) })),
  };
}

test('data supplier lama (v4) tetap kompatibel: dua supplier per Child SKU, kode ganda ditolak', () => {
  const p = ok(call(T, 'product.get', { id: ids.parfum }));
  const sa = ok(call(T, 'supplier.save', { name: 'PT Wangi Sejahtera' }));
  const sb = ok(call(T, 'supplier.save', { name: 'CV Aroma Nusantara' }));
  assert.match(sa.code, /^SUP\d{4}$/);
  fail(call(T, 'supplier.save', { name: 'PT. Wangi Sejahtera' }), 'DUPLICATE');
  ok(call(T, 'supplierMap.save', { supplierId: sa.id, supplierProductCode: 'PF-OB50', variantId: p.variants[0].id, purchaseUnit: 'BOX', conversionFactor: 24, moq: 2 }));
  ok(call(T, 'supplierMap.save', { supplierId: sb.id, supplierProductCode: 'PERF-001', variantId: p.variants[0].id, purchaseUnit: 'BOTOL', conversionFactor: 1 }));
  const list = ok(call(V, 'supplierMap.list', { variantId: p.variants[0].id }));
  assert.equal(list.total, 2);
  assert.equal(ok(call(V, 'supplierMap.lookup', { code: 'perf-001' }))[0].sku, p.variants[0].sku);
  // v5: supplier bukan bagian identitas SKU — kode supplier tidak dipakai lookup identitas (data lama tetap tersimpan)
  assert.equal(ok(call(V, 'barcode.lookup', { code: 'PF-OB50' })).found, false);
  fail(call(T, 'supplierMap.save', { supplierId: sa.id, supplierProductCode: 'pf-ob50', variantId: p.variants[1].id, purchaseUnit: 'BOTOL', conversionFactor: 1 }), 'VALIDATION_FAILED');
  // faktor harus konsisten dengan kemasan BOX varian (24), bukan angka lain
  fail(call(T, 'supplierMap.save', { supplierId: sb.id, supplierProductCode: 'PERF-BOX', variantId: p.variants[0].id, purchaseUnit: 'BOX', conversionFactor: 20 }), 'VALIDATION_FAILED');
  // spesifikasi berbeda → ditandai untuk evaluasi, tidak membuat SKU baru
  ok(call(T, 'supplierMap.save', { supplierId: sb.id, supplierProductCode: 'PERF-OB45', variantId: p.variants[0].id, purchaseUnit: 'BOTOL', conversionFactor: 1, specMismatch: true, specNote: 'Isi 45 ml, bukan 50 ml' }));
  assert.equal(ok(call(V, 'product.list', { search: 'parfum' })).rows[0].variantCount, 4);
});

test('[AC-9][AC-22] satu Child SKU di beberapa listing & kanal; listing/variasi ganda ditolak', () => {
  const p = ok(call(T, 'product.get', { id: ids.parfum }));
  const sku = p.variants[0].sku;
  ok(call(T, 'mapping.create', { system: 'shopee', storeAccount: 'Meirista Official', sku, externalProductId: '43465728785', externalVariationId: '351267547392', externalParentSku: 'EDP-OCEAN', externalSku: 'EDP-OB50' }));
  ok(call(T, 'mapping.create', { system: 'shopee', storeAccount: 'Meirista Official', sku, externalProductId: '50000000001', externalVariationId: '', externalSku: 'EDP-OB50' }));
  ok(call(T, 'mapping.create', { system: 'tiktok', storeAccount: 'Meirista TikTok', sku, externalProductId: '1729384756', externalVariationId: '1729384757' }));
  fail(call(T, 'mapping.create', { system: 'shopee', storeAccount: 'Meirista Official', sku: p.variants[1].sku, externalProductId: '43465728785', externalVariationId: '351267547392' }), 'DUPLICATE');
  const m = ok(call(V, 'mapping.list', { search: sku }));
  assert.equal(m.total, 3);
  const sh = m.rows.find((x) => x.externalVariationId === '351267547392');
  assert.deepEqual([sh.externalProductId, sh.externalParentSku, sh.externalSku, sh.storeAccount], ['43465728785', 'EDP-OCEAN', 'EDP-OB50', 'Meirista Official']);
  assert.ok(ok(call(V, 'mapping.summary', {})).shopee.unmapped >= 1);
});

test('[AC-11][AC-12][AC-13] multipack virtual 6 PCS, mixed bundle 3 SKU, request mix dengan komposisi aktual', () => {
  const viva = ok(call(T, 'product.get', { id: ids.viva }));
  const p = ok(call(T, 'product.get', { id: ids.parfum }));
  const mp = ok(call(T, 'bundle.save', { type: 'MULTIPACK', name: 'Paket Viva Air Mawar 6 PCS', components: [{ variantId: viva.variants[0].id, quantity: 6 }] }));
  assert.match(mp.sku, /^MP\d{6}$/);
  assert.equal(mp.stockable, false);
  fail(call(T, 'bundle.save', { type: 'MULTIPACK', name: 'Paket Viva 6 lagi', components: [{ variantId: viva.variants[0].id, quantity: 6 }] }), 'VALIDATION_FAILED');
  // tidak double counting: inventory master hanya memuat Child SKU, bundle virtual tidak punya saldo
  const inv = ok(call(T, 'export.data', { kind: 'inventory' }));
  assert.ok(!inv.rows.some((r) => r[0] === mp.sku));
  assert.equal(inv.rows.filter((r) => r[0] === viva.variants[0].sku).length, 1);
  const res = ok(call(V, 'bundle.resolve', { id: mp.id }));
  assert.deepEqual(res.components.map((c) => [c.sku, c.quantity]), [[viva.variants[0].sku, 6]]);
  const mix = ok(call(T, 'bundle.save', { type: 'MIXED', name: 'Bundle 3 Parfum 50 ml', components: [p.variants[0], p.variants[2], p.variants[3]].map((v) => ({ variantId: v.id, quantity: 1 })) }));
  assert.match(mix.sku, /^BD\d{6}$/);
  assert.equal(mix.components.length, 3);
  const rm = ok(call(T, 'bundle.save', { type: 'REQUEST_MIX', name: 'Parfum Request Mix isi 3', pickQuantity: 3, components: [p.variants[0], p.variants[2], p.variants[3]].map((v) => ({ variantId: v.id, quantity: 3 })) }));
  fail(call(T, 'bundle.save', { type: 'REQUEST_MIX', name: 'RM rakit', pickQuantity: 2, stockMode: 'PREASSEMBLED', components: [p.variants[0], p.variants[2]].map((v) => ({ variantId: v.id, quantity: 2 })) }), 'VALIDATION_FAILED');
  const actual = ok(call(V, 'bundle.resolve', { id: rm.id, selections: [{ sku: p.variants[0].sku, quantity: 2 }, { sku: p.variants[3].sku, quantity: 1 }] }));
  assert.deepEqual(actual.components.map((c) => c.quantity), [2, 1]);
  fail(call(V, 'bundle.resolve', { id: rm.id, selections: [{ sku: p.variants[0].sku, quantity: 2 }] }), 'VALIDATION_FAILED');
  fail(call(V, 'bundle.resolve', { id: rm.id, selections: [{ sku: p.variants[1].sku, quantity: 3 }] }), 'VALIDATION_FAILED');
  // bundle dirakit = stockable (punya identitas stok sendiri)
  const pre = ok(call(T, 'bundle.save', { type: 'MIXED', name: 'Gift Box Parfum (dirakit)', stockMode: 'PREASSEMBLED', components: [p.variants[0], p.variants[2]].map((v) => ({ variantId: v.id, quantity: 1 })), barcode: { mode: 'internal' } }));
  assert.equal(pre.stockable, true);
  assert.match(pre.barcode, /^200\d{10}$/);
  assert.ok(ok(call(T, 'export.data', { kind: 'inventory' })).rows.some((r) => r[0] === pre.sku));
  // listing paket Shopee → multipack
  ok(call(T, 'mapping.create', { system: 'shopee', storeAccount: 'Meirista Official', sku: mp.sku, externalProductId: '44174178533', externalSku: 'VIV-PAKET6' }));
  assert.equal(ok(call(V, 'barcode.lookup', { code: mp.sku })).bundles[0].bundleId, mp.id);
  ids.mix = mix.id;
});

test('[AC-16][AC-17] Discontinued: histori tetap, tidak untuk mapping baru; rename brand tidak mengubah SKU', () => {
  const p = ok(call(T, 'product.get', { id: ids.parfum }));
  const v4 = p.variants[3];
  fail(call(T, 'variant.setStatus', { id: v4.id, status: 'DISCONTINUED' }), 'VALIDATION_FAILED');
  ok(call(T, 'variant.setStatus', { id: v4.id, status: 'DISCONTINUED', reason: 'Tidak diproduksi lagi' }));
  fail(call(T, 'variant.setStatus', { id: v4.id, status: 'DRAFT', reason: 'coba kembali' }), 'INVALID_TRANSITION');
  fail(call(T, 'mapping.create', { system: 'tiktok', sku: v4.sku, externalProductId: '99999999' }), 'VALIDATION_FAILED');
  const hit = ok(call(V, 'barcode.lookup', { code: v4.gtin }));
  assert.equal(hit.matches[0].variantStatus, 'DISCONTINUED', 'tetap tertelusur');
  const hist = ok(call(V, 'product.lifecycle', { id: ids.parfum }));
  assert.ok(hist.some((h) => h.entityId === v4.id && h.to === 'DISCONTINUED' && h.reason === 'Tidak diproduksi lagi'));
  // masih dipakai bundle aktif → muncul di Data Quality
  const q = ok(call(V, 'quality.get', {}));
  assert.ok(q.sections.find((s) => s.key === 'inactive_in_use').rows.some((r) => r.sku === v4.sku));
  assert.ok(q.sections.find((s) => s.key === 'bundle_invalid').rows.some((r) => /DISCONTINUED|Discontinued/.test(r.problem)));
  // inventory master tetap memuat SKU discontinued (sisa stok), bukan untuk pembelian baru
  assert.ok(ok(call(T, 'export.data', { kind: 'inventory' })).rows.some((r) => r[0] === v4.sku && r[15] === 'Discontinued'));
  ok(call(T, 'brand.rename', { id: ids.Scarlett, name: 'Scarlett Whitening' }));
  assert.deepEqual(ok(call(V, 'product.get', { id: ids.parfum })).variants.map((v) => v.sku), p.variants.map((v) => v.sku));
  // produk diarsipkan tidak dapat diedit
  const t = ok(call(T, 'product.setStatus', { id: ids.tonic, status: 'DISCONTINUED', reason: 'Ganti formula' }));
  assert.equal(t.variants[0].status, 'DISCONTINUED');
  ok(call(T, 'product.setStatus', { id: ids.tonic, status: 'ARCHIVED', reason: 'Arsip historis' }));
  fail(call(T, 'product.save', { input: toInput(ok(call(T, 'product.get', { id: ids.tonic }))) }), 'VALIDATION_FAILED');
});

test('controlled deprecation: SKU duplikat digantikan, mapping dipindah, tanpa hapus data', () => {
  const p = ok(call(T, 'product.get', { id: ids.parfum }));
  const keep = p.variants[0];
  const dup = ok(call(T, 'product.save', { input: { brandId: ids.Viva, categoryId: ids.Parfum, name: 'Ocean Blue EDP 50ml (salah input)', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'internal' } }] } })).variants[0];
  ok(call(T, 'mapping.create', { system: 'tokopedia', sku: dup.sku, externalProductId: '123123123' }));
  const r = ok(call(T, 'variant.deprecate', { id: dup.id, replacedBy: keep.id, moveMappings: true, reason: 'Barang sama dengan ' + keep.sku }));
  assert.equal(r.moved.channel, 1);
  const after = ok(call(V, 'barcode.lookup', { code: dup.sku })).matches[0];
  assert.equal(after.variantStatus, 'DISCONTINUED');
  assert.equal(ok(call(V, 'mapping.list', { system: 'tokopedia' })).rows[0].internalSku, keep.sku);
});

test('[AC-23] data konsisten setelah edit & muat ulang; export BeeCloud & master', () => {
  const p = ok(call(T, 'product.get', { id: ids.parfum }));
  const x = toInput(p);
  x.name = 'Eau de Parfum Signature';
  x.variants[0].shelfLifeMonths = 30;
  ok(call(T, 'product.save', { input: x, acknowledgeSimilar: true }));
  G.ctx.resetDbCache_();
  [...G.cache.keys()].forEach((k) => k.indexOf('sess_') !== 0 && G.cache.delete(k)); // cache server kosong / aplikasi dimuat ulang
  const again = ok(call(V, 'product.get', { id: ids.parfum }));
  assert.equal(again.name, 'Eau de Parfum Signature');
  assert.equal(again.variants[0].shelfLifeMonths, 30);
  assert.deepEqual(again.variants.map((v) => v.sku), p.variants.map((v) => v.sku));
  assert.equal(ok(call(V, 'product.list', { search: 'signature' })).total, 1);
  const bee = ok(call(T, 'export.data', { kind: 'beecloud' }));
  assert.ok(bee.rows.some((r) => r[0] === p.variants[0].sku));
  for (const k of ['master', 'conversions', 'bundles', 'suppliers', 'mappings']) assert.ok(ok(call(T, 'export.data', { kind: k, system: 'shopee' })).headers.length > 5, k);
});
