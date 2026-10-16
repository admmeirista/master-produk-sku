/**
 * Simulasi migrasi workbook template lama ke versi Apps Script (emulator).
 *   node apps-script/test/legacy-migration.cjs "C:/path/Template_Master_Produk_SKU_BeeCloud Fix.xlsx"
 */
const ExcelJS = require('exceljs');
const { createGas } = require('./harness.cjs');

const cell = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return v.result === undefined ? '' : cell(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.error || v.formula || v.sharedFormula) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
};

(async () => {
  const file = process.argv[2];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheetRows = (re) => {
    const ws = wb.worksheets.find((w) => re.test(w.name));
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const o = [];
      for (let c = 1; c <= Math.min(ws.columnCount, 40); c++) o.push(cell(row.getCell(c).value));
      rows[r - 1] = o;
    });
    for (let i = 0; i < rows.length; i++) rows[i] = rows[i] || [];
    return { name: ws.name, rows };
  };
  const { ctx } = createGas();
  const call = (t, a, p) => JSON.parse(JSON.stringify(ctx.api(t, a, JSON.parse(JSON.stringify(p)))));
  const admin = JSON.parse(JSON.stringify(ctx.setup()));
  const token = call(null, 'auth.login', { email: admin.email, password: admin.password }).data.token;
  for (const [type, re] of [['reference', /referensi/i], ['internal_barcodes', /generator/i], ['legacy_master', /master produk/i], ['shopee_listing', /performa/i]]) {
    const s = sheetRows(re);
    const t0 = Date.now();
    const prep = call(token, 'import.prepare', { type, rows: s.rows }).data;
    const res = call(token, 'import.commit', { type, rows: s.rows, headerIndex: prep.headerIndex, mapping: prep.mapping, fileName: 'template.xlsx', sheetName: s.name });
    if (!res.ok) {
      console.log(type, 'GAGAL', res.error);
      continue;
    }
    const sm = res.data.summary;
    console.log(`[${type}] ${s.name}: ${sm.total} baris | tersimpan ${res.data.committed} | error ${sm.error} | dilewati ${sm.skipped} | ${Date.now() - t0} ms`);
  }
  const d = call(token, 'dashboard.get', {}).data.counts;
  console.log('Dashboard:', { products: d.products, variants: d.variants, skus_active: d.skus_active, duplicate_candidates: d.duplicate_candidates });
})();
