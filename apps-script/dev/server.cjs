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
  ['entry@toko.local', 'Rina (Admin Data)', 'data_entry', 'Entry#Rpm2026'],
  ['viewer@toko.local', 'Budi (Viewer)', 'viewer', 'Viewer#Rpm2026'],
];
const owner = JSON.parse(JSON.stringify(ctx.setup())).admin;
const ownerToken = call(null, 'auth.login', { email: owner.email, password: owner.password }).data.token;
DEV_USERS.forEach(([email, fullName, role, password]) => call(ownerToken, 'user.create', { email, fullName, role, password }));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));
const tok = (e, p) => call(null, 'auth.login', { email: e, password: p }).data.token;
const entry = tok('entry@toko.local', 'Entry#Rpm2026');
call(entry, 'brand.createMany', { names: ['Viva', 'Hanasui', 'Purbasari', 'Scarlett', 'Pixy'].concat(ref.brands.map((b) => b.name)), acknowledgeSimilar: true });
call(entry, 'category.createMany', { names: ['Parfum', 'Lipstick', 'Body Lotion', 'Facial Wash', 'Toner', 'Powder Refill'].concat(ref.categories.map((c) => c.name)), acknowledgeSimilar: true });
const brands = call(entry, 'brand.list', {}).data;
const cats = call(entry, 'category.list', {}).data;
const B = (n) => brands.find((b) => b.name === n).id;
const C = (n) => cats.find((c) => c.name === n).id;
const g13 = (b) => { let s = 0; for (let i = 11, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) s += Number(b[i]) * w; return b + ((10 - (s % 10)) % 10); };
const save = (input) => { const r = call(entry, 'product.save', { input }); if (!r.ok) console.error('seed gagal', input.name, r.error); };
save({ brandId: B('Scarlett'), categoryId: C('Parfum'), name: 'Parfum Eau de Parfum', baseUnit: 'BOTOL', hasVariants: true, variants: [
  { attributes: [{ name: 'Aroma', value: 'Ocean Blue' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'gtin', code: g13('899100000001') }, conversions: [{ unitName: 'BOX', factor: 24, isTradeItem: true, barcode: { mode: 'gtin', code: g13('899100000091') } }, { unitName: 'KARTON', factor: 6, containsUnit: 'BOX' }] },
  { attributes: [{ name: 'Aroma', value: 'Ocean Blue' }, { name: 'Volume', value: '100 ml' }], barcode: { mode: 'gtin', code: g13('899100000002') }, conversions: [{ unitName: 'BOX', factor: 12 }] },
  { attributes: [{ name: 'Aroma', value: 'Rose Garden' }, { name: 'Volume', value: '50 ml' }], barcode: { mode: 'gtin', code: g13('899100000003') }, conversions: [{ unitName: 'BOX', factor: 24 }] },
  { attributes: [{ name: 'Aroma', value: 'Rose Garden' }, { name: 'Volume', value: '100 ml' }], barcode: { mode: 'none' }, conversions: [] },
] });
save({ brandId: B('Viva'), categoryId: C('Toner'), name: 'Viva Air Mawar 100ml', baseUnit: 'BOTOL', hasVariants: false, variants: [{ barcode: { mode: 'gtin', code: '8992796011501' }, conversions: [{ unitName: 'LUSIN', factor: 12 }, { unitName: 'KARTON', factor: 4, containsUnit: 'LUSIN' }] }] });
save({ brandId: B('Hanasui'), categoryId: C('Lipstick'), name: 'Hanasui Matte Lip Cream', baseUnit: 'PCS', hasVariants: true, variants: ['01 Pink Nude', '02 Rosy', '03 Brick'].map((sh) => ({ attributes: [{ name: 'Shade', value: sh }], barcode: { mode: 'internal' }, conversions: [{ unitName: 'BOX', factor: 12 }, { unitName: 'KARTON', factor: 10, containsUnit: 'BOX' }] })) });

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
    // Meniru Web App /exec (doPost) untuk menguji versi GitHub Pages: GET /pages
    if (req.url === '/exec' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const out = ctx.doPost({ postData: { contents: body } });
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(out.getContent());
      });
      return;
    }
    if (req.url === '/pages' || req.url.startsWith('/pages?') || req.url.startsWith('/pages#')) {
      const { execFileSync } = require('node:child_process');
      const dir = path.join(require('node:os').tmpdir(), 'rpm-pages-preview');
      execFileSync(process.execPath, [path.join(__dirname, '../tools/build-pages.cjs'), dir], { env: { ...process.env, APPS_SCRIPT_URL: 'http://localhost:' + PORT + '/exec' } });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(dir, 'index.html')));
      return;
    }
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
  .listen(PORT, () => console.log(`Pratinjau Apps Script: http://localhost:${PORT}  (login: entry@toko.local / Entry#Rpm2026)`));
