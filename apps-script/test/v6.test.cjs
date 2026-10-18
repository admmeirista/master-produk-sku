/**
 * Pengujian revisi v6 — kodifikasi SKU sederhana & independen:
 *   Parent PRD000001 (urut global) · Child PRD000001-001 (urut per parent) · Multipack MP000001 · Bundle BD000001.
 *   Brand & kategori tanpa kode; GTIN terpisah dari SKU (lookup lewat tabel barcode).
 * File .gs asli dijalankan di emulator (harness.cjs). Nomor [Tn] = 22 skenario uji pada brief v6.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
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
const rows = (tab) => G.sheets.get(tab).data.slice(1).filter((r) => r.some((x) => x !== '' && x !== undefined));
function gtin(body12) {
  let sum = 0;
  for (let i = 11, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body12[i]) * w;
  return body12 + ((10 - (sum % 10)) % 10);
}
const g = (n) => gtin('8991234' + String(n).padStart(5, '0'));

/** Baca .xlsx seperti di browser (SheetJS): cari baris header berisi kolom nama, kirim [{row, name}]. */
function readMasterXlsx(buf, nameHeaders) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim();
  const h = data.findIndex((r) => r.some((c) => nameHeaders.indexOf(norm(c)) >= 0));
  const ni = data[h].findIndex((c) => nameHeaders.indexOf(norm(c)) >= 0);
  return data.slice(h + 1).map((r, i) => ({ row: h + i + 2, name: String(r[ni] || '') })).filter((x) => x.name.trim());
}
function xlsxOf(aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
function toInput(d) {
  return {
    productId: d.id,
    version: d.version,
    brandId: d.brand.id,
    categoryId: d.category.id,
    name: d.name,
    baseUnit: d.baseUnit,
    variants: d.variants.map((v) => ({
      id: v.id,
      attributes: v.attributes,
      status: v.status,
      barcode: { mode: v.barcodeType, code: v.gtin || v.internalBarcode },
      baseUnit: v.baseUnit,
      conversions: v.conversions.filter((c) => !c.isBaseUnit).map((c) => ({ id: c.id, unitName: c.unitName, factor: c.factor, containsUnit: c.containsUnit, isTradeItem: c.isTradeItem, status: c.status, barcode: c.isTradeItem ? { mode: c.gtin ? 'gtin' : 'internal', code: c.gtin || c.internalBarcode } : { mode: 'none' } })),
      dimensions: v.dimensions.map((x) => ({ unit: x.unit, lengthCm: x.lengthCm, widthCm: x.widthCm, heightCm: x.heightCm, weight: x.grossWeightGrams, weightUnit: 'g' })),
    })),
  };
}

let T, T2, V;
const B = {};
const C = {};
const P = {};
const save = (tok, input) => ok(call(tok, 'product.save', { input }));
const simple = (brand, cat, name, barcode, extra) => Object.assign({ brandId: B[brand].id, categoryId: C[cat].id, name, baseUnit: 'PCS', variants: [{ barcode: barcode || { mode: 'none' } }] }, extra || {});

test('persiapan: setup, pengguna', () => {
  const out = JSON.parse(JSON.stringify(G.ctx.setup()));
  assert.ok(G.sheets.get('PRODUCT_DIMENSIONS'));
  assert.deepEqual(G.sheets.get('SYSTEM_COUNTERS').data[0], ['CounterName', 'Value', 'UpdatedAt', 'ScopeID']);
  const admin = ok(call(null, 'auth.login', { email: out.admin.email, password: out.admin.password })).token;
  for (const [e, role] of [['entry@toko.local', 'data_entry'], ['entry2@toko.local', 'data_entry'], ['viewer@toko.local', 'viewer']]) ok(call(admin, 'user.create', { email: e, fullName: e, role, password: 'Password#2026' }));
  const login = (e) => ok(call(null, 'auth.login', { email: e, password: 'Password#2026' })).token;
  T = login('entry@toko.local');
  T2 = login('entry2@toko.local');
  V = login('viewer@toko.local');
});

test('[T16][T17] import XLSX Master Brand & Kategori: hanya nama, tanpa kode; berhasil/dilewati/gagal per baris', () => {
  const bfile = xlsxOf([['Daftar brand'], ['Nama Brand'], ['Hanasui'], ['Viva'], ['Purbasari'], ['Wardah'], ['  hanasui '], ['X']]);
  const blist = readMasterXlsx(bfile, ['nama brand', 'brand']);
  const before = rows('MASTER_BRANDS').length;
  const pv = ok(call(T, 'brand.importPreview', { fileName: 'brand.xlsx', rows: blist }));
  assert.equal(rows('MASTER_BRANDS').length, before, 'pratinjau tidak menulis');
  assert.deepEqual(pv.counts, { success: 4, skipped: 1, failed: 1 });
  const res = ok(call(T, 'brand.import', { fileName: 'brand.xlsx', rows: blist }));
  assert.deepEqual(res.counts, { success: 4, skipped: 1, failed: 1 });
  assert.ok(res.rows.every((r) => r.code === undefined), 'tidak ada kode brand di hasil');
  const brands = ok(call(V, 'brand.list', {}));
  brands.forEach((b) => (B[b.name] = b));
  assert.ok(brands.every((b) => b.code === undefined && b.id), 'brand hanya punya ID internal & nama');
  assert.ok(rows('MASTER_BRANDS').every((r) => r[1] === ''), 'kolom BrandCode kosong untuk data baru');
  const cfile = xlsxOf([['Nama Kategori'], ['Pelembab Wajah'], ['Air Mawar'], ['Body Serum'], ['Sunscreen'], ['Toner']]);
  const cres = ok(call(T, 'category.import', { fileName: 'kategori.xlsx', rows: readMasterXlsx(cfile, ['nama kategori', 'kategori']) }));
  assert.deepEqual(cres.counts, { success: 5, skipped: 0, failed: 0 });
  ok(call(V, 'category.list', {})).forEach((c) => (C[c.name] = c));
  assert.ok(Object.values(C).every((c) => c.code === undefined));
});

test('[T17] nama brand sama tidak terduplikasi (manual & import ulang)', () => {
  for (const n of ['HANASUI', 'Hana sui', 'hanasui.']) fail(call(T, 'brand.create', { name: n }), 'DUPLICATE');
  const again = ok(call(T, 'brand.import', { fileName: 'brand.xlsx', rows: [{ row: 2, name: 'Hanasui' }, { row: 3, name: 'Viva' }] }));
  assert.deepEqual(again.counts, { success: 0, skipped: 2, failed: 0 });
  assert.equal(ok(call(V, 'brand.list', {})).filter((b) => b.name.toLowerCase() === 'hanasui').length, 1);
});

test('[T1][T2][T4][T5][T7] Parent SKU urut global lintas brand & kategori; 4 kombinasi → 001–004; GTIN bukan bagian SKU', () => {
  const pv = ok(call(T, 'product.parentPreview', { brandId: B.Hanasui.id, name: 'Pelembab Wajah' }));
  assert.equal(pv.parentSku, 'PRD000001');
  assert.equal(pv.displayName, 'Hanasui Pelembab Wajah');
  assert.equal(rows('MASTER_PRODUCTS').length, 0, 'pratinjau tidak membuat record');
  const combos = [['Red', '50 ml'], ['Red', '100 ml'], ['Blue', '50 ml'], ['Blue', '100 ml']];
  const d = save(T, { brandId: B.Hanasui.id, categoryId: C['Pelembab Wajah'].id, name: 'Pelembab Wajah', baseUnit: 'PCS', variants: combos.map(([w, v], i) => ({ attributes: [{ name: 'Warna', value: w }, { name: 'Volume', value: v }], barcode: { mode: 'gtin', code: g(i + 1) } })) });
  P.han = d;
  assert.equal(d.productCode, 'PRD000001');
  assert.deepEqual(d.variants.map((v) => v.sku), ['PRD000001-001', 'PRD000001-002', 'PRD000001-003', 'PRD000001-004']);
  assert.deepEqual(d.variants.map((v) => v.skuName), ['Hanasui Pelembab Wajah Red 50 ml', 'Hanasui Pelembab Wajah Red 100 ml', 'Hanasui Pelembab Wajah Blue 50 ml', 'Hanasui Pelembab Wajah Blue 100 ml']);
  d.variants.forEach((v, i) => {
    assert.equal(v.gtin, g(i + 1));
    assert.ok(v.sku.indexOf(v.gtin) < 0, 'GTIN tidak menjadi bagian Child SKU');
  });
  // brand & kategori berbeda → nomor parent tetap melanjutkan urutan global
  P.viva = save(T, { brandId: B.Viva.id, categoryId: C['Air Mawar'].id, name: 'Air Mawar', baseUnit: 'BOTOL', variants: ['100 ml', '200 ml'].map((x, i) => ({ attributes: [{ name: 'Volume', value: x }], barcode: { mode: 'gtin', code: g(20 + i) } })) });
  P.pur = save(T, simple('Purbasari', 'Body Serum', 'Body Serum', { mode: 'internal' }));
  P.war = save(T, simple('Wardah', 'Sunscreen', 'Sunscreen'));
  P.han2 = save(T, simple('Hanasui', 'Pelembab Wajah', 'Day Cream', null, { acknowledgeSimilar: true }));
  assert.deepEqual([P.viva, P.pur, P.war, P.han2].map((p) => p.productCode), ['PRD000002', 'PRD000003', 'PRD000004', 'PRD000005']);
  assert.deepEqual(P.viva.variants.map((v) => v.sku), ['PRD000002-001', 'PRD000002-002'], 'urutan child mulai 001 per parent');
  assert.ok(P.han2.productCode !== P.han.productCode, 'kategori/brand sama tidak mengulang nomor');
});

test('[T4][T10] Parent tanpa varian mendapat satu Child SKU default; produk tanpa GTIN tetap mendapat Child SKU', () => {
  assert.equal(P.war.variants.length, 1);
  assert.equal(P.war.variants[0].isDefault, true);
  assert.equal(P.war.variants[0].sku, 'PRD000004-001');
  assert.deepEqual([P.war.variants[0].gtin, P.war.variants[0].internalBarcode, P.war.variants[0].barcodeType], ['', '', 'none'], 'tanpa barcode sama sekali');
  assert.equal(P.pur.variants[0].sku, 'PRD000003-001');
  assert.match(P.pur.variants[0].internalBarcode, /^200\d{10}$/, 'barcode internal (opsional) tetap terpisah dari SKU');
  assert.equal(rows('VARIANT_BARCODES').find((r) => r[1] === P.pur.variants[0].internalBarcode)[2], 'INTERNAL', 'tipe INTERNAL ≠ GTIN');
  assert.equal(rows('VARIANT_BARCODES').find((r) => r[1] === g(1))[2], 'GTIN');
});

test('[T6] varian kelima mendapat 005; nomor child tidak dipakai ulang walau varian lama discontinued', () => {
  const x = toInput(P.han);
  x.variants.push({ attributes: [{ name: 'Warna', value: 'Green' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'none' } });
  const d = save(T, x);
  assert.equal(d.variants[4].sku, 'PRD000001-005');
  ok(call(T, 'variant.setStatus', { id: d.variants[4].id, status: 'DISCONTINUED', reason: 'Tidak diproduksi lagi' }));
  const y = toInput(ok(call(V, 'product.get', { id: d.id })));
  y.variants.push({ attributes: [{ name: 'Warna', value: 'Pink' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'none' } });
  const d2 = save(T, y);
  assert.equal(d2.variants[5].sku, 'PRD000001-006', 'tidak memakai ulang 005');
  assert.equal(rows('MASTER_PRODUCTS').length, 5, 'tambah varian tidak membuat Parent baru');
  P.han = d2;
});

test('[T8][T9] scan GTIN → Child SKU yang benar; koreksi GTIN tidak mengubah Child SKU & histori tersimpan', () => {
  const hit = ok(call(V, 'barcode.lookup', { code: g(2) }));
  assert.equal(hit.matches.length, 1);
  assert.deepEqual([hit.matches[0].childSku, hit.matches[0].parentSku, hit.matches[0].skuName, hit.matches[0].via], ['PRD000001-002', 'PRD000001', 'Hanasui Pelembab Wajah Red 100 ml', 'GTIN produsen']);
  const x = toInput(P.han);
  x.variants[1].barcode = { mode: 'gtin', code: g(40) };
  x.variants[1].barcodeChangeReason = 'Salah input GTIN';
  const d = save(T, x);
  assert.equal(d.variants[1].sku, 'PRD000001-002', 'Child SKU tetap');
  assert.equal(d.variants[1].gtin, g(40));
  assert.equal(ok(call(V, 'barcode.history', { code: g(2) })).history[0].status, 'RETIRED');
  assert.equal(ok(call(V, 'barcode.lookup', { code: g(40) })).matches[0].childSku, 'PRD000001-002');
  assert.equal(ok(call(V, 'barcode.lookup', { code: g(2) })).found, false);
  // GTIN dihapus dari Child SKU → SKU tetap, Child SKU masih bisa dicari lewat SKU-nya
  const y = toInput(d);
  y.variants[1].barcode = { mode: 'none' };
  y.variants[1].barcodeChangeReason = 'Barang ternyata tanpa GTIN';
  const d2 = save(T, y);
  assert.deepEqual([d2.variants[1].sku, d2.variants[1].gtin], ['PRD000001-002', '']);
  assert.equal(ok(call(V, 'barcode.lookup', { code: 'prd000001-002' })).matches[0].via, 'Child SKU');
  P.han = d2;
});

test('[T11][T12][T13][T14] Paket Produk Sama 2 & 6 PCS → MP berbeda; Paket Kombinasi A+B → BD; komposisi (BOM) tersimpan', () => {
  const red50 = P.han.variants[0];
  const blue50 = P.han.variants[2];
  const mp2 = ok(call(T, 'bundle.save', { type: 'MULTIPACK', name: 'Paket 2 PCS Hanasui Pelembab Wajah Red 50 ml', components: [{ variantId: red50.id, quantity: 2 }] }));
  const mp6 = ok(call(T, 'bundle.save', { type: 'MULTIPACK', name: 'Paket 6 PCS Hanasui Pelembab Wajah Red 50 ml', components: [{ variantId: red50.id, quantity: 6 }] }));
  assert.deepEqual([mp2.sku, mp6.sku], ['MP000001', 'MP000002']);
  const bd = ok(call(T, 'bundle.save', { type: 'MIXED', name: 'Bundle Hanasui Red + Blue', components: [{ variantId: red50.id, quantity: 1 }, { variantId: blue50.id, quantity: 1 }] }));
  assert.equal(bd.sku, 'BD000001');
  assert.ok(!/PRD/.test(mp2.sku + mp6.sku + bd.sku), 'kode komponen tidak masuk string SKU paket');
  assert.deepEqual(ok(call(V, 'bundle.get', { id: mp6.id })).components.map((c) => [c.sku, c.quantity]), [['PRD000001-001', 6]]);
  assert.deepEqual(ok(call(V, 'bundle.get', { id: bd.id })).components.map((c) => [c.sku, c.quantity]), [['PRD000001-001', 1], ['PRD000001-003', 1]]);
  const comp = rows('BUNDLE_COMPONENTS').filter((r) => r[1] === mp6.id && r[5] === 'ACTIVE');
  assert.deepEqual(comp.map((r) => [r[2], r[3]]), [[red50.id, '6']], 'BOM memakai ID internal Child SKU');
  // komposisi paket aktif tidak boleh diubah diam-diam → wajib paket baru
  const e = fail(call(T, 'bundle.save', { id: mp6.id, name: mp6.name, components: [{ variantId: red50.id, quantity: 12 }] }), 'VALIDATION_FAILED');
  assert.equal(e.details[0].code, 'LOCKED');
  ok(call(T, 'bundle.save', { id: mp6.id, name: 'Paket isi 6 Hanasui Red 50 ml', components: [{ variantId: red50.id, quantity: 6 }] }), 'ganti nama tetap boleh');
  // paket virtual tidak muncul sebagai item stok (tanpa double counting)
  const inv = ok(call(T, 'export.data', { kind: 'inventory' }));
  assert.ok(!inv.rows.some((r) => /^(MP|BD)\d{6}$/.test(r[0])));
  P.bd = bd;
});

test('[T15] Parent SKU tidak dapat dipakai sebagai stok fisik', () => {
  assert.equal(P.han.stockable, false);
  const inv = ok(call(T, 'export.data', { kind: 'inventory' }));
  assert.ok(!inv.rows.some((r) => r[0] === 'PRD000001'), 'Parent tidak ada di inventory master');
  assert.ok(inv.rows.some((r) => r[0] === 'PRD000001-001'));
  fail(call(T, 'bundle.save', { type: 'MULTIPACK', name: 'Paket parent', components: [{ variantId: P.han.id, quantity: 2 }] }), 'VALIDATION_FAILED');
  fail(call(T, 'mapping.create', { system: 'shopee', sku: 'PRD000001', externalProductId: '1', externalVariationId: '2' }));
});

test('[T18][T19] ganti nama brand, kategori, nama produk, dimensi & berat tidak mengubah Parent/Child SKU', () => {
  const before = { p: P.han.productCode, c: P.han.variants.map((v) => v.sku) };
  ok(call(T, 'brand.rename', { id: B.Hanasui.id, name: 'Hanasui Official' }));
  ok(call(T, 'category.rename', { id: C['Pelembab Wajah'].id, name: 'Pelembab' }));
  const x = toInput(ok(call(V, 'product.get', { id: P.han.id })));
  x.name = 'Pelembab Wajah Moisturizer';
  x.categoryId = C.Toner.id;
  x.variants[0].dimensions = [{ unit: 'PCS', lengthCm: 4, widthCm: 4, heightCm: 12, weight: 85 }];
  x.variants[0].conversions = [{ unitName: 'BOX', factor: 24 }];
  const d = save(T, x);
  assert.equal(d.productCode, before.p);
  assert.deepEqual(d.variants.map((v) => v.sku), before.c);
  assert.equal(d.variants[0].skuName, 'Hanasui Official Pelembab Wajah Moisturizer Red 50 ml', 'hanya nama tampilan yang ikut berubah');
  const y = toInput(d);
  y.variants[0].dimensions = [{ unit: 'PCS', lengthCm: 5, widthCm: 5, heightCm: 13, weight: 1.1, weightUnit: 'kg' }, { unit: 'BOX', lengthCm: 30, widthCm: 20, heightCm: 14, weight: 2.4, weightUnit: 'kg' }];
  const d2 = save(T, y);
  assert.deepEqual(d2.variants.map((v) => v.sku), before.c);
  assert.deepEqual(d2.variants[0].dimensions.map((z) => [z.unit, z.grossWeightGrams]).sort(), [['BOX', 2400], ['PCS', 1100]]);
  ok(call(T, 'brand.rename', { id: B.Hanasui.id, name: 'Hanasui' }));
  P.han = ok(call(V, 'product.get', { id: P.han.id }));
});

test('[T20] SKU lama tetap dapat dicari setelah migrasi (format lama dipertahankan & SKU lama tercatat)', () => {
  // data versi lama (v5) di sheet: Parent SKU berbasis brand/kategori — tidak diubah
  const L = createGas();
  const put = (name, rows2) => {
    const sh = L.ss.insertSheet(name);
    sh.data = rows2.map((r) => r.map((x) => (x === undefined ? '' : String(x))));
  };
  put('Brands', [['id', 'code', 'name', 'status'], ['b1', 'VIV', 'Viva', 'active']]);
  put('Categories', [['id', 'code', 'name', 'status'], ['c1', 'TON', 'Toner', 'active']]);
  put('Products', [['id', 'product_no', 'brand_id', 'category_id', 'product_code', 'name', 'base_unit', 'has_variants', 'status'], ['p1', '7', 'b1', 'c1', 'VAM100', 'Viva Air Mawar 100ml', 'PCS', 'FALSE', 'active']]);
  put('Variants', [['id', 'product_id', 'variant_code', 'name', 'attributes_json', 'status', 'sort_order'], ['v1', 'p1', '', '', '[]', 'active', '0']]);
  put('SKUs', [['id', 'sku_code', 'product_id', 'variant_id', 'sku_type', 'pack_qty', 'sales_unit', 'status'], ['s1', 'VIV-TON-VAM100-8992796011501-1', 'p1', 'v1', 'single', '1', 'PCS', 'active']]);
  put('Barcodes', [['code', 'barcode_type'], ['8992796011501', 'gtin']]);
  put('BarcodeAssignments', [['id', 'code', 'product_id', 'variant_id', 'sku_id', 'assigned_by', 'assigned_at', 'unassigned_by', 'unassigned_at'], ['a1', '8992796011501', 'p1', 'v1', '', 'x', '2026-01-01', '', '']]);
  const out = JSON.parse(JSON.stringify(L.ctx.setup()));
  const tok = JSON.parse(JSON.stringify(L.ctx.api(null, 'auth.login', { email: out.admin.email, password: out.admin.password }))).data.token;
  const api = (a, p) => JSON.parse(JSON.stringify(L.ctx.api(tok, a, p))).data;
  const d = api('product.get', { id: 'p1' });
  assert.deepEqual([d.productCode, d.variants[0].sku, d.legacyCode], ['PRD000007', 'PRD000007-001', 'VAM100']);
  assert.equal(api('barcode.lookup', { code: 'VIV-TON-VAM100-8992796011501-1' }).matches[0].childSku, 'PRD000007-001', 'SKU lama → Child SKU baru');
  assert.equal(api('barcode.lookup', { code: '8992796011501' }).matches[0].childSku, 'PRD000007-001');
  assert.equal(api('product.list', { search: 'VAM100' }).total, 1, 'kode produk lama tetap bisa dicari');
  // kode brand lama tetap tersimpan sebagai metadata, tidak dipakai SKU
  assert.equal(L.sheets.get('MASTER_BRANDS').data[1][1], 'VIV');
  // data v5 (SKU berbasis brand) di DB → tetap tampil & dapat dicari apa adanya
  const sh = G.sheets.get('MASTER_PRODUCTS');
  const legacyRow = sh.data.find((r) => r[0] === P.war.id);
  const head = sh.data[0];
  legacyRow[head.indexOf('ProductCode')] = 'WAR-SUN-0001';
  const vsh = G.sheets.get('PRODUCT_VARIANTS');
  vsh.data.find((r) => r[0] === P.war.variants[0].id)[vsh.data[0].indexOf('SKU')] = 'WAR-SUN-0001-2000000000999';
  G.ctx.resetDbCache_();
  [...G.cache.keys()].filter((k) => k.indexOf('sess_') !== 0).forEach((k) => G.cache.delete(k));
  assert.equal(ok(call(V, 'barcode.lookup', { code: 'WAR-SUN-0001-2000000000999' })).matches[0].productId, P.war.id);
  assert.equal(ok(call(V, 'product.list', { search: 'WAR-SUN-0001' })).total, 1);
  // varian baru pada parent format lama tetap memakai urutan Parent + 3 digit
  const x = toInput(ok(call(V, 'product.get', { id: P.war.id })));
  x.variants[0].attributes = [{ name: 'SPF', value: '30' }];
  x.variants.push({ attributes: [{ name: 'SPF', value: '50' }], barcode: { mode: 'none' } });
  assert.equal(save(T, x).variants[1].sku, 'WAR-SUN-0001-002', 'melanjutkan urutan child parent tersebut (001 sudah terpakai)');
});

test('[T21] request yang sama dikirim ulang tidak membuat SKU ganda (idempotency key)', () => {
  const input = simple('Viva', 'Toner', 'Face Tonic Bengkoang', { mode: 'gtin', code: g(70) });
  const a = ok(call(T, 'product.save', { input, requestKey: 'req-123' }));
  const b = call(T, 'product.save', { input, requestKey: 'req-123' });
  assert.equal(b.ok, true);
  assert.equal(b.replayed, true);
  assert.equal(b.data.productCode, a.productCode);
  assert.equal(ok(call(V, 'product.list', { search: 'face tonic' })).total, 1);
});

test('[T22] kegagalan sebagian saat menulis → rollback, nomor boleh terlewat tetapi tidak pernah ganda', () => {
  const snap = () => ['MASTER_PRODUCTS', 'PRODUCT_VARIANTS', 'VARIANT_BARCODES'].map((t) => JSON.stringify(rows(t)));
  const before = snap();
  G.failWrites('PRODUCT_VARIANTS', 0);
  fail(call(T, 'product.save', { input: simple('Purbasari', 'Body Serum', 'Hand Body Lotion', { mode: 'gtin', code: g(80) }) }), 'WRITE_FAILED');
  G.failWrites('PRODUCT_VARIANTS', null);
  assert.deepEqual(snap(), before, 'tidak ada data setengah tersimpan');
  const d = save(T, simple('Purbasari', 'Body Serum', 'Hand Body Lotion', { mode: 'gtin', code: g(80) }));
  assert.match(d.productCode, /^PRD\d{6}$/);
  const codes = rows('MASTER_PRODUCTS').map((r) => r[6]);
  assert.equal(new Set(codes).size, codes.length);
});

test('[T3] dua pengguna bersamaan: lock sibuk, versi basi ditolak, nomor Parent & Child unik', () => {
  G.state.lockBusy = true;
  fail(call(T2, 'product.save', { input: simple('Wardah', 'Toner', 'Toner A') }), 'BUSY');
  G.state.lockBusy = false;
  const a = save(T, simple('Wardah', 'Toner', 'Toner Bersamaan A'));
  const b = save(T2, simple('Wardah', 'Toner', 'Toner Bersamaan B', null, { acknowledgeSimilar: true }));
  assert.notEqual(a.productCode, b.productCode);
  assert.equal(Number(b.productCode.slice(3)), Number(a.productCode.slice(3)) + 1);
  const cur = ok(call(T, 'product.get', { id: a.id }));
  save(T, Object.assign(toInput(cur), { name: 'Toner Bersamaan A1', acknowledgeSimilar: true }));
  fail(call(T2, 'product.save', { input: Object.assign(toInput(cur), { name: 'Toner Bersamaan A2', acknowledgeSimilar: true }) }), 'STALE_VERSION');
  const skus = rows('PRODUCT_VARIANTS').map((r) => r[6]).filter(Boolean);
  assert.equal(new Set(skus).size, skus.length);
});

test('direktori parent-child: cari Parent SKU, Child SKU, GTIN, barcode internal, nama; filter brand & kategori tanpa kode', () => {
  const by = (q) => ok(call(V, 'product.list', { search: q, status: 'all' })).rows.map((r) => r.productCode);
  assert.deepEqual(by('PRD000001'), ['PRD000001']);
  assert.deepEqual(by('PRD000002-002'), ['PRD000002']);
  assert.deepEqual(by(g(21)), ['PRD000002']);
  assert.deepEqual(by(P.pur.variants[0].internalBarcode), ['PRD000003']);
  assert.deepEqual(by('moisturizer'), ['PRD000001']);
  assert.ok(ok(call(V, 'product.list', { brandId: B.Viva.id, status: 'all' })).rows.every((r) => r.brandName === 'Viva'));
  const row = ok(call(V, 'product.list', { search: 'PRD000001' })).rows[0];
  assert.equal(row.brandCode, undefined);
  assert.ok(row.variantCount >= 6);
});

test('kapasitas Child SKU: lewat 999 ditolak dengan pesan jelas (tanpa wraparound)', () => {
  const d = save(T, simple('Viva', 'Toner', 'Uji Kapasitas'));
  const seq = G.sheets.get('SYSTEM_COUNTERS');
  seq.data.find((r) => r[0] === 'child_no' && r[3] === d.id)[1] = '1000';
  G.ctx.resetDbCache_();
  const x = toInput(d);
  x.variants[0].attributes = [{ name: 'Isi', value: '1' }];
  x.variants.push({ attributes: [{ name: 'Isi', value: '2' }], barcode: { mode: 'none' } });
  const e = fail(call(T, 'product.save', { input: x }), 'VALIDATION_FAILED');
  assert.ok(e.message.includes('999'));
});

test('dimensi & berat per satuan disimpan terpisah; tahap kemasan boleh dilewati', () => {
  assert.equal(P.viva.variants[0].packagingComplete, false);
  const v0 = P.han.variants[0];
  assert.equal(v0.packagingComplete, true);
  assert.deepEqual(v0.conversions.map((c) => [c.unitName, c.baseUnitEquivalent]), [['PCS', 1], ['BOX', 24]]);
});

test('foto per Child SKU (link) & unggah ke Drive', () => {
  const url = 'https://cf.shopee.co.id/file/id-11134207-822wt-mlr01rub8bnlaa';
  const x = toInput(ok(call(V, 'product.get', { id: P.viva.id })));
  x.variants[0].imageUrl = 'http://bukan-https.local/a.jpg';
  fail(call(T, 'product.save', { input: x }), 'VALIDATION_FAILED');
  x.variants[0].imageUrl = url;
  const d = save(T, x);
  assert.deepEqual([d.variants[0].imageUrl, d.variants[0].sku], [url, 'PRD000002-001']);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = ok(call(T, 'photo.upload', { dataUrl: png, fileName: 'foto.png' }));
  assert.match(up.url, /^https:\/\/lh3\.googleusercontent\.com\/d\//);
  fail(call(V, 'photo.upload', { dataUrl: png }), 'FORBIDDEN');
});

test('pembaruan struktur otomatis tanpa setup manual', () => {
  G.ss.deleteSheet(G.sheets.get('PRODUCT_DIMENSIONS'));
  G.ctx.PropertiesService.getScriptProperties().setProperty('schema_fp', 'versi-lama');
  G.cache.delete('schema_fp');
  G.ctx.resetDbCache_();
  assert.ok(ok(call(V, 'product.list', { status: 'all' })).total > 0);
  assert.ok(G.sheets.get('PRODUCT_DIMENSIONS'), 'tab dibuat ulang otomatis');
  assert.equal(G.ctx.autoSchema_(), false);
});

test('GTIN boleh dikosongkan dulu → tersimpan & ditandai "GTIN belum didata" (direktori & Data Quality)', () => {
  const d = save(T, { brandId: B.Viva.id, categoryId: C.Toner.id, name: 'Air Mawar Mini', baseUnit: 'BOTOL', acknowledgeSimilar: true, variants: [{ attributes: [{ name: 'Volume', value: '10 ml' }], barcode: { mode: 'gtin', code: '' } }] });
  assert.equal(d.variants[0].skuName, 'Viva Air Mawar Mini 10 ml', 'produk tanpa variasi dengan ukuran');
  assert.deepEqual([d.variants[0].gtin, d.variants[0].internalBarcode], ['', '']);
  const rows2 = ok(call(V, 'product.list', { completeness: 'incomplete', status: 'all', pageSize: 200 })).rows;
  assert.ok(rows2.some((r) => r.id === d.id), 'filter GTIN belum didata');
  assert.ok(ok(call(V, 'quality.get', {})).sections.find((s) => s.key === 'variant_no_barcode').rows.some((r) => r.sku === d.variants[0].sku));
  // dilengkapi kemudian setelah cek fisik → penanda hilang, SKU tetap
  const x = toInput(d);
  x.variants[0].barcode = { mode: 'gtin', code: g(90) };
  const d2 = save(T, x);
  assert.deepEqual([d2.variants[0].gtin, d2.variants[0].sku], [g(90), d.variants[0].sku]);
  assert.ok(!ok(call(V, 'product.list', { completeness: 'incomplete', status: 'all', pageSize: 200 })).rows.some((r) => r.id === d.id));
});

test('nama diketik huruf kecil semua → huruf awal kapital (satuan tetap kecil; kapital buatan user dipertahankan)', () => {
  const d = save(T, { brandId: B.Wardah.id, categoryId: C.Toner.id, name: 'hydra rose toner', baseUnit: 'BOTOL', acknowledgeSimilar: true, variants: ['rose gold', 'pink'].map((w) => ({ attributes: [{ name: 'Warna', value: w }, { name: 'Volume', value: '100ml' }], barcode: { mode: 'none' } })) });
  assert.equal(d.name, 'Hydra Rose Toner');
  assert.deepEqual(d.variants.map((v) => v.skuName), ['Wardah Hydra Rose Toner Rose Gold 100 ml', 'Wardah Hydra Rose Toner Pink 100 ml']);
  const e = save(T, { brandId: B.Wardah.id, categoryId: C.Toner.id, name: 'BB cream SPF 30', baseUnit: 'PCS', acknowledgeSimilar: true, variants: [{ barcode: { mode: 'none' } }] });
  assert.equal(e.variants[0].skuName, 'Wardah BB cream SPF 30');
});
