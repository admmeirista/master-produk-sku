/**
 * Pengujian revisi v5 — registrasi sederhana 3 tahap, Parent SKU BRAND-KATEGORI-0001, Child SKU PARENT_SKU-BARCODE,
 * nama Produk SKU otomatis, kemasan & logistik opsional, import Excel brand/kategori, lookup barcode → Child SKU.
 * File .gs asli dijalankan di emulator (harness.cjs). Nomor [Tn] = daftar uji minimal pada brief v5.
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

/** Baca .xlsx seperti di browser (SheetJS): cari baris header berisi kolom nama, kirim [{row, name, code}]. */
function readMasterXlsx(buf, nameHeaders, codeHeaders) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim();
  const h = data.findIndex((r) => r.some((c) => nameHeaders.indexOf(norm(c)) >= 0));
  const ni = data[h].findIndex((c) => nameHeaders.indexOf(norm(c)) >= 0);
  const ci = data[h].findIndex((c) => codeHeaders.indexOf(norm(c)) >= 0);
  return data.slice(h + 1).map((r, i) => ({ row: h + i + 2, name: String(r[ni] || ''), code: ci >= 0 ? String(r[ci] || '') : '' })).filter((x) => x.name.trim() || x.code.trim());
}
function xlsxOf(aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

let T, T2, V;
const ids = {};

test('persiapan: setup, user, brand & kategori dasar', () => {
  const out = JSON.parse(JSON.stringify(G.ctx.setup()));
  assert.ok(G.sheets.get('PRODUCT_DIMENSIONS'), 'tab PRODUCT_DIMENSIONS dibuat');
  const admin = ok(call(null, 'auth.login', { email: out.admin.email, password: out.admin.password })).token;
  for (const [e, role] of [['entry@toko.local', 'data_entry'], ['entry2@toko.local', 'data_entry'], ['viewer@toko.local', 'viewer']]) ok(call(admin, 'user.create', { email: e, fullName: e, role, password: 'Password#2026' }));
  const login = (e) => ok(call(null, 'auth.login', { email: e, password: 'Password#2026' })).token;
  T = login('entry@toko.local');
  T2 = login('entry2@toko.local');
  V = login('viewer@toko.local');
  for (const n of ['Hanasui', 'Purbasari', 'Viva']) ids[n] = ok(call(T, 'brand.create', { name: n }));
  for (const n of ['Pelembab Wajah', 'Body Serum', 'Toner']) ids[n] = ok(call(T, 'category.create', { name: n }));
  assert.equal(ids.Hanasui.code, 'HAN');
});

test('[T16][T17][T18] import Master Brand & Kategori dari XLSX: pratinjau, kode otomatis, import ulang tanpa duplikat', () => {
  const file = xlsxOf([['Daftar brand toko'], ['Nama Brand', 'Kode Brand'], ['Wardah', ''], ['Hanasui', 'HNS'], ['  wardah ', ''], ['Make Over', 'MKO'], [''], ['X', '']]);
  const list = readMasterXlsx(file, ['nama brand', 'brand', 'merek'], ['kode brand']);
  const before = rows('MASTER_BRANDS').length;
  const pv = ok(call(T, 'brand.importPreview', { fileName: 'brand.xlsx', rows: list }));
  assert.equal(rows('MASTER_BRANDS').length, before, 'pratinjau tidak menulis');
  assert.deepEqual(pv.counts, { success: 2, skipped: 2, failed: 1 });
  assert.deepEqual(pv.rows.map((r) => [r.row, r.status]), [[3, 'new'], [4, 'skipped'], [5, 'skipped'], [6, 'new'], [8, 'failed']]);
  assert.ok(pv.rows[1].message.includes('HNS') && pv.rows[1].code === 'HAN', 'kode di file tidak menimpa kode existing');
  assert.ok(pv.rows[2].message.includes('baris 3'), 'duplikat dalam file terdeteksi');
  const res = ok(call(T, 'brand.import', { fileName: 'brand.xlsx', rows: list }));
  assert.deepEqual(res.counts, { success: 2, skipped: 2, failed: 1 });
  const brands = ok(call(V, 'brand.list', {}));
  assert.equal(brands.find((b) => b.name === 'Make Over').code, 'MAK', 'kode dibuat otomatis, bukan dari file');
  assert.equal(brands.find((b) => b.name === 'Hanasui').code, 'HAN');
  assert.equal(rows('IMPORT_ERRORS').filter((r) => r[1] === res.batchId).length, 3, 'laporan per baris (dilewati & gagal)');
  // import ulang file yang sama → semua dilewati, tidak ada data ganda
  const again = ok(call(T, 'brand.import', { fileName: 'brand.xlsx', rows: list }));
  assert.deepEqual(again.counts, { success: 0, skipped: 4, failed: 1 });
  assert.equal(rows('MASTER_BRANDS').length, before + 2);
  // kategori
  const cfile = xlsxOf([['Nama Kategori'], ['Parfum'], ['Lipstick'], ['Body Serum'], ['Pelembab  wajah']]);
  const clist = readMasterXlsx(cfile, ['nama kategori', 'kategori'], ['kode kategori']);
  const cres = ok(call(T, 'category.import', { fileName: 'kategori.xlsx', rows: clist }));
  assert.deepEqual(cres.counts, { success: 2, skipped: 2, failed: 0 });
  assert.deepEqual(ok(call(T, 'category.import', { fileName: 'kategori.xlsx', rows: clist })).counts, { success: 0, skipped: 4, failed: 0 });
  // viewer tidak boleh import
  fail(call(V, 'brand.import', { rows: list }), 'FORBIDDEN');
});

const HAN = () => ids.Hanasui.id;
const PLB = () => ids['Pelembab Wajah'].id;

test('[T1][T2] Parent baru: Kode Produk Parent diusulkan dari nama (huruf), boleh diubah; pratinjau tidak menulis data', () => {
  const catCode = ids['Pelembab Wajah'].code;
  const pv = ok(call(T, 'product.parentPreview', { brandId: HAN(), categoryId: PLB(), name: 'Pelembab Wajah' }));
  assert.equal(pv.parentCode, 'PW');
  assert.equal(pv.parentSku, `HAN-${catCode}-PW`);
  assert.equal(pv.displayName, 'Hanasui Pelembab Wajah');
  assert.equal(rows('MASTER_PRODUCTS').length, 0, 'membatalkan registrasi tidak meninggalkan record Parent');
  // usulan mengikuti contoh toko; kode boleh diketik sendiri
  assert.equal(ok(call(T, 'product.parentPreview', { brandId: HAN(), categoryId: PLB(), name: 'Styling Cream Natural & Moisture' })).parentCode, 'SCN');
  assert.equal(ok(call(T, 'product.parentPreview', { brandId: HAN(), categoryId: PLB(), name: 'Air Mawar 10 ml' })).parentCode, 'AM10');
  const typed = ok(call(T, 'product.parentPreview', { brandId: HAN(), categoryId: PLB(), name: 'x', parentCode: 'gsg-30' }));
  assert.deepEqual([typed.parentCode, typed.parentSku, typed.error], ['GSG30', `HAN-${catCode}-GSG30`, '']);
  assert.ok(ok(call(T, 'product.parentPreview', { brandId: HAN(), categoryId: PLB(), parentCode: '1234' })).error.includes('huruf'), 'tidak boleh hanya angka');
  fail(call(T, 'product.save', { input: { brandId: HAN(), categoryId: PLB(), name: 'Uji', parentCode: '0001', baseUnit: 'PCS', variants: [{ barcode: { mode: 'internal' } }] } }), 'VALIDATION_FAILED');
  assert.equal(rows('MASTER_PRODUCTS').length, 0);
});

const g = (n) => gtin('8991234' + String(n).padStart(5, '0'));

test('[T4][T5][T10] kombinasi Warna × Volume: 4 Child SKU, SKU = Parent SKU + GTIN, nama otomatis tanpa pengulangan', () => {
  const combos = [['Red', '50ml'], ['Red', '100 ML'], ['Blue', '50 ml ml'], ['Blue', '100ml']];
  const d = ok(call(T, 'product.save', { input: { brandId: HAN(), categoryId: PLB(), name: 'Pelembab Wajah', baseUnit: 'PCS', variants: combos.map(([w, v], i) => ({ attributes: [{ name: 'Volume', value: v }, { name: 'Warna', value: w }], barcode: { mode: 'gtin', code: g(i + 1) } })) } }));
  ids.han = d;
  const catCode = ids['Pelembab Wajah'].code;
  assert.equal(d.productCode, `HAN-${catCode}-PW`);
  assert.equal(d.parentCode, 'PW');
  assert.equal(d.stockable, false, 'Parent non-stockable');
  assert.deepEqual(
    d.variants.map((v) => v.skuName),
    ['Hanasui Pelembab Wajah Red 50 ml', 'Hanasui Pelembab Wajah Red 100 ml', 'Hanasui Pelembab Wajah Blue 50 ml', 'Hanasui Pelembab Wajah Blue 100 ml'],
  );
  d.variants.forEach((v, i) => {
    assert.equal(v.sku, `${d.productCode}-${g(i + 1)}`);
    assert.equal(v.gtin, g(i + 1));
    assert.equal(v.barcodeType, 'gtin');
    assert.equal(v.stockable, true);
    assert.deepEqual(v.attributes.map((a) => a.name), ['Warna', 'Volume'], 'atribut urut sesuai pengaturan');
  });
  assert.equal(new Set(d.variants.map((v) => v.sku)).size, 4);
  // barcode → Child SKU disimpan eksplisit dengan jenisnya
  const bc = rows('VARIANT_BARCODES').find((r) => r[1] === g(1));
  assert.deepEqual([bc[2], bc[4]], ['GTIN', 'ACTIVE']);
  // relasi memakai ID internal, bukan string SKU
  assert.equal(bc[6], d.variants[0].id);
  // nama sama → usulan kode berikutnya yang masih tersedia; kode yang sudah dipakai ditolak
  const pv = ok(call(T, 'product.parentPreview', { brandId: HAN(), categoryId: PLB(), name: 'Pelembab Wajah' }));
  assert.equal(pv.parentCode, 'PWB');
  assert.equal(ok(call(T, 'product.parentPreview', { brandId: HAN(), categoryId: PLB(), parentCode: 'PW' })).taken.name, 'Pelembab Wajah');
  const dupe = fail(call(T, 'product.save', { input: { brandId: HAN(), categoryId: PLB(), name: 'Toner Wajah', parentCode: 'pw', baseUnit: 'PCS', acknowledgeSimilar: true, variants: [{ barcode: { mode: 'internal' } }] } }), 'VALIDATION_FAILED');
  assert.equal(dupe.details[0].path, 'parentCode');
});

test('[T3][T6] produk tanpa varian & tanpa GTIN: satu Child SKU default dengan barcode internal otomatis', () => {
  const d = ok(call(T, 'product.save', { input: { brandId: ids.Purbasari.id, categoryId: ids['Body Serum'].id, name: 'Gluta Hya Body Serum 180ml', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'internal' } }] } }));
  ids.pur = d;
  assert.equal(d.variants.length, 1);
  assert.equal(d.variants[0].isDefault, true);
  assert.equal(d.variants[0].skuName, 'Purbasari Gluta Hya Body Serum 180 ml');
  assert.match(d.variants[0].internalBarcode, /^200\d{10}$/);
  assert.equal(d.variants[0].gtin, '');
  assert.equal(d.variants[0].barcodeType, 'internal');
  assert.equal(d.variants[0].sku, `${d.productCode}-${d.variants[0].internalBarcode}`);
  assert.equal(rows('VARIANT_BARCODES').find((r) => r[1] === d.variants[0].internalBarcode)[2], 'INTERNAL');
  // Child SKU baru tanpa pilihan barcode ditolak (wajib GTIN atau internal)
  fail(call(T, 'product.save', { input: { brandId: ids.Viva.id, categoryId: ids.Toner.id, name: 'Air Mawar', baseUnit: 'BOTOL', variants: [{}] } }), 'VALIDATION_FAILED');
  // lebih dari satu baris tanpa atribut pembeda ditolak
  fail(call(T, 'product.save', { input: { brandId: ids.Viva.id, categoryId: ids.Toner.id, name: 'Air Mawar', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'internal' } }, { attributes: [{ name: 'Volume', value: '100 ml' }], barcode: { mode: 'internal' } }] } }), 'VALIDATION_FAILED');
});

