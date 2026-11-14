const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function ui(write = false) {
  const elements = {}, modals = [], calls = [];
  const context = {
    Pages: {}, can: () => write, esc: value => String(value ?? ''),
    debounce: fn => fn, $$: () => [], icon: () => '', skuCombo: () => {}, uid: () => 'request-1', busy: (button,promise) => promise, toast: () => {},
    $: (selector) => elements[selector] ||= { innerHTML: '', classList: {toggle(){} } },
    modal: html => { const m = { html, isConnected: true, close() { this.isConnected = false; } }; modals.push(m); return m; },
    loadingBox: text => text, errBox: text => 'Error: ' + text,
    api: (...args) => { calls.push(args); return new Promise(() => {}); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/Shopee.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ShopeePackage.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  return { context, modals, calls, elements };
}

test('Periksa membuka detail tabel secara sinkron tanpa menunggu atau memanggil API tambahan', () => {
  const { context, modals, calls, elements } = ui();
  const row = { id: 'listing-1', name: 'Gatsby Clay 30 gr', variationName: '3 pcs', productId: '123', variationId: '456', expectedComponents: [{sku:'PRD000168-003',quantity:3}], target: {kind:'multipack',sku:'MP000243',name:'Gatsby paket 3 pcs',active:true,components:[{sku:'PRD000168-003',quantity:3}]}, saleType: 'multipack', quantity: 3, version: 4 };
  const result = context.shopeeReviewDialog(row, () => {});
  assert.equal(modals.length, 1);assert.equal(result, modals[0]);assert.equal(calls.length, 0);
  assert.match(modals[0].html, /Gatsby Clay 30 gr/);assert.match(elements['#svTarget'].innerHTML, /MP000243/);
  assert.equal(row.version, 4, 'snapshot version tetap dipakai untuk pemeriksaan konflik di server');
});

test('popup menampilkan urutan kolom pembanding dan menyetujui sekali tanpa ceklis atau permintaan detail tambahan', () => {
  const { context, modals, calls, elements } = ui(true);
  const row={id:'1',name:'Nama Shopee',variationName:'3 pcs',productId:'123',variationId:'456',parentSku:'PRD000168',sellerSku:'kode-lama',gtin:'899',expectedComponents:[{sku:'PRD000168-003',quantity:3}],target:{kind:'multipack',sku:'MP000243',productName:'Nama master',variationName:'30 gr',parentSku:'PRD000168',active:true,components:[{sku:'PRD000168-003',quantity:3}]},saleType:'multipack',quantity:3,version:1};
  context.shopeeReviewDialog(row,()=>{});
  assert.doesNotMatch(modals[0].html,/checkbox|svAck/);
  const sourceLabels=[...modals[0].html.matchAll(/<dt>(.*?)<\/dt>/g)].map(m=>m[1]);
  assert.deepEqual(sourceLabels,['Nama Produk','Variasi','Kode Produk','Kode Variasi','SKU Induk','SKU','GTIN']);
  const targetLabels=[...elements['#svTarget'].innerHTML.matchAll(/<dt>(.*?)<\/dt>/g)].map(m=>m[1]);
  assert.deepEqual(targetLabels,['Nama Produk','Variasi','SKU Parent','SKU','GTIN']);
  context.$('#svType').value='multipack';context.$('#svQty').value='3';context.$('#svNote').value='';
  elements['#svApprove'].onclick();elements['#svApprove'].onclick();elements['#svReview'].onclick();
  assert.equal(calls.length,1);assert.equal(calls[0][0],'shopee.review');assert.equal('acknowledged' in calls[0][1],false);
  assert.equal(elements['#svReview'].disabled,true);assert.equal(modals[0].isConnected,true,'belum dianggap berhasil sebelum server menyimpan');
});

test('Esc menutup hanya popup paling atas dan membersihkan listener setelah seluruh popup ditutup',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/Scripts.html'),'utf8');
  const code=source.slice(source.indexOf('function modal('),source.indexOf('function ask('));
  const listeners=new Set(),backgrounds=[];
  const document={createElement(){const bg={firstChild:{},addEventListener(){},remove(){backgrounds.splice(backgrounds.indexOf(bg),1);}};return bg;},body:{appendChild(bg){backgrounds.push(bg);}},addEventListener(event,fn){listeners.add(fn);},removeEventListener(event,fn){listeners.delete(fn);},querySelectorAll(){return backgrounds;}};
  const context={document,$$:()=>[]};vm.runInNewContext(code,context);
  const a=context.modal('premier'),b=context.modal('second');let closed=0;
  const escape=()=>{for(const listener of [...listeners]){let stop=false;listener({key:'Escape',preventDefault(){},stopImmediatePropagation(){stop=true;}});if(stop)break;}};
  escape();assert.equal(backgrounds.length,1);assert.ok(listeners.size===1);
  escape();assert.equal(backgrounds.length,0);assert.equal(listeners.size,0);a.close();b.close();assert.equal(backgrounds.length,0);
});

test('pemanggil dengan ID saja langsung melihat jendela memuat selama API belum selesai', () => {
  const { context, modals, calls } = ui();
  context.shopeeReviewDialog('listing-2', () => {});
  assert.equal(modals.length, 1);assert.match(modals[0].html, /Memuat detail produk/);
  assert.equal(calls.length, 1);assert.equal(calls[0][0], 'shopee.get');
});
