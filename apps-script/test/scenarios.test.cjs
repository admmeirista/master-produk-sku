/**
 * Pengujian skenario v3, disesuaikan dengan aturan SKU v5 (file .gs asli dijalankan di emulator layanan Apps Script — harness.cjs).
 * Nomor [AC-n] merujuk ke daftar acceptance criteria pada brief revisi.
 *   npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness.cjs');

function env() {
  const g = createGas();
  const call = (token, action, payload) => JSON.parse(JSON.stringify(g.ctx.api(token, action, JSON.parse(JSON.stringify(payload === undefined ? null : payload)))));
  return Object.assign(g, { call });
}
const ok = (r) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message} ${JSON.stringify(r.error.details)}`);
  return r.data;
};
const fail = (r, code) => {
  assert.equal(r.ok, false, 'seharusnya gagal');
  if (code) assert.equal(r.error.code, code, r.error.message + ' ' + JSON.stringify(r.error.details));
  return r.error;
};
const rowsOf = (sheets, tab) => sheets.get(tab).data.slice(1).filter((r) => r.some((x) => x !== '' && x !== undefined)).length;

/** GTIN-13 valid dari 12 digit awal. */
function gtin(body12) {
  let sum = 0;
  for (let i = 11, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body12[i]) * w;
  return body12 + ((10 - (sum % 10)) % 10);
}

const E = env();
const { call, sheets } = E;
let admin, entry, entry2, viewer;
const ids = {};

test('setup: tab v3, admin awal, login & otorisasi di server', () => {
  const out = JSON.parse(JSON.stringify(E.ctx.setup()));
  assert.ok(out.admin.password);
  for (const t of ['MASTER_BRANDS', 'MASTER_CATEGORIES', 'MASTER_PRODUCTS', 'PRODUCT_VARIANTS', 'VARIANT_BARCODES', 'VARIANT_ATTRIBUTES', 'UNIT_CONVERSIONS', 'EXTERNAL_SKU_MAPPINGS', 'AUDIT_LOGS', 'SYSTEM_COUNTERS', 'TX_JOURNAL', 'IMPORT_BATCHES']) assert.ok(sheets.get(t), t);
  admin = ok(call(null, 'auth.login', { email: out.admin.email, password: out.admin.password })).token;
  ok(call(admin, 'settings.save', { base_units: ['PCS', 'BOTOL', 'TUBE', 'SACHET', 'JAR', 'PACK', 'POT', 'STICK'], pack_units: ['BOX', 'KARTON', 'PACK', 'LUSIN', 'INNER', 'DUS', 'BAL', 'SET'] })); // skenario lama memakai satuan BOTOL/KARTON/LUSIN
  fail(call(null, 'auth.login', { email: out.admin.email, password: 'salah-password' }), 'BAD_CREDENTIALS');
  for (const [email, role] of [['entry@toko.local', 'data_entry'], ['entry2@toko.local', 'data_entry'], ['viewer@toko.local', 'viewer']]) ok(call(admin, 'user.create', { email, fullName: email, role, password: 'Password#2026' }));
  const login = (e) => ok(call(null, 'auth.login', { email: e, password: 'Password#2026' })).token;
  entry = login('entry@toko.local');
  entry2 = login('entry2@toko.local');
  viewer = login('viewer@toko.local');
  fail(call('token-palsu', 'product.list', {}), 'UNAUTHENTICATED');
  // otorisasi tidak bergantung pada tombol yang disembunyikan: server menolak
  fail(call(viewer, 'brand.create', { name: 'Wardah' }), 'FORBIDDEN');
  fail(call(viewer, 'product.save', { input: {} }), 'FORBIDDEN');
  fail(call(entry, 'user.list', {}), 'FORBIDDEN');
  fail(call(entry, 'import.commit', { type: 'reference', rows: [] }), 'FORBIDDEN');
});

test('[AC-5] Master Brand & Kategori: hanya nama (tanpa kode), unik, hapus hanya bila belum dipakai', () => {
  // kunci objek ids = alias lokal tes saja; aplikasi tidak lagi membuat kode brand/kategori
  for (const [name, code] of Object.entries({ Viva: 'VIV', Hanasui: 'HAN', Purbasari: 'PUR', Scarlett: 'SCA', Gatsby: 'GAT' })) {
    const b = ok(call(entry, 'brand.create', { name }));
    assert.equal(b.code, undefined, 'tidak ada kode brand');
    ids[code] = b.id;
  }
  ok(call(entry, 'brand.create', { name: 'Vivelle' }));
  for (const n of ['viva', ' VIVA ', 'V.I.V.A']) fail(call(entry, 'brand.create', { name: n }), 'DUPLICATE');
  for (const [name, code] of Object.entries({ Parfum: 'PAR', Lipstick: 'LIP', 'Body Lotion': 'BOD', Toner: 'TON', 'Hair Styling': 'HAI' })) {
    // nama yang sudah ada sebagai kategori standar Shopee (Toner, Hair Styling) dipakai langsung
    const r = call(entry, 'category.create', { name, acknowledgeSimilar: true });
    const c = r.ok ? r.data : ok(call(entry, 'category.list', {})).find((x) => x.name === name && x.leaf);
    assert.ok(c, name);
    assert.equal(c.code, undefined, 'tidak ada kode kategori');
    ids['c' + code] = c.id;
  }
  const ren = ok(call(entry, 'brand.rename', { id: ids.SCA, name: 'Scarlett Whitening' }));
  assert.equal(ren.id, ids.SCA);
  // hapus: boleh selama belum dipakai produk; baris tetap tersimpan sebagai DELETED
  const tmp = ok(call(entry, 'brand.create', { name: 'Brand Uji' }));
  ok(call(entry, 'brand.delete', { id: tmp.id }));
  assert.ok(!ok(call(entry, 'brand.list', {})).some((b) => b.id === tmp.id));
  const again = ok(call(entry, 'brand.create', { name: 'Brand Uji' }));
  assert.notEqual(again.id, tmp.id, 'ID baru, data lama tetap ada sebagai riwayat');
});

