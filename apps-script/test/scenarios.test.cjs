/**
 * Pengujian skenario (file .gs asli dijalankan di emulator layanan Apps Script — harness.cjs).
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
let admin, entry, viewer;
const ids = {};

test('setup membuat tab baru, admin awal, login & role', () => {
  const out = JSON.parse(JSON.stringify(E.ctx.setup()));
  assert.ok(out.admin.password);
  for (const t of ['MASTER_BRANDS', 'MASTER_CATEGORIES', 'MASTER_PRODUCTS', 'PRODUCT_VARIANTS', 'UNIT_CONVERSIONS', 'BARCODE_REGISTRY', 'TX_JOURNAL']) assert.ok(sheets.get(t), t);
  assert.deepEqual(sheets.get('PRODUCT_VARIANTS').data[0].slice(0, 9), ['VariantID', 'ProductID', 'VariantCode', 'VariantName', 'VariantAttributes', 'AttributeKey', 'SKU', 'GTIN', 'InternalBarcode']);
  admin = ok(call(null, 'auth.login', { email: out.admin.email, password: out.admin.password })).token;
  fail(call(null, 'auth.login', { email: out.admin.email, password: 'salah-password' }), 'BAD_CREDENTIALS');
  ok(call(admin, 'user.create', { email: 'entry@toko.local', fullName: 'Rina', role: 'data_entry', password: 'Password#2026' }));
  ok(call(admin, 'user.create', { email: 'viewer@toko.local', fullName: 'Budi', role: 'viewer', password: 'Password#2026' }));
  entry = ok(call(null, 'auth.login', { email: 'entry@toko.local', password: 'Password#2026' })).token;
  viewer = ok(call(null, 'auth.login', { email: 'viewer@toko.local', password: 'Password#2026' })).token;
  const me = ok(call(entry, 'auth.me'));
  assert.equal(me.config.skuTemplate, '{BRAND}-{CATEGORY}-{PRODUCT}-{VARIANT}');
  assert.ok(me.config.baseUnits.includes('BOTOL'));
  fail(call('token-palsu', 'product.list', {}), 'UNAUTHENTICATED');
  fail(call(viewer, 'brand.create', { name: 'Wardah' }), 'FORBIDDEN');
  fail(call(entry, 'user.list', {}), 'FORBIDDEN');
});

test('Master Brand: kode otomatis 3 huruf, unik, permanen', () => {
  const expect = { Viva: 'VIV', Hanasui: 'HAN', Purbasari: 'PUR', Scarlett: 'SCA' };
  for (const [name, code] of Object.entries(expect)) {
    assert.equal(ok(call(entry, 'brand.preview', { name })).code, code);
    const b = ok(call(entry, 'brand.create', { name }));
    assert.equal(b.code, code);
    ids[code] = b.id;
  }
  // konflik: VIV sudah dipakai Viva → Vivelle dapat kode lain yang unik
  const v2 = ok(call(entry, 'brand.create', { name: 'Vivelle' }));
  assert.notEqual(v2.code, 'VIV');
  assert.match(v2.code, /^[A-Z0-9]{3}$/);
  // duplikasi nama dengan beda penulisan → ditolak
  for (const n of ['viva', '  VIVA ', 'V.I.V.A']) fail(call(entry, 'brand.create', { name: n }), 'DUPLICATE');
  ok(call(entry, 'brand.create', { name: 'Make Over' }));
  fail(call(entry, 'brand.create', { name: 'Makeover' }), 'DUPLICATE');
  // nama mirip → peringatan, bisa dikonfirmasi
  const sim = fail(call(entry, 'brand.create', { name: 'Hanasuii' }), 'SIMILAR_EXISTS');
  assert.ok(sim.details[0].message.includes('Hanasui'));
  const hs = ok(call(entry, 'brand.create', { name: 'Hanasuii', acknowledgeSimilar: true }));
  assert.notEqual(hs.code, 'HAN');
  // ganti nama → kode tetap
  const ren = ok(call(entry, 'brand.rename', { id: ids.SCA, name: 'Scarlett Whitening' }));
  assert.equal(ren.code, 'SCA');
  assert.equal(ren.name, 'Scarlett Whitening');
  fail(call(entry, 'brand.rename', { id: ids.SCA, name: 'Viva' }), 'DUPLICATE');
  // nonaktif → tidak bisa dipakai registrasi, kode tetap tidak dipakai ulang
  ok(call(entry, 'brand.setStatus', { id: hs.id, status: 'INACTIVE' }));
  const again = ok(call(entry, 'brand.preview', { name: 'Hanasuii' }));
  assert.equal(again.exact.status, 'INACTIVE');
  // tambah banyak: duplikat dilewati dengan alasan
  const many = ok(call(entry, 'brand.createMany', { names: ['Wardah', 'Emina', 'wardah', 'Implora'] }));
  assert.equal(many.created.length, 3);
  assert.equal(many.skipped.length, 1);
  const codes = ok(call(entry, 'brand.list', {})).map((b) => b.code);
  assert.equal(new Set(codes).size, codes.length, 'kode brand harus unik');
});

test('Master Kategori: kode otomatis', () => {
  const expect = { Parfum: 'PAR', Lipstick: 'LIP', 'Body Lotion': 'BOD', 'Facial Wash': 'FAC', Toner: 'TON' };
  for (const [name, code] of Object.entries(expect)) {
    const c = ok(call(entry, 'category.create', { name }));
    assert.equal(c.code, code);
    ids['c' + code] = c.id;
  }
  // banyak nama berawalan sama tetap mendapat kode unik
  const made = ok(call(entry, 'category.createMany', { names: ['Parfum Pria', 'Parfum Wanita', 'Parfum Anak', 'Parfum Mobil', 'Parfum Ruangan'], acknowledgeSimilar: true })).created;
  assert.equal(made.length, 5);
  const codes = ok(call(entry, 'category.list', {})).map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
});

const parfumInput = () => ({
  brandId: ids.SCA,
  categoryId: ids.cPAR,
  name: 'Parfum Eau de Parfum',
  productCode: '',
  baseUnit: 'BOTOL',
  hasVariants: true,
  variants: [
    { attributes: [{ name: 'Aroma', value: 'Ocean Blue' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'gtin', code: gtin('899000000001') }, conversions: [{ unitName: 'BOX', factor: 24, containsUnit: 'BOTOL', isTradeItem: true, barcode: { mode: 'gtin', code: gtin('899000000091') } }, { unitName: 'KARTON', factor: 6, containsUnit: 'BOX' }] },
    { attributes: [{ name: 'Aroma', value: 'Ocean Blue' }, { name: 'Volume', value: '100 ml' }], barcode: { mode: 'gtin', code: gtin('899000000002') }, conversions: [{ unitName: 'BOX', factor: 12, containsUnit: 'BOTOL' }] },
    { attributes: [{ name: 'Aroma', value: 'Rose Garden' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'gtin', code: gtin('899000000003') }, conversions: [] },
    { attributes: [{ name: 'Aroma', value: 'Rose Garden' }, { name: 'Volume', value: '100 ml' }], barcode: { mode: 'internal' }, conversions: [] },
  ],
});

test('dry-run (pratinjau) memvalidasi penuh tanpa menulis apa pun', () => {
  const before = ['MASTER_PRODUCTS', 'PRODUCT_VARIANTS', 'UNIT_CONVERSIONS', 'BARCODE_REGISTRY', 'AuditLog'].map((t) => rowsOf(sheets, t));
  const d = ok(call(entry, 'product.validate', { input: parfumInput() }));
  assert.equal(d.dryRun, true);
  assert.equal(d.variants.length, 4);
  const after = ['MASTER_PRODUCTS', 'PRODUCT_VARIANTS', 'UNIT_CONVERSIONS', 'BARCODE_REGISTRY', 'AuditLog'].map((t) => rowsOf(sheets, t));
  assert.deepEqual(after, before);
});

test('registrasi parfum: 2 aroma × 2 volume, GTIN per varian, konversi bertingkat, kemasan ber-SKU', () => {
  const d = ok(call(entry, 'product.save', { input: parfumInput() }));
  ids.parfum = d.id;
  assert.equal(d.status, 'ACTIVE');
  assert.equal(d.productCode, 'PEDP');
  assert.deepEqual(
    d.variants.map((v) => v.sku),
    ['SCA-PAR-PEDP-OB50', 'SCA-PAR-PEDP-OB100', 'SCA-PAR-PEDP-RG50', 'SCA-PAR-PEDP-RG100'],
  );
  assert.equal(new Set(d.variants.map((v) => v.id)).size, 4);
  assert.equal(d.variants[0].gtin, gtin('899000000001'));
  assert.equal(d.variants[3].gtin, '');
  assert.match(d.variants[3].internalBarcode, /^200\d{10}$/);
  const v1 = d.variants[0].conversions;
  assert.deepEqual(
    v1.map((c) => [c.unitName, c.factor, c.containsUnit, c.baseUnitEquivalent]),
    [['BOTOL', 1, 'BOTOL', 1], ['BOX', 24, 'BOTOL', 24], ['KARTON', 6, 'BOX', 144]],
  );
  assert.equal(v1[1].sku, 'SCA-PAR-PEDP-OB50-BOX24');
  assert.equal(v1[1].gtin, gtin('899000000091'));
  assert.equal(v1[2].sku, '');
  // varian lain boleh punya isi BOX berbeda
  assert.equal(d.variants[1].conversions[1].baseUnitEquivalent, 12);
  // GTIN tidak disimpan di level product master
  assert.equal(sheets.get('MASTER_PRODUCTS').data[0].indexOf('GTIN'), -1);
  // langsung muncul di direktori
  const list = ok(call(viewer, 'product.list', { search: 'ocean' }));
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].skuCount, 5);
  assert.equal(list.rows[0].complete, true);
  // pencarian dengan GTIN & SKU
  assert.equal(ok(call(viewer, 'product.list', { search: gtin('899000000003') })).total, 1);
  assert.equal(ok(call(viewer, 'product.list', { search: 'SCA-PAR-PEDP-RG100' })).total, 1);
});

test('kalkulator konversi: 3 BOX = 72 BOTOL, 1 KARTON = 144 BOTOL', () => {
  const v = ok(call(viewer, 'product.get', { id: ids.parfum })).variants[0];
  assert.equal(ok(call(viewer, 'unit.convert', { variantId: v.id, qty: 3, unit: 'BOX' })).baseQty, 72);
  assert.equal(ok(call(viewer, 'unit.convert', { variantId: v.id, qty: 1, unit: 'karton' })).baseQty, 144);
  fail(call(viewer, 'unit.convert', { variantId: v.id, qty: 1, unit: 'LUSIN' }));
});

test('validasi integritas: kombinasi ganda, GTIN ganda/terpakai/salah, konversi tidak valid, kode produk ganda', () => {
  const base = () => ({ brandId: ids.VIV, categoryId: ids.cTON, name: 'Viva Air Mawar', baseUnit: 'BOTOL', hasVariants: true });
  // kombinasi atribut identik (urutan & huruf berbeda) + GTIN sama di dua baris
  const e1 = fail(
    call(entry, 'product.save', {
      input: Object.assign(base(), {
        variants: [
          { attributes: [{ name: 'Volume', value: '100 ml' }], barcode: { mode: 'gtin', code: gtin('899111000001') } },
          { attributes: [{ name: 'volume', value: '100ML' }], barcode: { mode: 'gtin', code: gtin('899111000001') } },
        ],
      }),
    }),
    'VALIDATION_FAILED',
  );
  const paths = e1.details.map((d) => d.path);
  assert.ok(paths.includes('variants.1.attributes'), JSON.stringify(e1.details));
  assert.ok(paths.includes('variants.1.barcode'));
  // GTIN yang sudah dipakai produk lain → ditolak dengan info pemilik
  const e2 = fail(call(entry, 'product.save', { input: Object.assign(base(), { variants: [{ attributes: [{ name: 'Volume', value: '100 ml' }], barcode: { mode: 'gtin', code: gtin('899000000002') } }] }) }), 'VALIDATION_FAILED');
  assert.equal(e2.details[0].code, 'BARCODE_IN_USE');
  assert.ok(e2.details[0].message.includes('Parfum Eau de Parfum'));
  // check digit salah & prefix internal sebagai GTIN produsen
  const e3 = fail(call(entry, 'product.save', { input: Object.assign(base(), { variants: [{ attributes: [{ name: 'Volume', value: '1' }], barcode: { mode: 'gtin', code: '8991110000020' } }, { attributes: [{ name: 'Volume', value: '2' }], barcode: { mode: 'gtin', code: gtin('200000000777') } }] }) }), 'VALIDATION_FAILED');
  assert.equal(e3.details.length, 2);
  // konversi: satuan = satuan dasar, isi < 2, satuan isi belum didefinisikan (urutan), satuan ganda
  const e4 = fail(
    call(entry, 'product.save', {
      input: Object.assign(base(), {
        variants: [{ attributes: [{ name: 'Volume', value: '100 ml' }], barcode: { mode: 'none' }, conversions: [{ unitName: 'BOTOL', factor: 2 }, { unitName: 'KARTON', factor: 6, containsUnit: 'BOX' }, { unitName: 'BOX', factor: 1 }, { unitName: 'BOX', factor: 12 }] }],
      }),
    }),
    'VALIDATION_FAILED',
  );
  const p4 = e4.details.map((d) => d.path);
  for (const p of ['variants.0.conversions.0.unitName', 'variants.0.conversions.1.containsUnit', 'variants.0.conversions.2.factor', 'variants.0.conversions.3.unitName']) assert.ok(p4.includes(p), p + ' ' + JSON.stringify(e4.details));
  // kode produk ganda dalam satu brand
  ok(call(entry, 'product.save', { input: Object.assign(base(), { productCode: 'VAM', variants: [{ attributes: [{ name: 'Volume', value: '100 ml' }], barcode: { mode: 'none' } }] }) }));
  const e5 = fail(call(entry, 'product.save', { input: Object.assign(base(), { name: 'Viva Toner Lemon', productCode: 'vam', variants: [{ attributes: [{ name: 'Volume', value: '100 ml' }] }] }) }), 'VALIDATION_FAILED');
  assert.equal(e5.details[0].path, 'productCode');
  // brand nonaktif tidak boleh dipakai
  const inactive = ok(call(entry, 'brand.list', {})).find((b) => b.status === 'INACTIVE');
  const e6 = fail(call(entry, 'product.save', { input: Object.assign(base(), { brandId: inactive.id, productCode: 'X1', variants: [{ attributes: [{ name: 'Volume', value: '1' }] }] }) }), 'VALIDATION_FAILED');
  assert.equal(e6.details[0].path, 'brandId');
  // tidak ada yang tersimpan setengah
  assert.equal(ok(call(viewer, 'product.list', { brandId: ids.VIV })).total, 1);
});

test('produk tanpa varian: satu varian default, SKU tanpa segmen varian, barcode internal otomatis', () => {
  const d = ok(call(entry, 'product.save', { input: { brandId: ids.PUR, categoryId: ids.cBOD, name: 'Purbasari Hand Body Lotion 250ml', baseUnit: 'BOTOL', hasVariants: false, variants: [{ barcode: { mode: 'internal' }, conversions: [{ unitName: 'LUSIN', factor: 12 }] }] } }));
  assert.equal(d.productCode, 'PHBL250');
  assert.equal(d.variants.length, 1);
  assert.equal(d.variants[0].isDefault, true);
  assert.equal(d.variants[0].sku, 'PUR-BOD-PHBL250');
  const code = d.variants[0].internalBarcode;
  assert.match(code, /^200\d{10}$/);
  assert.equal(ok(call(viewer, 'barcode.validate', { mode: 'internal', code })).ok, true);
  // kemiripan nama → peringatan, perlu konfirmasi
  const sim = fail(call(entry, 'product.save', { input: { brandId: ids.PUR, categoryId: ids.cBOD, name: 'Purbasari Hand & Body Lotion 250 ml', productCode: 'PHB2', baseUnit: 'BOTOL', variants: [{}] } }), 'SIMILAR_EXISTS');
  assert.ok(sim.details[0].message.includes('Purbasari Hand Body Lotion'));
  // produk tanpa varian tidak boleh dua varian default
  fail(call(entry, 'product.save', { input: { brandId: ids.PUR, categoryId: ids.cBOD, name: 'Purbasari Sabun', baseUnit: 'PCS', variants: [{}, {}] } }), 'VALIDATION_FAILED');
});

test('edit produk: tambah varian, identitas permanen, ganti GTIN wajib alasan, kemasan ber-SKU terkunci', () => {
  const d = ok(call(entry, 'product.get', { id: ids.parfum }));
  const toInput = (x) => ({
    productId: x.id,
    version: x.version,
    name: x.name,
    variants: x.variants.map((v) => ({ id: v.id, name: v.name, attributes: v.attributes, variantCode: v.code, status: v.status, barcode: { mode: v.barcodeType, code: v.gtin || v.internalBarcode }, conversions: v.conversions.filter((c) => !c.isBaseUnit).map((c) => ({ id: c.id, unitName: c.unitName, factor: c.factor, containsUnit: c.containsUnit, isTradeItem: c.isTradeItem, status: c.status, barcode: { mode: c.gtin ? 'gtin' : c.internalBarcode ? 'internal' : 'none', code: c.gtin || c.internalBarcode } })) })),
  });
  // tambah varian baru (Vanilla 50 ml)
  const inp = toInput(d);
  inp.variants.push({ attributes: [{ name: 'Aroma', value: 'Vanilla' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'gtin', code: gtin('899000000004') }, conversions: [{ unitName: 'BOX', factor: 24 }] });
  const d2 = ok(call(entry, 'product.save', { input: inp }));
  assert.equal(d2.variants.length, 5);
  assert.equal(d2.variants[4].sku, 'SCA-PAR-PEDP-VA50');
  assert.equal(d2.version, d.version + 1);
  // versi lama → ditolak (perubahan bersamaan)
  fail(call(entry, 'product.save', { input: inp }), 'STALE_VERSION');
  // atribut tersimpan tidak boleh diubah, brand terkunci
  let x = toInput(d2);
  x.variants[0].attributes = [{ name: 'Aroma', value: 'Ocean Breeze' }, { name: 'Volume', value: '50 ml' }];
  x.brandId = ids.VIV;
  const e1 = fail(call(entry, 'product.save', { input: x }), 'VALIDATION_FAILED');
  assert.deepEqual(e1.details.map((e) => e.path).sort(), ['brandId', 'variants.0.attributes']);
  // ganti GTIN tanpa alasan → ditolak; dengan alasan → GTIN lama dipensiunkan
  x = toInput(d2);
  x.variants[2].barcode = { mode: 'gtin', code: gtin('899000000013') };
  const e2 = fail(call(entry, 'product.save', { input: x }), 'VALIDATION_FAILED');
  assert.equal(e2.details[0].code, 'REASON_REQUIRED');
  x.variants[2].barcodeChangeReason = 'Salah input barcode saat registrasi';
  const d3 = ok(call(entry, 'product.save', { input: x }));
  assert.equal(d3.variants[2].gtin, gtin('899000000013'));
  assert.equal(ok(call(viewer, 'barcode.history', { code: gtin('899000000003') })).barcode.status, 'retired');
  // barcode yang sudah dipensiunkan tidak boleh dipakai barang lain
  const e3 = fail(call(entry, 'product.save', { input: { brandId: ids.VIV, categoryId: ids.cTON, name: 'Viva Milk Cleanser', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'gtin', code: gtin('899000000003') } }] } }), 'VALIDATION_FAILED');
  assert.equal(e3.details[0].code, 'BARCODE_RETIRED');
  // isi kemasan ber-SKU tidak boleh diubah; kemasan operasional boleh
  x = toInput(d3);
  x.variants[0].conversions[0].factor = 20;
  const e4 = fail(call(entry, 'product.save', { input: x }), 'VALIDATION_FAILED');
  assert.ok(e4.details[0].message.includes('SKU-nya permanen'));
  x = toInput(d3);
  x.variants[1].conversions[0].factor = 10;
  const d4 = ok(call(entry, 'product.save', { input: x }));
  assert.equal(d4.variants[1].conversions[1].baseUnitEquivalent, 10);
  // satuan yang masih menjadi isi kemasan lain tidak boleh dinonaktifkan
  x = toInput(d4);
  x.variants[0].conversions[0].status = 'INACTIVE';
  const e5 = fail(call(entry, 'product.save', { input: x }), 'VALIDATION_FAILED');
  assert.ok(e5.details.some((e) => e.message.includes('masih dipakai sebagai isi')));
  // audit log mencatat perubahan
  const log = ok(call(entry, 'product.audit', { id: ids.parfum }));
  assert.ok(log.some((a) => a.action === 'barcode.change'));
  assert.ok(log.filter((a) => a.action === 'product.update').length >= 3);
});

test('nonaktifkan varian & produk', () => {
  const d = ok(call(entry, 'product.get', { id: ids.parfum }));
  ok(call(entry, 'variant.setStatus', { id: d.variants[4].id, status: 'INACTIVE' }));
  fail(call(entry, 'product.setStatus', { id: ids.parfum, status: 'INACTIVE' }), 'VALIDATION_FAILED');
  ok(call(entry, 'product.setStatus', { id: ids.parfum, status: 'INACTIVE', reason: 'Tidak dijual lagi' }));
  assert.equal(ok(call(viewer, 'product.list', { status: 'ACTIVE', search: 'parfum' })).total, 0);
  ok(call(entry, 'product.setStatus', { id: ids.parfum, status: 'ACTIVE' }));
});

test('mapping BeeCloud/Shopee & ekspor memakai SKU varian + kemasan', () => {
  const master = ok(call(entry, 'export.data', { kind: 'master' }));
  const skus = master.rows.map((r) => r[1]);
  assert.ok(skus.includes('SCA-PAR-PEDP-OB50'));
  assert.ok(skus.includes('SCA-PAR-PEDP-OB50-BOX24'));
  const conv = ok(call(entry, 'export.data', { kind: 'conversions' }));
  assert.ok(conv.rows.some((r) => r[4] === 'KARTON' && r[7] === 144));
  const un = ok(call(entry, 'mapping.unmapped', { system: 'shopee', search: 'OB50' }));
  assert.equal(un.length, 2);
  const m = ok(call(entry, 'mapping.create', { system: 'shopee', sku: 'SCA-PAR-PEDP-OB50', externalProductId: '123456', externalVariationId: '1', externalSku: 'SCA-PAR-PEDP-OB50' }));
  fail(call(entry, 'mapping.create', { system: 'shopee', sku: 'SCA-PAR-PEDP-OB100', externalProductId: '123456', externalVariationId: '1' }), 'DUPLICATE');
  ok(call(entry, 'mapping.action', { id: m.id, action: 'confirm', note: 'dicek di Seller Centre' }));
  const bee = ok(call(entry, 'export.data', { kind: 'beecloud', markExported: true }));
  assert.ok(bee.rows.length >= 5);
  assert.equal(ok(call(entry, 'mapping.list', { system: 'beecloud' })).total, bee.rows.length);
  fail(call(viewer, 'mapping.create', { system: 'beecloud', sku: 'PUR-BOD-PHBL250' }), 'FORBIDDEN');
});

test('pengaturan: template SKU tervalidasi, satuan dasar yang dipakai tidak bisa dihapus', () => {
  fail(call(admin, 'settings.save', { sku_template: '{BRAND}-{PRODUCT}' }));
  fail(call(admin, 'settings.save', { base_units: ['PCS', 'TUBE'] }));
  const s = ok(call(admin, 'settings.save', { pack_units: 'box, karton, inner, display' }));
  assert.deepEqual(s.pack_units, ['BOX', 'KARTON', 'INNER', 'DISPLAY']);
  fail(call(entry, 'settings.save', { pack_units: ['BOX'] }), 'FORBIDDEN');
});

test('rollback: penulisan gagal di tengah commit → tidak ada data tersimpan setengah', () => {
  const tabs = ['MASTER_PRODUCTS', 'PRODUCT_VARIANTS', 'UNIT_CONVERSIONS', 'BARCODE_REGISTRY', 'BARCODE_ASSIGNMENTS', 'AuditLog', 'Sequences'];
  const snap = () => tabs.map((t) => JSON.stringify(sheets.get(t).data.slice(0, rowsOf(sheets, t) + 1)));
  const before = snap();
  E.failWrites('UNIT_CONVERSIONS', 0); // tulisan pertama ke UNIT_CONVERSIONS gagal (setelah tabel lain sudah tertulis)
  const input = { brandId: ids.HAN, categoryId: ids.cLIP, name: 'Hanasui Matte Lip Cream', baseUnit: 'TUBE', hasVariants: true, variants: [1, 2, 3].map((n) => ({ attributes: [{ name: 'Shade', value: 'Shade 0' + n }], barcode: { mode: 'internal' }, conversions: [{ unitName: 'BOX', factor: 12 }] })) };
  fail(call(entry, 'product.save', { input }), 'WRITE_FAILED');
  E.failWrites('UNIT_CONVERSIONS', null);
  assert.deepEqual(snap(), before);
  const j = sheets.get('TX_JOURNAL').data.slice(1);
  assert.ok(j.length && j.every((r) => r[2] === 'ROLLED_BACK'));
  // setelah gangguan selesai, simpan ulang berhasil normal
  const d = ok(call(entry, 'product.save', { input }));
  assert.deepEqual(d.variants.map((v) => v.sku), ['HAN-LIP-HMLC-S01', 'HAN-LIP-HMLC-S02', 'HAN-LIP-HMLC-S03']);
});

test('pemulihan: transaksi yang terputus total (PENDING) dibatalkan pada penulisan berikutnya', () => {
  const c = E.ctx;
  const brandRows = rowsOf(sheets, 'MASTER_BRANDS');
  // simulasi eksekusi yang mati setelah sebagian data tertulis (jurnal masih PENDING)
  c.resetDbCache_();
  c.db_('MASTER_BRANDS').insert({ BrandID: 'crash-1', BrandCode: 'ZZZ', BrandName: 'Brand Setengah', NameKey: 'brandsetengah', Status: 'ACTIVE' });
  const plan = [c.db_('MASTER_BRANDS').plan()];
  c.journalAppend_('tx-crash', plan);
  c.db_('MASTER_BRANDS').flush();
  c.resetDbCache_();
  assert.equal(rowsOf(sheets, 'MASTER_BRANDS'), brandRows + 1);
  ok(call(entry, 'brand.create', { name: 'Somethinc' }));
  const names = ok(call(entry, 'brand.list', {})).map((b) => b.name);
  assert.ok(!names.includes('Brand Setengah'));
  assert.ok(names.includes('Somethinc'));
  assert.ok(sheets.get('TX_JOURNAL').data.some((r) => r[0] === 'tx-crash' && r[2] === 'ROLLED_BACK'));
});

test('migrasi eksplisit dari struktur lama: SKU lama dipertahankan, idempoten', () => {
  const L = createGas();
  const put = (name, rows) => {
    const sh = L.ss.insertSheet(name);
    sh.data = rows.map((r) => r.map((x) => (x === undefined ? '' : String(x))));
  };
  put('Brands', [['id', 'code', 'name', 'name_norm', 'manufacturer', 'notes', 'status'], ['b1', 'VIV', 'Viva', 'viva', '', '', 'active'], ['b2', 'ASDAS', 'asda', 'asda', '', '', 'pending']]);
  put('Categories', [['id', 'code', 'name', 'name_norm', 'notes', 'status'], ['c1', 'TON', 'Toner', 'toner', '', 'active']]);
  put('Products', [['id', 'product_no', 'brand_id', 'category_id', 'product_code', 'name', 'name_norm', 'token_key', 'product_type', 'description', 'base_unit', 'has_variants', 'status'], ['p1', '7', 'b1', 'c1', 'VAM100', 'Viva Air Mawar 100ml', '', '', 'standard', '', 'PCS', 'FALSE', 'active']]);
  put('Variants', [['id', 'variant_no', 'product_id', 'variant_code', 'name', 'attributes_json', 'signature', 'is_default', 'status', 'sort_order'], ['v1', '1', 'p1', '', '', '[]', '', 'TRUE', 'active', '0']]);
  put('SKUs', [
    ['id', 'sku_no', 'sku_code', 'product_id', 'variant_id', 'sku_type', 'pack_qty', 'sales_unit', 'display_name', 'status'],
    ['s1', '1', 'VIV-TON-VAM100-8992796011501-1', 'p1', 'v1', 'single', '1', 'PCS', 'Viva Air Mawar', 'active'],
    ['s6', '2', 'VIV-TON-VAM100-8992796011501-6', 'p1', 'v1', 'multipack', '6', 'PACK', 'Viva Air Mawar - 6', 'active'],
    ['s12', '3', 'VIV-TON-VAM100-8992796011501-12', 'p1', 'v1', 'multipack', '12', 'PACK', 'Viva Air Mawar - 12', 'active'],
    ['sb', '4', 'PAK-BND-01', 'p1', 'v1', 'bundle', '1', 'SET', 'Bundle', 'active'],
  ]);
  put('Barcodes', [['code', 'barcode_type', 'symbology', 'status', 'verified_official'], ['8992796011501', 'gtin', 'EAN13', 'assigned', 'FALSE']]);
  put('BarcodeAssignments', [['id', 'code', 'product_id', 'variant_id', 'sku_id', 'assigned_by', 'assigned_at', 'unassigned_by', 'unassigned_at', 'reason'], ['a1', '8992796011501', 'p1', 'v1', '', 'x', '2026-01-01', '', '', '']]);
  put('Mappings', [['id', 'sku_id', 'system', 'external_sku', 'external_product_id', 'external_variation_id', 'listing_name', 'mapping_status', 'is_active'], ['m1', 's6', 'shopee', 'VIV-TON-VAM100-8992796011501-6', '999', '', 'Viva', 'confirmed', 'TRUE']]);
  const out = JSON.parse(JSON.stringify(L.ctx.setup()));
  const m = out.migration;
  assert.deepEqual([m.brands, m.categories, m.products, m.variants, m.packs, m.barcodes, m.assignments, m.mappings], [2, 1, 1, 1, 2, 1, 1, 1]);
  assert.ok(m.notMigrated.some((s) => s.includes('PAK-BND-01')));
  const tok = JSON.parse(JSON.stringify(L.ctx.api(null, 'auth.login', { email: out.admin.email, password: out.admin.password }))).data.token;
  const d = JSON.parse(JSON.stringify(L.ctx.api(tok, 'product.get', { id: 'p1' }))).data;
  assert.equal(d.productNo, 'PRD-000007');
  assert.equal(d.variants[0].sku, 'VIV-TON-VAM100-8992796011501-1');
  assert.equal(d.variants[0].gtin, '8992796011501');
  assert.deepEqual(d.variants[0].conversions.map((c) => [c.unitName, c.baseUnitEquivalent, c.sku]), [['PCS', 1, ''], ['PACK', 6, 'VIV-TON-VAM100-8992796011501-6'], ['PACK12', 12, 'VIV-TON-VAM100-8992796011501-12']]);
  const brands = JSON.parse(JSON.stringify(L.ctx.api(tok, 'brand.list', {}))).data;
  assert.equal(brands.find((b) => b.code === 'ASDAS').status, 'INACTIVE');
  // tab lama tetap utuh
  assert.equal(L.sheets.get('SKUs').data.length, 5);
  // dijalankan ulang → tidak ada duplikasi
  const again = JSON.parse(JSON.stringify(L.ctx.setup())).migration;
  assert.deepEqual([again.brands, again.products, again.variants, again.packs, again.mappings], [0, 0, 0, 0, 0]);
  // nomor produk baru melanjutkan nomor lama
  const np = JSON.parse(JSON.stringify(L.ctx.api(tok, 'product.save', { input: { brandId: 'b1', categoryId: 'c1', name: 'Viva Face Tonic', baseUnit: 'BOTOL', variants: [{}] } }))).data;
  assert.equal(np.productNo, 'PRD-000008');
});
