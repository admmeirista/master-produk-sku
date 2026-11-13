const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function ui() {
  const elements = {}, modals = [], calls = [];
  const context = {
    Pages: {}, can: () => false, esc: value => String(value ?? ''),
    $: (selector) => elements[selector] ||= { innerHTML: '' },
    modal: html => { const m = { html, isConnected: true, close() { this.isConnected = false; } }; modals.push(m); return m; },
    loadingBox: text => text, errBox: text => 'Error: ' + text,
    api: (...args) => { calls.push(args); return new Promise(() => {}); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/Shopee.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  return { context, modals, calls, elements };
}

test('Periksa membuka detail tabel secara sinkron tanpa menunggu atau memanggil API tambahan', () => {
  const { context, modals, calls, elements } = ui();
  const row = { id: 'listing-1', name: 'Gatsby Clay 30 gr', variationName: '3 pcs', productId: '123', variationId: '456', expectedComponents: [{sku:'PRD000168-003',quantity:3}], target: {sku:'MP000243',name:'Gatsby paket 3 pcs',active:true,components:[{sku:'PRD000168-003',quantity:3}]}, saleType: 'multipack', quantity: 3, version: 4 };
  const result = context.shopeeReviewDialog(row, () => {});
  assert.equal(modals.length, 1);assert.equal(result, modals[0]);assert.equal(calls.length, 0);
  assert.match(modals[0].html, /Gatsby Clay 30 gr/);assert.match(elements['#svTarget'].innerHTML, /MP000243/);
  assert.equal(row.version, 4, 'snapshot version tetap dipakai untuk pemeriksaan konflik di server');
});

test('pemanggil dengan ID saja langsung melihat jendela memuat selama API belum selesai', () => {
  const { context, modals, calls } = ui();
  context.shopeeReviewDialog('listing-2', () => {});
  assert.equal(modals.length, 1);assert.match(modals[0].html, /Memuat detail produk/);
  assert.equal(calls.length, 1);assert.equal(calls[0][0], 'shopee.get');
});
