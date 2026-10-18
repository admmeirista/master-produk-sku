/**
 * Uji import workbook template lama ASLI ("Template_Master_Produk_SKU_BeeCloud Fix.xlsx") di emulator.
 * Lokasi file: env TEMPLATE_XLSX, atau ~/Downloads/Template_Master_Produk_SKU_BeeCloud Fix.xlsx. Dilewati bila tidak ada.
 * Workbook dibaca dengan SheetJS persis seperti di browser (raw, bilangan bulat diubah ke teks utuh).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const { createGas } = require('./harness.cjs');

const FILE = process.env.TEMPLATE_XLSX || path.join(os.homedir(), 'Downloads', 'Template_Master_Produk_SKU_BeeCloud Fix.xlsx');
const has = fs.existsSync(FILE);

/** Sama dengan cellStr() di Pages.html: angka bulat → teks utuh (barcode tidak jadi notasi ilmiah). */
const cellStr = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : String(v));

test('import template Excel lama: tanpa produk duplikat, SKU lama tertelusur, idempoten', { skip: has ? false : 'file template tidak ditemukan: ' + FILE }, () => {
  const wb = XLSX.read(fs.readFileSync(FILE), { type: 'buffer' });
  const sheet = (re) => {
    const name = wb.SheetNames.find((n) => re.test(n));
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: true }).map((r) => r.map(cellStr));
  };
  const g = createGas();
  const out = JSON.parse(JSON.stringify(g.ctx.setup()));
  const tok = JSON.parse(JSON.stringify(g.ctx.api(null, 'auth.login', { email: out.admin.email, password: out.admin.password }))).data.token;
  const api = (a, p) => {
    const r = JSON.parse(JSON.stringify(g.ctx.api(tok, a, JSON.parse(JSON.stringify(p)))));
    if (!r.ok) throw new Error(r.error.message);
    return r.data;
  };
  const t0 = Date.now();
  const ref = api('import.commit', { type: 'reference', rows: sheet(/referensi/i), fileName: 'template.xlsx' });
  const bc = api('import.commit', { type: 'internal_barcodes', rows: sheet(/generator/i), fileName: 'template.xlsx' });
  const masterRows = sheet(/master produk/i);
  const preview = api('import.preview', { type: 'master', rows: masterRows, fileName: 'template.xlsx' });
  assert.equal(preview.dryRun, true);
  assert.equal(api('product.list', { status: 'all' }).total, 0, 'pratinjau tidak menulis');
  const rep = api('import.commit', { type: 'master', rows: masterRows, fileName: 'template.xlsx' });
  const ms = Date.now() - t0;
  console.log(JSON.stringify({ reference: ref.created, refWarnings: ref.warningCount, internal: bc.created, master: rep.created, skipped: rep.skipped, errors: rep.errorCount, warnings: rep.warningCount, ms }));

  // sebagian kategori lama bernama sama dengan kategori standar Shopee → dipakai, tidak dibuat ulang
  assert.ok(ref.created.brands >= 100 && ref.created.categories >= 60);
  assert.equal(rep.created.products, preview.created.products, 'pratinjau = hasil import');
  // Viva Air Mawar: GTIN 8992796011501 dipakai VAM100 & AIM100 di template → tetap SATU varian
  const hit = api('barcode.lookup', { code: '8992796011501' });
  assert.equal(hit.matches.length, 1);
  const viva = api('product.get', { id: hit.matches[0].productId });
  const legacy = viva.variants[0].externalSkus.map((x) => x.sku);
  assert.ok(legacy.some((s) => s.indexOf('-VAM100-') > 0) && legacy.some((s) => s.indexOf('-AIM100-') > 0), legacy.join(','));
  // SKU lama paket 6 → multipack virtual MP… berisi 6 × Child SKU yang sama (tanpa saldo stok sendiri)
  const sixHit = api('barcode.lookup', { code: 'VIV-TON-VAM100-8992796011501-6' });
  assert.equal(sixHit.bundles[0].via, 'SKU lama');
  const mp = api('bundle.get', { id: sixHit.bundles[0].bundleId });
  assert.match(mp.sku, /^MP\d{6}$/);
  assert.equal(mp.stockable, false);
  assert.deepEqual(mp.components.map((c) => [c.sku, c.quantity]), [[viva.variants[0].sku, 6]]);
  // AIM100 isi 6 juga 6 × barang yang sama → memakai multipack yang sama, bukan paket ganda
  assert.equal(api('barcode.lookup', { code: 'VIV-TON-AIM100-8992796011501-6' }).bundles[0].bundleId, mp.id);
  // tidak ada GTIN aktif ganda, tidak ada SKU internal ganda
  const bcs = g.sheets.get('VARIANT_BARCODES').data.slice(1).filter((r) => r[4] === 'ACTIVE').map((r) => r[1]);
  assert.equal(new Set(bcs).size, bcs.length);
  const skus = g.sheets.get('PRODUCT_VARIANTS').data.slice(1).map((r) => r[6]).filter(Boolean);
  assert.equal(new Set(skus).size, skus.length);
  // GTIN rekaan berawalan 99 tidak tersimpan sebagai barcode
  assert.ok(!bcs.some((c) => c.indexOf('99') === 0));
  // baris tidak lengkap dilaporkan, bukan diimpor
  assert.ok(rep.errorCount > 0);
  // import ulang tidak menggandakan apa pun
  const again = api('import.commit', { type: 'master', rows: masterRows, fileName: 'template.xlsx' });
  assert.ok(Object.values(again.created).every((n) => n === 0), JSON.stringify(again.created));
  // listing Shopee asli (sheet Data Performa): Seller SKU lama → mapping ke SKU internal, status confirmed
  const listing = sheet(/performa/i);
  const ch = api('import.commit', { type: 'channel_listing', channel: 'shopee', storeAccount: 'Meirista Official', rows: listing, fileName: 'template.xlsx' });
  console.log(JSON.stringify({ channel: ch.created.mappings, skipped: ch.skipped, unknown: ch.warningCount, errors: ch.errorCount }));
  assert.ok(ch.created.mappings >= 100, 'mapping listing dari SKU lama');
  const ml = api('mapping.list', { system: 'shopee', search: '8999225912415' });
  // listing "[6 PCS] Purbasari Gluta Hya" (SKU induk PRB-…-6) → multipack MP…, berstatus confirmed
  const six = ml.rows.find((m) => m.externalParentSku === 'PRB-BSR-GH180-8999225912415-6');
  assert.ok(six && six.status === 'confirmed' && six.targetKind === 'bundle' && /^MP\d{6}$/.test(six.internalSku), JSON.stringify(six));
  assert.ok(api('import.errors', { batchId: ch.batchId }).length === ch.warningCount + ch.errorCount);
  const ch2 = api('import.commit', { type: 'channel_listing', channel: 'shopee', storeAccount: 'Meirista Official', rows: listing, fileName: 'template.xlsx' });
  assert.equal(ch2.created.mappings, 0, 'import listing ulang tidak menggandakan mapping');
  assert.equal(api('import.history', {}).length, 6);
});