test('[T7][T8] scan GTIN menemukan Child SKU yang tepat; barcode tidak terdaftar = Unknown; konflik tidak dipilih acak', () => {
  const hit = ok(call(V, 'barcode.lookup', { code: g(2) }));
  assert.equal(hit.found, true);
  assert.equal(hit.matches.length, 1);
  const m = hit.matches[0];
  assert.deepEqual([m.parentSku, m.childSku, m.skuName, m.baseUnit, m.variantStatus], [ids.han.productCode, ids.han.variants[1].sku, 'Hanasui Pelembab Wajah Red 100 ml', 'PCS', 'ACTIVE']);
  // juga lewat Child SKU, Parent SKU (semua child), barcode internal, dan nama produk
  assert.equal(ok(call(V, 'barcode.lookup', { code: ids.han.variants[0].sku.toLowerCase() })).matches[0].via, 'Child SKU');
  assert.equal(ok(call(V, 'barcode.lookup', { code: ids.han.productCode })).matches.length, 4);
  assert.equal(ok(call(V, 'barcode.lookup', { code: ids.pur.variants[0].internalBarcode })).matches[0].via, 'Barcode internal');
  const byName = ok(call(V, 'barcode.lookup', { code: 'pelembab blue 100' }));
  assert.deepEqual(byName.matches.map((x) => x.skuName), ['Hanasui Pelembab Wajah Blue 100 ml']);
  // tidak terdaftar
  const unk = ok(call(V, 'barcode.lookup', { code: gtin('899999999999') }));
  assert.equal(unk.found, false);
  assert.equal(unk.kind, 'gtin');
  // konflik identitas (data rusak: satu barcode aktif dua barang) → error, bukan pilih salah satu
  const sh = G.sheets.get('VARIANT_BARCODES');
  const src = sh.data.find((r) => r[1] === g(3)).slice();
  src[0] = 'conflict-row';
  src[6] = ids.han.variants[0].id;
  sh.data.push(src);
  G.ctx.resetDbCache_();
  const cf = ok(call(V, 'barcode.lookup', { code: g(3) }));
  assert.equal(cf.conflict, true);
  assert.equal(cf.matches.length, 0);
  assert.equal(cf.owners.length, 2);
  sh.data.pop();
  G.ctx.resetDbCache_();
  assert.equal(ok(call(V, 'barcode.lookup', { code: g(3) })).matches.length, 1);
});

