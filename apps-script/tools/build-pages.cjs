/**
 * Membangun versi statis aplikasi untuk GitHub Pages dari file HTML yang sama dengan Apps Script.
 * Panggilan server memakai fetch ke URL Web App (doPost), bukan google.script.run.
 *   APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXX/exec node apps-script/tools/build-pages.cjs _site
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src');
const out = path.resolve(process.argv[2] || '_site');
const apiUrl = String(process.env.APPS_SCRIPT_URL || '').trim();
if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(apiUrl) && !/^http:\/\/localhost:\d+\//.test(apiUrl)) {
  console.error('APPS_SCRIPT_URL wajib berisi URL Web App, format: https://script.google.com/macros/s/<ID>/exec');
  process.exit(1);
}
let html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
html = html.replace(/<\?!= include\('(\w+)'\); \?>/g, (_, n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8'));
if (/<\?/.test(html)) throw new Error('Masih ada scriptlet Apps Script yang belum diproses');
html = html.replace('<base target="_top" />', '');
html = html.replace(
  '<meta charset="utf-8" />',
  '<meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n    <title>Meirista SKU Master</title>\n' +
    '    <link rel="manifest" href="manifest.webmanifest" />\n' +
    '    <link rel="icon" type="image/png" href="favicon.png" />\n' +
    '    <link rel="apple-touch-icon" href="apple-touch-icon.png" />\n' +
    '    <meta name="theme-color" content="#28302b" />\n' +
    '    <meta name="mobile-web-app-capable" content="yes" />\n' +
    '    <meta name="apple-mobile-web-app-capable" content="yes" />\n' +
    '    <meta name="apple-mobile-web-app-title" content="SKU Master" />\n' +
    `    <script>window.RPM_API_URL = ${JSON.stringify(apiUrl)};</script>`,
);
fs.mkdirSync(out, { recursive: true });
// ikon & manifest (pasang ke layar utama / PWA)
const PAGES = path.join(__dirname, '../pages');
fs.readdirSync(PAGES).forEach((f) => fs.copyFileSync(path.join(PAGES, f), path.join(out, f)));
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Halaman GitHub Pages dibuat di', out, '-> API:', apiUrl);