const quick = (o) => Object.assign({ brandId: ids.VIV, categoryId: ids.cTON, name: 'Viva Air Mawar 100ml', baseUnit: 'BOTOL', hasVariants: false, variants: [{ barcode: { mode: 'gtin', code: '8992796011501' } }] }, o);

test('[AC-1][AC-6][AC-13] Quick Entry satu varian: kode produk, SKU, varian default otomatis; tanpa BOX', () => {
  const d = ok(call(entry, 'product.save', { input: quick() }));
  ids.viva = d.id;
  assert.equal(d.productCode, 'PRD000001', 'Parent SKU = PRD + 6 digit urut global');
  assert.equal(d.variants.length, 1);
  assert.equal(d.variants[0].isDefault, true);
  assert.equal(d.variants[0].sku, 'PRD000001-001', 'Child SKU = Parent SKU + urutan 3 digit (GTIN terpisah)');
  assert.equal(d.variants[0].gtin, '8992796011501');
  assert.deepEqual(d.variants[0].conversions.map((c) => c.unitName), ['BOTOL']);
  // barcode tersimpan sebagai teks
  const row = sheets.get('VARIANT_BARCODES').data.find((r) => r[1] === '8992796011501');
  assert.equal(typeof row[1], 'string');
  // brand & kategori milik produk dipakai → tidak boleh dihapus
  fail(call(entry, 'brand.delete', { id: ids.VIV }), 'IN_USE');
  fail(call(entry, 'category.delete', { id: ids.cTON }), 'STANDARD'); // Toner = kategori standar Shopee: tidak bisa dihapus (nonaktifkan saja)
});

test('deteksi duplikat otomatis: nama mirip ditandai, tidak auto-merge; lanjut bila memang berbeda', () => {
  const e = fail(call(entry, 'product.save', { input: quick({ name: 'VIVA AIR MAWAR 100 ML', variants: [{ barcode: { mode: 'internal' } }] }) }), 'SIMILAR_EXISTS');
  assert.ok(e.details[0].message.includes('Viva Air Mawar 100ml'));
  assert.equal(e.details[0].data.id, ids.viva);
  // GTIN sama dengan produk existing → ditolak (identitas fisik sama)
  const e2 = fail(call(entry, 'product.save', { input: quick({ name: 'Viva Air Mawar Botol Baru', acknowledgeSimilar: true }) }), 'VALIDATION_FAILED');
  assert.equal(e2.details[0].code, 'BARCODE_IN_USE');
  assert.ok(e2.details[0].message.includes('Viva Air Mawar 100ml'));
});

const parfum = () => ({
  brandId: ids.SCA,
  categoryId: ids.cPAR,
  name: 'Parfum Eau de Parfum',
  baseUnit: 'BOTOL',
  hasVariants: true,
  variants: [
    ['Ocean Blue', '50 ml', '899000000001'],
    ['Ocean Blue', '100 ml', '899000000002'],
    ['Rose Garden', '50 ml', '899000000003'],
    ['Rose Garden', '100 ml', '899000000004'],
  ].map(([a, v, g]) => ({ attributes: [{ name: 'Aroma', value: a }, { name: 'Volume', value: v }], barcode: { mode: 'gtin', code: gtin(g) }, conversions: [{ unitName: 'BOX', factor: 24 }, { unitName: 'KARTON', factor: 6, containsUnit: 'BOX' }] })),
});