test('[T9] duplikasi barcode ditolak (antar-produk & dalam satu formulir)', () => {
  const e = fail(call(T, 'product.save', { input: { brandId: ids.Viva.id, categoryId: ids.Toner.id, name: 'Viva Toner Lain', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'gtin', code: g(1) } }] } }), 'VALIDATION_FAILED');
  assert.equal(e.details[0].code, 'BARCODE_IN_USE');
  assert.ok(e.details[0].message.includes('Pelembab Wajah'));
  const e2 = fail(call(T, 'product.save', { input: { brandId: ids.Viva.id, categoryId: ids.Toner.id, name: 'Viva Toner Dua', baseUnit: 'BOTOL', variants: ['A', 'B'].map((x) => ({ attributes: [{ name: 'Aroma', value: x }], barcode: { mode: 'gtin', code: g(50) } })) } }), 'VALIDATION_FAILED');
  assert.ok(e2.details.some((x) => x.code === 'DUPLICATE'));
  assert.equal(ok(call(V, 'product.list', { search: 'toner' })).total, 0, 'tidak tersimpan setengah');
});

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

test('[T11][T12][T13][T14] kemasan BOX 24 PCS, KARTON bertingkat; dimensi & berat PCS dan BOX disimpan terpisah', () => {
  const x = toInput(ids.han);
  x.variants[0].conversions = [{ unitName: 'BOX', factor: 24 }, { unitName: 'KARTON', factor: 6, containsUnit: 'BOX' }];
  x.variants[0].dimensions = [
    { unit: 'PCS', lengthCm: 4.5, widthCm: 4.5, heightCm: 12, weight: 85, weightUnit: 'g' },
    { unit: 'BOX', lengthCm: 30, widthCm: 20, heightCm: 13, weight: 2.3, weightUnit: 'kg' },
  ];
  x.variants[1].conversions = [{ unitName: 'BOX', factor: 12 }];
  const d = ok(call(T, 'product.save', { input: x }));
  const v0 = d.variants[0];
  assert.deepEqual(v0.conversions.map((c) => [c.unitName, c.factor, c.containsUnit, c.baseUnitEquivalent]), [['PCS', 1, 'PCS', 1], ['BOX', 24, 'PCS', 24], ['KARTON', 6, 'BOX', 144]]);
  assert.equal(ok(call(V, 'unit.convert', { variantId: v0.id, qty: 1, unit: 'KARTON' })).baseQty, 144);
  assert.equal(ok(call(V, 'unit.convert', { variantId: d.variants[1].id, qty: 1, unit: 'BOX' })).baseQty, 12, 'konversi berbeda per Child SKU');
  const dims = Object.fromEntries(v0.dimensions.map((x2) => [x2.unit, [x2.lengthCm, x2.widthCm, x2.heightCm, x2.grossWeightGrams]]));
  assert.deepEqual(dims, { PCS: [4.5, 4.5, 12, 85], BOX: [30, 20, 13, 2300] }, 'BOX tidak dihitung dari PCS; kg → gram');
  assert.equal(rows('PRODUCT_DIMENSIONS').filter((r) => r[1] === v0.id).length, 2, 'satu baris per satuan');
  assert.equal(v0.packagingComplete, true);
  assert.equal(d.variants[1].packagingComplete, false);
  // konversi tidak membuat SKU & tidak menambah stok
  assert.equal(v0.conversions[1].sku, '');
  // dimensi untuk satuan yang tidak didefinisikan / nilai tidak valid ditolak
  const y = toInput(d);
  y.variants[2].dimensions = [{ unit: 'BOX', lengthCm: 10 }, { unit: 'PCS', lengthCm: -1 }];
  const e = fail(call(T, 'product.save', { input: y }), 'VALIDATION_FAILED');
  assert.deepEqual(e.details.map((z) => z.path).sort(), ['variants.2.dimensions.0.unit', 'variants.2.dimensions.1.lengthCm']);
  ids.han = d;
});

