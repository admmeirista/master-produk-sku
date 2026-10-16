/**
 * Pratinjau lokal Web App Apps Script (KHUSUS DEVELOPMENT).
 * Menjalankan file .gs di emulator (test/harness.cjs), merakit Index.html seperti HtmlService,
 * dan meniru google.script.run lewat fetch('/rpc'). Data hanya di memori.
 *   node apps-script/dev/server.cjs   -> http://localhost:8790
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createGas } = require('../test/harness.cjs');

const SRC = path.join(__dirname, '../src');
const PORT = Number(process.env.PORT || 8790);
const { ctx } = createGas({ ownerEmail: 'owner@toko.local' });
const call = (t, a, p) => JSON.parse(JSON.stringify(ctx.api(t, a, p)));

// ----- data demo (akun development; password tercatat di sini, bukan untuk produksi)
const DEV_USERS = [
  ['admin@toko.local', 'Admin Toko', 'admin', 'Admin#Rpm2026'],
  ['entry@toko.local', 'Rina (Data Entry)', 'data_entry', 'Entry#Rpm2026'],
  ['reviewer@toko.local', 'Sari (Reviewer)', 'reviewer', 'Review#Rpm2026'],
  ['viewer@toko.local', 'Budi (Viewer)', 'viewer', 'Viewer#Rpm2026'],
];
const owner = JSON.parse(JSON.stringify(ctx.setup()));
const ownerToken = call(null, 'auth.login', { email: owner.email, password: owner.password }).data.token;
DEV_USERS.forEach(([email, fullName, role, password]) => call(ownerToken, 'user.create', { email, fullName, role, password }));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));
const refRows = [['Nama Brand', 'Kode Brand', '', 'Nama Kategori', 'Kode Kategori']].concat(
  Array.from({ length: Math.max(ref.brands.length, ref.categories.length) }, (_, i) => [ref.brands[i]?.name || '', ref.brands[i]?.code || '', '', ref.categories[i]?.name || '', ref.categories[i]?.code || '']),
);
const prep = call(ownerToken, 'import.prepare', { type: 'reference', rows: refRows }).data;
call(ownerToken, 'import.commit', { type: 'reference', rows: refRows, headerIndex: prep.headerIndex, mapping: prep.mapping, fileName: 'reference.json' });
const tok = (e, p) => call(null, 'auth.login', { email: e, password: p }).data.token;
const entry = tok('entry@toko.local', 'Entry#Rpm2026');
const reviewer = tok('reviewer@toko.local', 'Review#Rpm2026');
const brands = call(entry, 'ref.list', { kind: 'brand' }).data;
const cats = call(entry, 'ref.list', { kind: 'category' }).data;
const B = (c) => brands.find((b) => b.code === c).id;
const C = (c) => cats.find((b) => b.code === c).id;
const single = (b, s) => ({ skuType: 'single', packQty: 1, salesUnit: 'PCS', purchasePrice: b, sellingPrice: s });
const pack = (q, b, s) => ({ skuType: 'multipack', packQty: q, salesUnit: 'PACK', purchasePrice: b * q, sellingPrice: s });
const mk = (input) => call(entry, 'product.save', { input }).data;
const viva = mk({ brandId: B('VIV'), categoryId: C('TON'), productCode: 'VAM100', name: 'Viva Air Mawar 100ml', variants: [{ barcode: { mode: 'gtin', code: '8992796011501' }, skus: [single(4900, 7500), pack(6, 4900, 42000), pack(12, 4900, 80000), pack(24, 4900, 152000)] }] });
const prb = mk({ brandId: B('PRB'), categoryId: C('BSR'), productCode: 'GH180', name: 'Purbasari Gluta Hya Body Serum 180ml', variants: [{ barcode: { mode: 'gtin', code: '8999225912415' }, skus: [single(29000, 42000), pack(3, 29000, 120000), pack(6, 29000, 235000)] }] });
for (const p of [viva, prb]) {
  call(entry, 'product.workflow', { id: p.id, action: 'submit' });
  call(reviewer, 'product.workflow', { id: p.id, action: 'approve', reason: 'Barcode cocok kemasan' });
  call(reviewer, 'product.workflow', { id: p.id, action: 'activate' });
}
const shade = (code, value, barcode) => ({ variantCode: code, name: value, attributes: [{ type: 'shade', value }], barcode, skus: [single(27360, 38000)] });
const pixy = mk({ brandId: B('PXY'), categoryId: C('PWR'), productCode: 'UPCR', name: 'Pixy UV Perfect Creamy Cake Refill', hasVariants: true, variants: [shade('NO', 'Natural Ochre', { mode: 'internal' }), shade('SY', 'Silky Yellow', { mode: 'internal' }), shade('YH', 'Yellow Honey', { mode: 'gtin', code: '8992222072045' })] });
call(entry, 'product.workflow', { id: pixy.id, action: 'submit' });
mk({ brandId: B('VIV'), categoryId: C('TON'), productCode: 'AIM100', name: 'VIVA Air Mawar 100 ML', variants: [{ barcode: { mode: 'none' }, skus: [single(4900, 7500)] }] });

// ----- HTML seperti HtmlService (include + scriptlet)
function page() {
  let html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
  html = html.replace(/<\?!= include\('(\w+)'\); \?>/g, (_, n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8'));
  const shim = `<script>
  (function(){
    function runner(ok, fail){
      return new Proxy({}, { get: function(_, name){
        if (name === 'withSuccessHandler') return function(fn){ return runner(fn, fail); };
        if (name === 'withFailureHandler') return function(fn){ return runner(ok, fn); };
        return function(){ var args = Array.prototype.slice.call(arguments);
          fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn: name, args: args }) })
            .then(function(r){ return r.json(); }).then(function(d){ d.error ? (fail && fail(new Error(d.error))) : (ok && ok(d.result)); })
            .catch(function(e){ fail && fail(e); }); };
      }});
    }
    window.google = { script: { run: runner(null, null) } };
  })();</script>`;
  return html.replace('<body>', '<body>' + shim);
}

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/rpc') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { fn, args } = JSON.parse(body);
          if (fn !== 'api') throw new Error('fungsi tidak diizinkan');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ result: JSON.parse(JSON.stringify(ctx.api(...args))) }));
        } catch (e) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page());
  })
  .listen(PORT, () => console.log(`Pratinjau Apps Script: http://localhost:${PORT}  (login: admin@toko.local / Admin#Rpm2026)`));
