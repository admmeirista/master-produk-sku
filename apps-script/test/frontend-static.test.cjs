/**
 * Pemeriksaan statis frontend (HtmlService): sintaks JavaScript setiap file HTML dan pemakaian helper DOM.
 *   $(sel)  → satu elemen (querySelector)
 *   $$(sel) → array elemen (querySelectorAll)
 * Memanggil .forEach/.map/.filter pada hasil $() membuat halaman gagal dirender.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src');
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.html'));

test('frontend: semua blok <script> lolos parse', () => {
  for (const f of files) {
    const html = fs.readFileSync(path.join(SRC, f), 'utf8');
    const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    assert.doesNotThrow(() => new Function(js), f);
  }
});

test('frontend: hasil $() (satu elemen) tidak dipakai sebagai daftar', () => {
  const bad = [];
  for (const f of files) {
    fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').forEach((line, i) => {
      const re = /\$\('[^']*'(?:,\s*\w+)?\)\.(forEach|map|filter)\b/g;
      let m;
      while ((m = re.exec(line))) if (line[m.index - 1] !== '$') bad.push(`${f}:${i + 1} ${m[0]}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('backend: semua file .gs lolos parse', () => {
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.gs'))) assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(SRC, f), 'utf8')), f);
});