test('[T15] tahap kemasan dilewati: produk tetap tersimpan, status "Data kemasan belum lengkap"', () => {
  assert.equal(ids.pur.variants[0].conversions.length, 1);
  assert.equal(ids.pur.variants[0].dimensions.length, 0);
  assert.equal(ids.pur.variants[0].packagingComplete, false);
  assert.equal(ids.pur.status, 'ACTIVE');
  const q = ok(call(V, 'quality.get', {})).sections.find((s) => s.key === 'packaging_incomplete');
  assert.ok(q.rows.some((r) => r.sku === ids.pur.variants[0].sku));
});

test('[T19] perubahan dimensi, berat, kemasan, dan nama tidak mengubah SKU', () => {
  const before = ids.han.variants.map((v) => v.sku);
  const x = toInput(ids.han);
  x.variants[0].dimensions[0].weight = 90;
  x.variants[0].conversions[0].factor = 20;
  x.variants[0].conversions[0].changeReason = 'Kemasan baru dari pabrik';
  x.name = 'Pelembab Wajah Moisturizer';
  const d = ok(call(T, 'product.save', { input: x }));
  assert.deepEqual(d.variants.map((v) => v.sku), before);
  assert.equal(d.productCode, ids.han.productCode);
  assert.equal(d.variants[0].dimensions.find((z) => z.unit === 'PCS').grossWeightGrams, 90);
  assert.equal(d.variants[0].skuName, 'Hanasui Pelembab Wajah Moisturizer Red 50 ml', 'nama otomatis ikut nama parent');
  // override nama tampilan: wajib alasan, SKU tetap
  const y = toInput(d);
  y.variants[0].nameOverride = 'Hanasui Moisturizer Merah 50 ml';
  assert.equal(fail(call(T, 'product.save', { input: y }), 'VALIDATION_FAILED').details[0].path, 'variants.0.nameOverride');
  y.variants[0].nameOverrideReason = 'Menyesuaikan nama di marketplace';
  const d2 = ok(call(T, 'product.save', { input: y }));
  assert.equal(d2.variants[0].skuName, 'Hanasui Moisturizer Merah 50 ml');
  assert.equal(d2.variants[0].generatedName, 'Hanasui Pelembab Wajah Moisturizer Red 50 ml');
  assert.equal(d2.variants[0].sku, before[0]);
  assert.ok(ok(call(T, 'product.audit', { id: d.id })).some((a) => a.action === 'variant.rename' && a.meta.reason === 'Menyesuaikan nama di marketplace'));
  // rename brand → nama otomatis diperbarui, SKU tetap (kode brand permanen)
  ok(call(T, 'brand.rename', { id: HAN(), name: 'Hanasui Official' }));
  const d3 = ok(call(V, 'product.get', { id: d.id }));
  assert.equal(d3.variants[1].skuName, 'Hanasui Official Pelembab Wajah Moisturizer Red 100 ml');
  assert.deepEqual(d3.variants.map((v) => v.sku), before);
  ok(call(T, 'brand.rename', { id: HAN(), name: 'Hanasui' }));
  ids.han = ok(call(V, 'product.get', { id: d.id }));
});