test('[AC-2][AC-3][AC-9] Advanced 2 aroma × 2 volume: GTIN & SKU per varian, konversi diterapkan ke semua varian', () => {
  const before = rowsOf(sheets, 'MASTER_PRODUCTS');
  const dry = ok(call(entry, 'product.validate', { input: parfum() }));
  assert.equal(dry.dryRun, true);
  assert.equal(rowsOf(sheets, 'MASTER_PRODUCTS'), before, 'dry-run tidak menulis');
  const d = ok(call(entry, 'product.save', { input: parfum() }));
  ids.parfum = d.id;
  assert.equal(d.variants.length, 4);
  assert.deepEqual(d.variants.map((v) => v.attributes.map((a) => a.value).join(' ')), ['Ocean Blue 50 ml', 'Ocean Blue 100 ml', 'Rose Garden 50 ml', 'Rose Garden 100 ml']);
  assert.equal(new Set(d.variants.map((v) => v.gtin)).size, 4);
  assert.equal(new Set(d.variants.map((v) => v.sku)).size, 4);
  d.variants.forEach((v) => assert.deepEqual(v.conversions.map((c) => [c.unitName, c.baseUnitEquivalent, c.sku]), [['BOTOL', 1, ''], ['BOX', 24, ''], ['KARTON', 144, '']]));
  // konversi tidak otomatis membuat SKU kemasan
  assert.equal(ok(call(viewer, 'product.list', { search: 'parfum' })).rows[0].skuCount, 4);
  // atribut tersimpan relasional
  assert.equal(sheets.get('VARIANT_ATTRIBUTES').data.slice(1).filter((r) => r[2] === d.id).length, 8);
});

test('[AC-4] kombinasi ganda & GTIN konflik ditolak; faktor konversi harus > 0', () => {
  const inp = parfum();
  inp.name = 'Parfum Body Mist';
  inp.variants = [
    { attributes: [{ name: 'Aroma', value: 'Vanilla' }], barcode: { mode: 'gtin', code: gtin('899000000011') } },
    { attributes: [{ name: 'aroma', value: 'VANILLA' }], barcode: { mode: 'gtin', code: gtin('899000000011') } },
    { attributes: [{ name: 'Aroma', value: 'Peach' }], barcode: { mode: 'gtin', code: gtin('899000000001') } },
    { attributes: [{ name: 'Aroma', value: 'Musk' }], barcode: { mode: 'gtin', code: '8990000000120' }, conversions: [{ unitName: 'BOX', factor: 0 }] },
  ];
  const e = fail(call(entry, 'product.save', { input: inp }), 'VALIDATION_FAILED');
  const paths = e.details.map((x) => x.path);
  assert.ok(paths.includes('variants.1.attributes'), JSON.stringify(e.details));
  assert.ok(paths.includes('variants.1.barcode'));
  assert.ok(paths.includes('variants.3.conversions.0.factor'));
  // GTIN milik produk lain & check digit salah terdeteksi saat penyimpanan
  inp.variants = inp.variants.filter((_, i) => i !== 1).map((v) => Object.assign(v, { conversions: [] }));
  const e2 = fail(call(entry, 'product.save', { input: inp }), 'VALIDATION_FAILED');
  assert.ok(e2.details.some((x) => x.code === 'BARCODE_IN_USE' && x.message.includes('Parfum Eau de Parfum')));
  assert.ok(e2.details.some((x) => x.path === 'variants.2.barcode'));
  assert.equal(ok(call(viewer, 'product.list', { search: 'body mist' })).total, 0, 'tidak ada yang tersimpan setengah');
});

test('[AC-7][AC-8] scan barcode: produk existing, SKU, barcode baru, dan kode bukan GTIN', () => {
  const hit = ok(call(viewer, 'barcode.lookup', { code: gtin('899000000003') }));
  assert.equal(hit.found, true);
  assert.equal(hit.matches[0].productName, 'Parfum Eau de Parfum');
  assert.equal(hit.matches[0].variantName, 'Rose Garden 50 ml');
  assert.equal(hit.matches[0].via, 'GTIN produsen');
  const sku = ok(call(viewer, 'product.get', { id: ids.viva })).variants[0].sku;
  assert.equal(ok(call(viewer, 'barcode.lookup', { code: sku.toLowerCase() })).matches[0].via, 'Child SKU');
  const fresh = ok(call(viewer, 'barcode.lookup', { code: gtin('899123456789') }));
  assert.equal(fresh.found, false);
  assert.equal(fresh.kind, 'gtin');
  const bad = ok(call(viewer, 'barcode.lookup', { code: '8991234567890' }));
  assert.equal(bad.found, false);
  assert.notEqual(bad.kind, 'gtin', 'check digit salah tidak dianggap GTIN');
  const coupon = ok(call(viewer, 'barcode.lookup', { code: '9917348265012' }));
  assert.notEqual(coupon.kind, 'gtin');
  const text = ok(call(viewer, 'barcode.lookup', { code: 'ABC-123' }));
  assert.equal(text.kind, 'text');
});

