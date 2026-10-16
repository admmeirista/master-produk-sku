/**
 * Membuat daftar request Google Sheets batchUpdate untuk membangun struktur database
 * (tab, header, format teks, pengaturan default, nomor urut, tab Tentang, proteksi peringatan)
 * langsung dari SCHEMA di src/Config.gs.   node apps-script/tools/build-db-requests.cjs > requests.json
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Config.gs'), 'utf8') + '\n;this.S=SCHEMA;this.D=DEFAULT_SETTINGS;this.T=TAB_DESCRIPTION;', ctx);
const { S, D, T } = ctx;
const now = new Date().toISOString();
const str = (v) => ({ userEnteredValue: { stringValue: String(v) } });
const rows = (arr) => arr.map((r) => ({ values: r.map(str) }));
const head = { red: 0.91, green: 0.933, blue: 0.969 };
const req = [];
const about = [
  ['Database Master Produk & SKU', ''],
  ['Isi dan ubah data HANYA melalui aplikasi web agar validasi, persetujuan, dan audit trail tetap berjalan. Jangan mengganti nama tab atau urutan kolom.', ''],
  ['', ''],
  ['Tab', 'Isi'],
].concat(Object.keys(S).map((n) => [n, T[n] || '']));
req.push({ updateSheetProperties: { properties: { sheetId: 0, title: 'Tentang', gridProperties: { rowCount: 40, columnCount: 2 } }, fields: 'title,gridProperties.rowCount,gridProperties.columnCount' } });
req.push({ updateCells: { start: { sheetId: 0, rowIndex: 0, columnIndex: 0 }, rows: rows(about), fields: 'userEnteredValue' } });
req.push({ repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize' } });
req.push({ repeatCell: { range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColorStyle: { rgbColor: head } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColorStyle' } });
req.push({ updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } });
req.push({ updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 620 }, fields: 'pixelSize' } });
Object.entries(S).forEach(([name, cols], i) => {
  const id = i + 1;
  const data = [cols];
  if (name === 'Settings') Object.entries(D).forEach(([k, v]) => data.push([k, JSON.stringify(v), 'setup', now]));
  if (name === 'Sequences') ['product_no', 'variant_no', 'sku_no', 'request_no', 'batch_no', 'internal_barcode'].forEach((n) => data.push([n, '1']));
  req.push({ addSheet: { properties: { sheetId: id, title: name, gridProperties: { rowCount: 1000, columnCount: cols.length, frozenRowCount: 1 } } } });
  req.push({ repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } } }, fields: 'userEnteredFormat.numberFormat' } });
  req.push({ updateCells: { start: { sheetId: id, rowIndex: 0, columnIndex: 0 }, rows: rows(data), fields: 'userEnteredValue' } });
  req.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColorStyle: { rgbColor: head } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColorStyle' } });
  req.push({ addProtectedRange: { protectedRange: { range: { sheetId: id }, description: 'Diubah hanya lewat aplikasi Master Produk', warningOnly: true } } });
});
process.stdout.write(JSON.stringify(req));