test('[T20] koreksi GTIN pada SKU aktif: SKU tidak ditulis ulang, histori barcode tersimpan', () => {
  const v = ids.han.variants[3];
  const x = toInput(ids.han);
  x.variants[3].barcode = { mode: 'gtin', code: g(40) };
  assert.equal(fail(call(T, 'product.save', { input: x }), 'VALIDATION_FAILED').details[0].code, 'REASON_REQUIRED');
  x.variants[3].barcodeChangeReason = 'Salah scan saat registrasi';
  const d = ok(call(T, 'product.save', { input: x }));
  assert.equal(d.variants[3].gtin, g(40));
  assert.equal(d.variants[3].sku, v.sku, 'SKU aktif dibekukan');
  const hist = ok(call(V, 'barcode.history', { code: g(4) }));
  assert.equal(hist.history[0].status, 'RETIRED');
  // GTIN lama tidak bisa dipakai barang lain; GTIN baru menemukan SKU yang sama
  assert.equal(ok(call(V, 'barcode.lookup', { code: g(40) })).matches[0].childSku, v.sku);
  assert.equal(ok(call(V, 'barcode.lookup', { code: g(4) })).found, false);
  const e = fail(call(T, 'product.save', { input: { brandId: ids.Viva.id, categoryId: ids.Toner.id, name: 'Barang Lain', baseUnit: 'PCS', variants: [{ barcode: { mode: 'gtin', code: g(4) } }] } }), 'VALIDATION_FAILED');
  assert.equal(e.details[0].code, 'BARCODE_RETIRED');
  ids.han = d;
});