test('[AC-10][AC-11] ubah konversi hanya satu varian; 3 BOX × 24 = 72 BOTOL', () => {
  const d = ok(call(entry, 'product.get', { id: ids.parfum }));
  const v = d.variants[1];
  assert.equal(ok(call(viewer, 'unit.convert', { variantId: v.id, qty: 3, unit: 'BOX' })).baseQty, 72);
  const input = toInput(d);
  input.variants[1].conversions[0].factor = 12; // BOX varian 100 ml berisi 12
  const d2 = ok(call(entry, 'product.save', { input }));
  assert.equal(d2.variants[1].conversions[1].baseUnitEquivalent, 12);
  assert.equal(d2.variants[1].conversions[2].baseUnitEquivalent, 72, 'KARTON = 6 BOX = 72');
  assert.equal(d2.variants[0].conversions[1].baseUnitEquivalent, 24, 'varian lain tidak berubah');
  assert.equal(ok(call(viewer, 'unit.convert', { variantId: v.id, qty: 3, unit: 'BOX' })).baseQty, 36);
  // hapus konfigurasi kemasan operasional; kemasan yang masih jadi isi kemasan lain tidak boleh dihapus
  const x = toInput(d2);
  x.variants[2].conversions[0].status = 'DELETED';
  fail(call(entry, 'product.save', { input: x }), 'VALIDATION_FAILED');
  x.variants[2].conversions[1].status = 'DELETED';
  const d3 = ok(call(entry, 'product.save', { input: x }));
  assert.deepEqual(d3.variants[2].conversions.map((c) => c.unitName), ['BOTOL']);
});

/** Ubah detail produk menjadi input formulir edit. */
function toInput(x) {
  return {
    productId: x.id,
    version: x.version,
    brandId: x.brand.id,
    categoryId: x.category.id,
    name: x.name,
    baseUnit: x.baseUnit,
    hasVariants: x.hasVariants,
    variants: x.variants.map((v) => ({ id: v.id, name: v.name, attributes: v.attributes, status: v.status, barcode: { mode: v.barcodeType, code: v.gtin || v.internalBarcode }, conversions: v.conversions.filter((c) => !c.isBaseUnit).map((c) => ({ id: c.id, unitName: c.unitName, factor: c.factor, containsUnit: c.containsUnit, isTradeItem: c.isTradeItem, status: c.status, barcode: { mode: c.gtin ? 'gtin' : c.internalBarcode ? 'internal' : 'none', code: c.gtin || c.internalBarcode } })) })),
  };
}

