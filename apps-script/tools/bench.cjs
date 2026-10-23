/**
 * Benchmark Master Produk & pencarian SKU di emulator (file .gs asli, Google Sheets ditiru di memori).
 *   node tools/bench.cjs                → versi sekarang
 *   GAS_SRC=/path/src node tools/bench.cjs → versi lain (mis. sebelum upgrade) untuk perbandingan
 * Mengukur logika server (baca tab → indeks → filter → halaman → JSON). Latensi jaringan & kecepatan baca
 * Google Sheets yang sebenarnya TIDAK termasuk — angka ini untuk membandingkan versi, bukan janji waktu nyata.
 */
const { createGas } = require('../test/harness.cjs');

const SIZES = (process.env.SIZES || '100,1000,5000,10000').split(',').map(Number);
const ms = (fn, n = 1) => {
  const t = process.hrtime.bigint();
  let out;
  for (let i = 0; i < n; i++) out = fn();
  return { ms: Number(process.hrtime.bigint() - t) / 1e6 / n, out };
};
function gtin(body12) {
  let sum = 0;
  for (let i = 11, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body12[i]) * w;
  return body12 + ((10 - (sum % 10)) % 10);
}

function seed(G, skus) {
  const S = G.sheets;
  const put = (tab, recs) => {
    const sh = S.get(tab);
    const head = sh.data[0];
    recs.forEach((r) => sh.data.push(head.map((h) => (r[h] === undefined ? '' : r[h]))));
  };
  const ts = new Date().toISOString();
  const cats = G.ctx.db_('MASTER_CATEGORIES').rows().filter((c) => G.ctx.catIsLeaf_(c));
  const brands = Array.from({ length: 60 }, (_, i) => ({ BrandID: 'b' + i, BrandName: 'Brand ' + i, NameKey: 'brand' + i, Status: 'ACTIVE', CreatedAt: ts }));
  put('MASTER_BRANDS', brands);
  const P = [], V = [], C = [], D = [];
  const nProd = Math.ceil(skus / 3);
  for (let i = 0; i < nProd; i++) {
    const pid = 'p' + i;
    P.push({ ProductID: pid, ProductNo: i + 1, BrandID: 'b' + (i % 60), CategoryID: cats[i % cats.length].CategoryID, ProductName: 'Produk Serum ' + i, NameKey: 'produk serum ' + i, ProductCode: 'PRD' + String(i + 1).padStart(6, '0'), BaseUnit: 'PCS', HasVariants: true, Status: 'ACTIVE', CreatedAt: ts, UpdatedAt: ts, Version: 1 });
    for (let j = 0; j < 3 && V.length < skus; j++) {
      const vid = pid + 'v' + j;
      const k = V.length;
      V.push({ VariantID: vid, ProductID: pid, VariantName: 'Warna ' + j, VariantAttributes: JSON.stringify([{ name: 'Warna', value: 'Warna ' + j }]), SKU: P[i].ProductCode + '-00' + (j + 1), GTIN: k % 10 ? gtin('899' + String(k).padStart(9, '0')) : '', Status: 'ACTIVE', SortOrder: j + 1, CreatedAt: ts, UpdatedAt: ts, BaseUnit: 'PCS', ProductSKUName: 'Brand ' + (i % 60) + ' Produk Serum ' + i + ' Warna ' + j, ImageUrl: k % 3 ? '' : 'https://lh3.googleusercontent.com/d/f' + k });
      C.push({ ConversionID: 'c' + k, VariantID: vid, ProductID: pid, UnitName: 'PCS', ConversionFactor: 1, ContainsUnit: 'PCS', BaseUnitEquivalent: 1, IsBaseUnit: true, Status: 'ACTIVE' });
      if (k % 2) C.push({ ConversionID: 'cb' + k, VariantID: vid, ProductID: pid, UnitName: 'BOX', ConversionFactor: 48, ContainsUnit: 'PCS', BaseUnitEquivalent: 48, IsBaseUnit: false, Status: 'ACTIVE' });
      if (k % 2) D.push({ DimensionID: 'd' + k, VariantID: vid, ProductID: pid, PackagingUnit: 'PCS', GrossWeightGrams: 45 });
    }
  }
  put('MASTER_PRODUCTS', P);
  put('PRODUCT_VARIANTS', V);
  put('UNIT_CONVERSIONS', C);
  put('PRODUCT_DIMENSIONS', D);
  G.ctx.resetDbCache_();
  return { P, V };
}

const results = [];
for (const n of SIZES) {
  const G = createGas();
  const out = JSON.parse(JSON.stringify(G.ctx.setup()));
  const tok = JSON.parse(JSON.stringify(G.ctx.api(null, 'auth.login', { email: out.admin.email, password: out.admin.password }))).data.token;
  const { V } = seed(G, n);
  const api = (a, p) => {
    const r = G.ctx.api(tok, a, p);
    if (!r.ok) throw new Error(a + ': ' + r.error.message);
    return r.data;
  };
  const target = V[Math.floor(V.length / 2)];
  const row = { skus: V.length };
  G.ctx.bumpDataVersion_(); // indeks direktori dibangun ulang (kondisi setelah ada perubahan data)
  let r = ms(() => api('product.list', { page: 1, pageSize: 25 }));
  row.list_cold = r.ms;
  row.payload_kb = JSON.stringify(r.out).length / 1024;
  row.list_warm = ms(() => api('product.list', { page: 1, pageSize: 25 }), 5).ms;
  row.page_10 = ms(() => api('product.list', { page: 10, pageSize: 25 }), 5).ms;
  row.search_name = ms(() => api('product.list', { search: 'serum 77', pageSize: 25 }), 5).ms;
  row.search_gtin = ms(() => api('product.list', { search: target.GTIN || target.SKU, pageSize: 25 }), 5).ms;
  row.filter_brand = ms(() => api('product.list', { brandId: 'b7', pageSize: 25 }), 5).ms;
  row.detail_first = ms(() => api('product.get', { id: target.ProductID })).ms;
  row.detail = ms(() => api('product.get', { id: target.ProductID }), 5).ms;
  try {
    row.photo_list = ms(() => api('photo.list', { filter: 'todo', pageSize: 20 }), 5).ms;
  } catch (e) {
    row.photo_list = null; // versi lama: belum ada fitur foto
  }
  results.push(row);
}
const f = (x) => (x === null || x === undefined ? '—' : x.toFixed(1));
console.log('SKU     | daftar (dingin) | daftar (cache) | hal. 10 | cari nama | cari GTIN | filter brand | detail (pertama) | detail (ulang) | foto: daftar | payload KB');
results.forEach((r) => console.log([String(r.skus).padEnd(7), f(r.list_cold).padStart(15), f(r.list_warm).padStart(14), f(r.page_10).padStart(7), f(r.search_name).padStart(9), f(r.search_gtin).padStart(9), f(r.filter_brand).padStart(12), f(r.detail_first).padStart(16), f(r.detail).padStart(14), f(r.photo_list).padStart(12), f(r.payload_kb).padStart(10)].join(' | ')));
if (process.env.JSON_OUT) require('fs').writeFileSync(process.env.JSON_OUT, JSON.stringify(results, null, 1));