test('draft: SKU dihitung ulang selama DRAFT, dibekukan setelah aktif', () => {
  const d = ok(call(T, 'product.save', { input: { brandId: ids.Viva.id, categoryId: ids.Toner.id, name: 'Air Mawar', baseUnit: 'BOTOL', saveAsDraft: true, variants: [{ barcode: { mode: 'gtin', code: g(60) } }] } }));
  assert.equal(d.status, 'DRAFT');
  assert.equal(d.skuFrozen, false);
  // draft: brand & GTIN dikoreksi → Parent SKU & Child SKU mengikuti
  const x = toInput(d);
  x.brandId = ids.Purbasari.id;
  x.variants[0].barcode = { mode: 'gtin', code: g(61) };
  x.variants[0].barcodeChangeReason = 'Koreksi sebelum aktif';
  const d2 = ok(call(T, 'product.save', { input: x }));
  assert.equal(d2.productCode, `PUR-${ids.Toner.code}-${d.parentCode}`);
  assert.equal(d2.variants[0].sku, `${d2.productCode}-${g(61)}`);
  // tidak tersedia downstream sebelum aktif
  assert.ok(!ok(call(T, 'export.data', { kind: 'master' })).rows.some((r) => r[1] === d2.variants[0].sku));
  const act = ok(call(T, 'product.setStatus', { id: d.id, status: 'ACTIVE' }));
  assert.equal(act.skuFrozen, true);
  const y = toInput(act);
  y.brandId = ids.Viva.id;
  y.variants[0].barcode = { mode: 'gtin', code: g(62) };
  y.variants[0].barcodeChangeReason = 'Koreksi setelah aktif';
  const d3 = ok(call(T, 'product.save', { input: y }));
  assert.equal(d3.productCode, d2.productCode, 'Parent SKU beku setelah aktif');
  assert.equal(d3.variants[0].sku, d2.variants[0].sku, 'Child SKU beku setelah aktif');
});