test('[AC-14] edit tanpa mengubah ID permanen: nama, brand, atribut, tambah varian; ganti GTIN wajib alasan', () => {
  const d = ok(call(entry, 'product.get', { id: ids.parfum }));
  const keep = { id: d.id, code: d.productCode, vids: d.variants.map((v) => v.id), skus: d.variants.map((v) => v.sku) };
  const x = toInput(d);
  x.name = 'Parfum Eau de Parfum Classic';
  x.brandId = ids.HAN;
  x.variants[0].attributes = [{ name: 'Aroma', value: 'Ocean Breeze' }, { name: 'Volume', value: '50 ml' }];
  x.variants.push({ attributes: [{ name: 'Aroma', value: 'Vanilla' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'internal' }, conversions: [{ unitName: 'BOX', factor: 24 }] });
  const d2 = ok(call(entry, 'product.save', { input: x }));
  assert.equal(d2.id, keep.id);
  assert.equal(d2.productCode, keep.code);
  assert.deepEqual(d2.variants.slice(0, 4).map((v) => v.id), keep.vids);
  assert.deepEqual(d2.variants.slice(0, 4).map((v) => v.sku), keep.skus);
  assert.equal(d2.brand.name, 'Hanasui');
  assert.equal(d2.variants[0].name, 'Ocean Breeze 50 ml');
  assert.match(d2.variants[4].internalBarcode, /^200\d{10}$/);
  // kombinasi atribut yang sudah dipakai varian lain ditolak
  const y = toInput(d2);
  y.variants[1].attributes = [{ name: 'Aroma', value: 'Rose Garden' }, { name: 'Volume', value: '50 ml' }];
  fail(call(entry, 'product.save', { input: y }), 'VALIDATION_FAILED');
  // ganti GTIN: wajib alasan; GTIN lama dipensiunkan dan tidak boleh dipakai barang lain
  const z = toInput(d2);
  z.variants[2].barcode = { mode: 'gtin', code: gtin('899000000013') };
  assert.equal(fail(call(entry, 'product.save', { input: z }), 'VALIDATION_FAILED').details[0].code, 'REASON_REQUIRED');
  z.variants[2].barcodeChangeReason = 'Salah input saat registrasi';
  ok(call(entry, 'product.save', { input: z }));
  const e = fail(call(entry, 'product.save', { input: quick({ name: 'Produk Lain Sama Sekali', brandId: ids.GAT, variants: [{ barcode: { mode: 'gtin', code: gtin('899000000003') } }] }) }), 'VALIDATION_FAILED');
  assert.equal(e.details[0].code, 'BARCODE_RETIRED');
  const log = ok(call(entry, 'product.audit', { id: ids.parfum }));
  assert.ok(log.some((a) => a.action === 'barcode.change'));
  assert.ok(log.some((a) => a.action === 'product.update' && a.before.brand === 'Scarlett Whitening' && a.after.brand === 'Hanasui'));
});

test('kemasan trade item opsional: SKU kemasan sendiri + GTIN kemasan, GTIN unit dasar tetap', () => {
  const d = ok(call(entry, 'product.get', { id: ids.viva }));
  const x = toInput(d);
  x.variants[0].conversions = [{ unitName: 'BOX', factor: 24, isTradeItem: true, barcode: { mode: 'gtin', code: gtin('899279601159') } }, { unitName: 'LUSIN', factor: 12 }];
  const d2 = ok(call(entry, 'product.save', { input: x }));
  const box = d2.variants[0].conversions[1];
  assert.equal(box.sku, d2.productCode + '-002', 'kemasan ber-identitas: urutan berikutnya di parent yang sama');
  assert.notEqual(box.sku, d2.variants[0].sku);
  assert.equal(box.gtin, gtin('899279601159'));
  assert.equal(d2.variants[0].gtin, '8992796011501');
  assert.equal(d2.variants[0].conversions[2].sku, '', 'kemasan operasional tanpa SKU');
  // kemasan ber-SKU: isi terkunci, tidak bisa dihapus (hanya nonaktif)
  const y = toInput(d2);
  y.variants[0].conversions[0].factor = 20;
  fail(call(entry, 'product.save', { input: y }), 'VALIDATION_FAILED');
  const z = toInput(d2);
  z.variants[0].conversions[0].status = 'DELETED';
  assert.ok(fail(call(entry, 'product.save', { input: z }), 'VALIDATION_FAILED').details[0].message.includes('hanya dinonaktifkan'));
  assert.equal(ok(call(viewer, 'barcode.lookup', { code: gtin('899279601159') })).matches[0].conversion.unitName, 'BOX');
});

test('[AC-12] duplikat produk: salin konfigurasi tanpa ID, SKU, atau GTIN', () => {
  const src = ok(call(entry, 'product.get', { id: ids.parfum }));
  // formulir Duplikat Produk mengirim atribut & kemasan saja (tanpa id, tanpa barcode)
  const dup = {
    brandId: src.brand.id,
    categoryId: src.category.id,
    name: 'Parfum Eau de Toilette',
    baseUnit: src.baseUnit,
    hasVariants: true,
    variants: src.variants.map((v) => ({ attributes: v.attributes, barcode: { mode: 'internal' }, conversions: v.conversions.filter((c) => !c.isBaseUnit).map((c) => ({ unitName: c.unitName, factor: c.factor, containsUnit: c.containsUnit })) })),
  };
  const d = ok(call(entry, 'product.save', { input: dup }));
  assert.notEqual(d.id, src.id);
  assert.notEqual(d.productCode, src.productCode);
  const srcSkus = new Set(src.variants.map((v) => v.sku));
  d.variants.forEach((v) => {
    assert.ok(!srcSkus.has(v.sku));
    assert.equal(v.gtin, '');
  });
  assert.equal(d.variants.length, src.variants.length);
});

test('[AC-15] dua user bersamaan: lock sibuk, versi basi, SKU tetap unik, GTIN sama ditolak untuk user kedua', () => {
  E.state.lockBusy = true;
  fail(call(entry2, 'product.save', { input: quick({ name: 'Gatsby Styling Pomade 75g', brandId: ids.GAT, categoryId: ids.cHAI, variants: [{ barcode: { mode: 'internal' } }] }) }), 'BUSY');
  E.state.lockBusy = false;
  const g = gtin('899555000001');
  const a = ok(call(entry, 'product.save', { input: quick({ name: 'Gatsby Styling Pomade 75g', brandId: ids.GAT, categoryId: ids.cHAI, baseUnit: 'JAR', variants: [{ barcode: { mode: 'gtin', code: g } }] }) }));
  const b = fail(call(entry2, 'product.save', { input: quick({ name: 'Gatsby Pomade Hijau', brandId: ids.GAT, categoryId: ids.cHAI, baseUnit: 'JAR', variants: [{ barcode: { mode: 'gtin', code: g } }] }) }), 'VALIDATION_FAILED');
  assert.equal(b.details[0].code, 'BARCODE_IN_USE');
  const c = ok(call(entry2, 'product.save', { input: quick({ name: 'Gatsby Water Gloss', brandId: ids.GAT, categoryId: ids.cHAI, baseUnit: 'JAR', variants: [{ barcode: { mode: 'internal' } }] }) }));
  assert.notEqual(a.variants[0].sku, c.variants[0].sku);
  assert.notEqual(a.productCode, c.productCode);
  // edit bersamaan: user kedua memakai versi lama → ditolak, tidak menimpa
  const d = ok(call(entry, 'product.get', { id: a.id }));
  ok(call(entry, 'product.save', { input: Object.assign(toInput(d), { name: 'Gatsby Styling Pomade Biru 75g' }) }));
  fail(call(entry2, 'product.save', { input: Object.assign(toInput(d), { name: 'Gatsby Pomade 75 gr' }) }), 'STALE_VERSION');
  // semua SKU & kode produk unik
  const skus = sheets.get('PRODUCT_VARIANTS').data.slice(1).map((r) => r[6]).filter(Boolean);
  assert.equal(new Set(skus).size, skus.length);
  const codes = sheets.get('MASTER_PRODUCTS').data.slice(1).map((r) => r[6]).filter(Boolean);
  assert.equal(new Set(codes).size, codes.length);
});

test('[AC-16] kegagalan penyimpanan multi-sheet → rollback; transaksi terputus dipulihkan', () => {
  const tabs = ['MASTER_PRODUCTS', 'PRODUCT_VARIANTS', 'VARIANT_ATTRIBUTES', 'UNIT_CONVERSIONS', 'VARIANT_BARCODES', 'AUDIT_LOGS', 'SYSTEM_COUNTERS'];
  const snap = () => tabs.map((t) => JSON.stringify(sheets.get(t).data.slice(0, rowsOf(sheets, t) + 1)));
  const before = snap();
  E.failWrites('UNIT_CONVERSIONS', 0);
  const input = { brandId: ids.HAN, categoryId: ids.cLIP, name: 'Hanasui Matte Lip Cream', baseUnit: 'TUBE', hasVariants: true, variants: [1, 2, 3].map((n) => ({ attributes: [{ name: 'Shade', value: '0' + n }], barcode: { mode: 'internal' }, conversions: [{ unitName: 'BOX', factor: 12 }] })) };
  fail(call(entry, 'product.save', { input }), 'WRITE_FAILED');
  E.failWrites('UNIT_CONVERSIONS', null);
  assert.deepEqual(snap(), before);
  assert.ok(sheets.get('TX_JOURNAL').data.slice(1).every((r) => r[2] === 'ROLLED_BACK'));
  ok(call(entry, 'product.save', { input }));
  // eksekusi mati di tengah penulisan (jurnal PENDING) → dibatalkan pada penulisan berikutnya
  const c = E.ctx;
  c.resetDbCache_();
  c.db_('MASTER_BRANDS').insert({ BrandID: 'crash-1', BrandCode: 'ZZZ', BrandName: 'Brand Setengah', NameKey: 'brandsetengah', Status: 'ACTIVE' });
  c.journalAppend_('tx-crash', [c.db_('MASTER_BRANDS').plan()]);
  c.db_('MASTER_BRANDS').flush();
  c.resetDbCache_();
  ok(call(entry, 'brand.create', { name: 'Somethinc' }));
  assert.ok(!ok(call(entry, 'brand.list', {})).some((b) => b.name === 'Brand Setengah'));
});

test('direktori: cari nama / SKU / barcode, filter, cache per versi data', () => {
  const p = ok(call(viewer, 'product.get', { id: ids.parfum }));
  assert.equal(ok(call(viewer, 'product.list', { search: p.variants[1].sku })).total, 1);
  assert.equal(ok(call(viewer, 'product.list', { search: p.variants[1].gtin })).total, 1);
  assert.equal(ok(call(viewer, 'product.list', { search: 'eau de parfum' })).total, 1);
  assert.equal(ok(call(viewer, 'product.list', { brandId: ids.GAT })).total, 2);
  const before = ok(call(viewer, 'product.list', { status: 'all' })).total;
  assert.ok(E.cache.get('data_ver'), 'versi data dibuat');
  ok(call(entry, 'product.save', { input: quick({ name: 'Viva Milk Cleanser Bengkoang', variants: [{ barcode: { mode: 'internal' } }] }) }));
  assert.equal(ok(call(viewer, 'product.list', { status: 'all' })).total, before + 1, 'cache basi setelah penulisan');
});

test('mapping BeeCloud/Shopee & ekspor', () => {
  const sku = ok(call(viewer, 'product.get', { id: ids.viva })).variants[0].sku;
  const m = ok(call(entry, 'mapping.create', { system: 'shopee', sku, externalProductId: '123', externalVariationId: '1', externalSku: 'VIV-TON-VAM100-8992796011501-1' }));
  ok(call(entry, 'mapping.action', { id: m.id, action: 'confirm', note: 'dicek di Seller Centre' }));
  assert.equal(ok(call(viewer, 'barcode.lookup', { code: 'VIV-TON-VAM100-8992796011501-1' })).matches[0].via, 'SKU Shopee');
  const master = ok(call(entry, 'export.data', { kind: 'master' }));
  assert.ok(master.rows.some((r) => r[1] === sku));
  const bee = ok(call(entry, 'export.data', { kind: 'beecloud', markExported: true }));
  assert.ok(bee.rows.length >= 10);
});

test('migrasi v2 → v3: barcode, mapping, penghitung & audit dipindahkan; SKU v2 tidak diganti', () => {
  const L = createGas();
  const put = (name, rows) => {
    const sh = L.ss.insertSheet(name);
    sh.data = rows.map((r) => r.map((x) => (x === undefined ? '' : String(x))));
  };
  const H = (t) => L.ctx.SCHEMA ? L.ctx.SCHEMA[t] : null;
  put('MASTER_BRANDS', [['BrandID', 'BrandCode', 'BrandName', 'NameKey', 'Status'], ['b1', 'SCA', 'Scarlett', 'scarlett', 'ACTIVE']]);
  put('MASTER_CATEGORIES', [['CategoryID', 'CategoryCode', 'CategoryName', 'NameKey', 'Status'], ['c1', 'PAR', 'Parfum', 'parfum', 'ACTIVE']]);
  put('MASTER_PRODUCTS', [['ProductID', 'ProductNo', 'BrandID', 'CategoryID', 'ProductName', 'NameKey', 'ProductCode', 'BaseUnit', 'HasVariants', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'Version'], ['p1', '1', 'b1', 'c1', 'Parfum EDP', 'parfum edp', 'PEDP', 'BOTOL', 'TRUE', 'ACTIVE', 'x', '2026-10-01', 'x', '2026-10-01', '1']]);
  put('PRODUCT_VARIANTS', [['VariantID', 'ProductID', 'VariantCode', 'VariantName', 'VariantAttributes', 'AttributeKey', 'SKU', 'GTIN', 'InternalBarcode', 'IsDefault', 'Status', 'SortOrder'], ['v1', 'p1', 'OB50', 'Ocean Blue 50 ml', '[{"name":"Aroma","value":"Ocean Blue"},{"name":"Volume","value":"50 ml"}]', 'aroma=ocean blue|volume=50ml', 'SCA-PAR-PEDP-OB50', gtin('899000000001'), '', 'FALSE', 'ACTIVE', '1']]);
  put('UNIT_CONVERSIONS', [['ConversionID', 'VariantID', 'ProductID', 'UnitName', 'ConversionFactor', 'ContainsUnit', 'BaseUnitEquivalent', 'IsBaseUnit', 'IsTradeItem', 'SKU', 'GTIN', 'InternalBarcode', 'Status', 'SortOrder'], ['u0', 'v1', 'p1', 'BOTOL', '1', 'BOTOL', '1', 'TRUE', 'FALSE', '', '', '', 'ACTIVE', '0'], ['u1', 'v1', 'p1', 'BOX', '24', 'BOTOL', '24', 'FALSE', 'TRUE', 'SCA-PAR-PEDP-OB50-BOX24', '', '2000000000046', 'ACTIVE', '1']]);
  put('Sequences', [['name', 'value'], ['product_no', '2'], ['internal_barcode', '5']]);
  put('AuditLog', [['id', 'created_at', 'actor', 'action', 'entity_type', 'entity_id', 'before_json', 'after_json', 'meta_json'], ['a1', '2026-10-01', 'x', 'product.create', 'product', 'p1', '', '{"name":"Parfum EDP"}', '']]);
  put('BARCODE_REGISTRY', [['Code', 'BarcodeType', 'Symbology', 'Status', 'VerifiedOfficial'], [gtin('899000000001'), 'gtin', 'EAN13', 'assigned', 'FALSE'], ['2000000000046', 'internal', 'EAN13', 'assigned', 'FALSE'], ['2000000000053', 'internal', 'EAN13', 'allocated', 'FALSE']]);
  put('BARCODE_ASSIGNMENTS', [['AssignmentID', 'Code', 'ProductID', 'VariantID', 'ConversionID', 'AssignedBy', 'AssignedAt', 'UnassignedBy', 'UnassignedAt', 'Reason'], ['ba1', gtin('899000000001'), 'p1', 'v1', '', 'x', '2026-10-01', '', '', ''], ['ba2', '2000000000046', 'p1', '', 'u1', 'x', '2026-10-01', '', '', '']]);
  put('SKU_MAPPINGS', [['MappingID', 'SKU', 'System', 'ExternalSku', 'ExternalProductId', 'ExternalVariationId', 'ListingName', 'MappingStatus', 'IsActive'], ['m1', 'SCA-PAR-PEDP-OB50', 'shopee', 'SCA-PAR-PEDP-OB50', '555', '1', 'Parfum', 'confirmed', 'TRUE']]);
  void H;
  const out = JSON.parse(JSON.stringify(L.ctx.setup()));
  const m = out.migration;
  assert.deepEqual([m.barcodes, m.mappings, m.counters, m.audit, m.attributes], [3, 1, 2, 1, 1]);
  const tok = JSON.parse(JSON.stringify(L.ctx.api(null, 'auth.login', { email: out.admin.email, password: out.admin.password }))).data.token;
  const api = (a, p) => JSON.parse(JSON.stringify(L.ctx.api(tok, a, p))).data;
  const d = api('product.get', { id: 'p1' });
  assert.equal(d.productCode, 'PEDP', 'kode produk v2 tidak diganti');
  assert.equal(d.variants[0].sku, 'SCA-PAR-PEDP-OB50', 'SKU v2 tidak diganti');
  assert.deepEqual(d.variants[0].attributes.map((a) => a.value), ['Ocean Blue', '50 ml']);
  assert.equal(api('barcode.lookup', { code: '2000000000046' }).matches[0].conversion.unitName, 'BOX');
  assert.equal(api('mapping.list', { system: 'shopee' }).rows[0].internalSku, 'SCA-PAR-PEDP-OB50');
  // produk baru melanjutkan penghitung lama & barcode internal tidak bentrok
  const np = api('product.save', { input: { brandId: 'b1', categoryId: 'c1', name: 'Parfum Roll On', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'internal' } }] } });
  assert.equal(np.productCode, 'PRD000002', 'produk baru melanjutkan penghitung lama');
  assert.equal(np.variants[0].sku, 'PRD000002-001');
  assert.equal(np.variants[0].internalBarcode, '2000000000060');
  assert.equal(L.sheets.get('BARCODE_REGISTRY').data.length, 4, 'tab lama tetap utuh');
  const again = JSON.parse(JSON.stringify(L.ctx.setup())).migration;
  assert.deepEqual([again.barcodes, again.mappings, again.audit], [0, 0, 0], 'idempoten');
});

