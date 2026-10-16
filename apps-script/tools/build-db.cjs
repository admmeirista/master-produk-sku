/**
 * Membangun file database kosong (XLSX) dari SCHEMA di src/Config.gs.
 * Hasilnya diunggah ke Google Drive dan dikonversi menjadi Google Sheets.
 *   node apps-script/tools/build-db.cjs <output.xlsx>
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ExcelJS = require('exceljs');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Config.gs'), 'utf8') + '\n;this.SCHEMA = SCHEMA; this.DEFAULT_SETTINGS = DEFAULT_SETTINGS; this.TAB_DESCRIPTION = TAB_DESCRIPTION;', ctx);
const { SCHEMA, DEFAULT_SETTINGS, TAB_DESCRIPTION } = ctx;


(async () => {
  const out = process.argv[2];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Master Produk & SKU';
  const now = new Date().toISOString();

  const about = wb.addWorksheet('Tentang');
  about.addRow(['Database Master Produk & SKU']);
  about.addRow(['File ini adalah database aplikasi web Apps Script. Isi dan ubah data HANYA melalui aplikasi agar validasi, persetujuan, dan audit trail tetap berjalan.']);
  about.addRow(['Jangan mengganti nama tab atau urutan kolom. Kolom diformat teks agar barcode & SKU tidak berubah menjadi angka.']);
  about.addRow([]);
  about.addRow(['Tab', 'Isi']);
  Object.keys(SCHEMA).forEach((t) => about.addRow([t, TAB_DESCRIPTION[t] || '']));
  about.getRow(1).font = { bold: true, size: 14 };
  about.getRow(5).font = { bold: true };
  about.getColumn(1).width = 22;
  about.getColumn(2).width = 90;

  for (const [name, cols] of Object.entries(SCHEMA)) {
    const ws = wb.addWorksheet(name);
    cols.forEach((_, i) => {
      const col = ws.getColumn(i + 1);
      col.numFmt = '@';
      col.width = Math.min(Math.max(cols[i].length + 4, 14), 36);
    });
    ws.addRow(cols);
    if (name === 'Settings')
      Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => ws.addRow([k, JSON.stringify(v), 'setup', now]));
    if (name === 'Sequences')
      ['product_no', 'variant_no', 'sku_no', 'request_no', 'batch_no', 'internal_barcode'].forEach((n) => ws.addRow([n, '1']));
    ws.eachRow((row) => row.eachCell((c) => (c.numFmt = '@')));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  await wb.xlsx.writeFile(out);
  console.log('OK', out, fs.statSync(out).size, 'bytes');
})();