test('[T21] varian baru pada Parent existing: tidak membuat Parent baru', () => {
  const parents = rows('MASTER_PRODUCTS').length;
  const x = toInput(ids.han);
  x.variants.push({ attributes: [{ name: 'Warna', value: 'Green' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'internal' } });
  const d = ok(call(T, 'product.save', { input: x }));
  assert.equal(rows('MASTER_PRODUCTS').length, parents);
  assert.equal(d.productCode, ids.han.productCode);
  const nv = d.variants[4];
  assert.equal(nv.skuName, 'Hanasui Pelembab Wajah Moisturizer Green 50 ml');
  assert.equal(nv.sku, `${d.productCode}-${nv.internalBarcode}`);
  // kombinasi yang sudah ada ditolak
  const y = toInput(d);
  y.variants.push({ attributes: [{ name: 'Warna', value: 'red' }, { name: 'Volume', value: '50ML' }], barcode: { mode: 'internal' } });
  fail(call(T, 'product.save', { input: y }), 'VALIDATION_FAILED');
});

test('[T22] dua pengguna menyimpan bersamaan: lock, versi basi, tidak ada kode duplikat', () => {
  G.state.lockBusy = true;
  fail(call(T2, 'product.save', { input: { brandId: HAN(), categoryId: PLB(), name: 'Toner Wajah', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'internal' } }] } }), 'BUSY');
  G.state.lockBusy = false;
  const a = ok(call(T, 'product.save', { input: { brandId: HAN(), categoryId: PLB(), name: 'Serum Wajah', baseUnit: 'BOTOL', variants: [{ barcode: { mode: 'internal' } }] } }));
  const b = ok(call(T2, 'product.save', { input: { brandId: HAN(), categoryId: PLB(), name: 'Masker Wajah', baseUnit: 'JAR', variants: [{ barcode: { mode: 'internal' } }] } }));
  assert.notEqual(a.productCode, b.productCode);
  assert.notEqual(a.variants[0].internalBarcode, b.variants[0].internalBarcode);
  const cur = ok(call(T, 'product.get', { id: a.id }));
  ok(call(T, 'product.save', { input: Object.assign(toInput(cur), { name: 'Serum Wajah Brightening' }) }));
  fail(call(T2, 'product.save', { input: Object.assign(toInput(cur), { name: 'Serum Wajah Glow' }) }), 'STALE_VERSION');
  const skus = rows('PRODUCT_VARIANTS').map((r) => r[6]).filter(Boolean);
  assert.equal(new Set(skus).size, skus.length);
  const parents = rows('MASTER_PRODUCTS').map((r) => r[6]);
  assert.equal(new Set(parents).size, parents.length);
  const codes = rows('MASTER_PRODUCTS').map((r) => r[19]);
  assert.equal(new Set(codes).size, codes.length, 'kode parent tidak pernah dialokasikan ulang');
});

test('batch/expiry dihapus dari formulir: nilai lama dipertahankan saat edit (tidak ada migrasi destruktif)', () => {
  const vid = ids.pur.variants[0].id;
  const sh = G.sheets.get('PRODUCT_VARIANTS');
  const head = sh.data[0];
  const row = sh.data.find((r) => r[0] === vid);
  row[head.indexOf('BatchTracking')] = 'TRUE';
  row[head.indexOf('ShelfLifeMonths')] = '36';
  G.ctx.resetDbCache_();
  const d = ok(call(T, 'product.get', { id: ids.pur.id }));
  ok(call(T, 'product.save', { input: toInput(d) }));
  G.ctx.resetDbCache_();
  const after = sh.data.find((r) => r[0] === vid);
  assert.equal(after[head.indexOf('BatchTracking')], 'TRUE');
  assert.equal(after[head.indexOf('ShelfLifeMonths')], '36');
});