test('migrasi v1 → v6: SKU lama jadi legacy SKU, Child SKU PRD…-001, multipack virtual, idempoten', () => {
  const L = createGas();
  const put = (name, rows) => {
    const sh = L.ss.insertSheet(name);
    sh.data = rows.map((r) => r.map((x) => (x === undefined ? '' : String(x))));
  };
  put('Brands', [['id', 'code', 'name', 'status'], ['b1', 'VIV', 'Viva', 'active']]);
  put('Categories', [['id', 'code', 'name', 'status'], ['c1', 'TON', 'Toner', 'active']]);
  put('Products', [['id', 'product_no', 'brand_id', 'category_id', 'product_code', 'name', 'base_unit', 'has_variants', 'status'], ['p1', '7', 'b1', 'c1', 'VAM100', 'Viva Air Mawar 100ml', 'PCS', 'FALSE', 'active']]);
  put('Variants', [['id', 'product_id', 'variant_code', 'name', 'attributes_json', 'status', 'sort_order'], ['v1', 'p1', '', '', '[]', 'active', '0']]);
  put('SKUs', [
    ['id', 'sku_code', 'product_id', 'variant_id', 'sku_type', 'pack_qty', 'sales_unit', 'status'],
    ['s1', 'VIV-TON-VAM100-8992796011501-1', 'p1', 'v1', 'single', '1', 'PCS', 'active'],
    ['s6', 'VIV-TON-VAM100-8992796011501-6', 'p1', 'v1', 'multipack', '6', 'PACK', 'active'],
    ['sb', 'PAK-BND-01', 'p1', 'v1', 'bundle', '1', 'SET', 'active'],
  ]);
  put('Barcodes', [['code', 'barcode_type'], ['8992796011501', 'gtin']]);
  put('BarcodeAssignments', [['id', 'code', 'product_id', 'variant_id', 'sku_id', 'assigned_by', 'assigned_at', 'unassigned_by', 'unassigned_at'], ['a1', '8992796011501', 'p1', 'v1', '', 'x', '2026-01-01', '', '']]);
  const out = JSON.parse(JSON.stringify(L.ctx.setup()));
  const m = out.migration;
  assert.deepEqual([m.products, m.variants, m.packs, m.legacySkus, m.barcodes], [1, 1, 1, 2, 1]);
  assert.ok(m.notMigrated.some((s) => s.includes('PAK-BND-01')));
  const tok = JSON.parse(JSON.stringify(L.ctx.api(null, 'auth.login', { email: out.admin.email, password: out.admin.password }))).data.token;
  const api = (a, p) => JSON.parse(JSON.stringify(L.ctx.api(tok, a, p))).data;
  const d = api('product.get', { id: 'p1' });
  assert.equal(d.productCode, 'PRD000007', 'migrasi v1: nomor produk lama dipertahankan');
  assert.equal(d.legacyCode, 'VAM100');
  assert.equal(d.variants[0].sku, 'PRD000007-001', 'Child SKU = Parent SKU + urutan');
  assert.equal(d.variants[0].gtin, '8992796011501', 'GTIN tersimpan terpisah');
  assert.deepEqual(d.variants[0].externalSkus.map((x) => x.sku), ['VIV-TON-VAM100-8992796011501-1']);
  assert.deepEqual(d.variants[0].conversions.map((c) => c.unitName), ['PCS'], 'paket jual tidak jadi konversi kemasan');
  const hit = api('barcode.lookup', { code: 'VIV-TON-VAM100-8992796011501-6' });
  assert.equal(hit.bundles[0].via, 'SKU lama');
  const mp = api('bundle.get', { id: hit.bundles[0].bundleId });
  assert.equal(mp.type, 'MULTIPACK');
  assert.deepEqual(mp.components.map((c) => [c.sku, c.quantity]), [[d.variants[0].sku, 6]]);
  const again = JSON.parse(JSON.stringify(L.ctx.setup())).migration;
  assert.deepEqual([again.products, again.variants, again.legacySkus], [0, 0, 0]);
});