test('pembaruan struktur otomatis: setelah kode baru di-push, permintaan pertama membuat tab/kolom/penghitung tanpa setup manual', () => {
  // simulasi database versi lama: tab PRODUCT_DIMENSIONS & penghitung parent_no belum ada, sidik skema lama
  G.ss.deleteSheet(G.sheets.get('PRODUCT_DIMENSIONS'));
  const seq = G.sheets.get('SYSTEM_COUNTERS');
  const before = seq.data.find((r) => r[0] === 'parent_no').slice();
  seq.data = seq.data.filter((r) => r[0] !== 'parent_no');
  G.ctx.PropertiesService.getScriptProperties().setProperty('schema_fp', 'versi-lama');
  G.cache.delete('schema_fp');
  G.ctx.resetDbCache_();
  // permintaan biasa dari aplikasi
  const list = ok(call(V, 'product.list', { status: 'all' }));
  assert.ok(list.total > 0, 'data lama tetap ada');
  assert.ok(G.sheets.get('PRODUCT_DIMENSIONS'), 'tab baru dibuat otomatis');
  assert.deepEqual(G.sheets.get('PRODUCT_DIMENSIONS').data[0].slice(0, 4), ['DimensionID', 'VariantID', 'ProductID', 'PackagingUnit']);
  assert.equal(Number(seq.data.find((r) => r[0] === 'parent_no')[1]), Number(before[1]), 'penghitung dibuat ulang mulai setelah nomor urut tertinggi');
  assert.equal(G.ctx.PropertiesService.getScriptProperties().getProperty('schema_fp'), G.ctx.schemaFingerprint_());
  // permintaan berikutnya tidak menjalankan pembaruan lagi
  assert.equal(G.ctx.autoSchema_(), false);
  void before;
});

test('foto per Child SKU: link https tersimpan, tampil di lookup & ekspor; link tidak aman ditolak', () => {
  const d = ok(call(V, 'product.get', { id: ids.pur.id }));
  const url = 'https://cf.shopee.co.id/file/id-11134207-822wt-mlr01rub8bnlaa';
  const x = toInput(d);
  x.variants[0].imageUrl = 'http://contoh.local/foto.jpg';
  assert.equal(fail(call(T, 'product.save', { input: x }), 'VALIDATION_FAILED').details[0].path, 'variants.0.imageUrl');
  x.variants[0].imageUrl = url;
  const d2 = ok(call(T, 'product.save', { input: x }));
  assert.equal(d2.variants[0].imageUrl, url);
  assert.equal(d2.variants[0].sku, d.variants[0].sku, 'foto tidak mengubah SKU');
  assert.equal(ok(call(V, 'barcode.lookup', { code: d2.variants[0].sku })).matches[0].imageUrl, url);
  const master = ok(call(T, 'export.data', { kind: 'master' }));
  assert.equal(master.rows.find((r) => r[1] === d2.variants[0].sku)[master.headers.indexOf('Foto')], url);
  // edit tanpa mengirim foto → foto tetap
  const y = toInput(d2);
  delete y.variants[0].imageUrl;
  assert.equal(ok(call(T, 'product.save', { input: y })).variants[0].imageUrl, url);
});

test('unggah foto Child SKU ke Drive: file dibagikan via link, URL dipakai sebagai foto; format salah ditolak', () => {
  // gambar PNG 1×1
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = ok(call(T, 'photo.upload', { dataUrl: png, fileName: 'foto.png' }));
  assert.match(r.url, /^https:\/\/lh3\.googleusercontent\.com\/d\/file-\d+$/);
  assert.equal(G.ctx.DriveApp._files.at(-1).sharing, 'ANYONE_WITH_LINK:VIEW');
  fail(call(T, 'photo.upload', { dataUrl: 'data:text/html;base64,PGI+', fileName: 'x.html' }));
  fail(call(V, 'photo.upload', { dataUrl: png }), 'FORBIDDEN');
  const x = toInput(ok(call(V, 'product.get', { id: ids.pur.id })));
  x.variants[0].imageUrl = r.url;
  x.variants[0].imageFileId = r.fileId;
  assert.equal(ok(call(T, 'product.save', { input: x })).variants[0].imageUrl, r.url);
  assert.equal(ok(call(T, 'auth.me', {})).config.photoUpload, true, 'tombol unggah aktif setelah Drive diizinkan');
});
