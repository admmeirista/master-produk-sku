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
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/PackageForm.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ShopeePackage.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ShopeeReviewHelpers.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  return { context, modals, calls, elements };
}

test('status di header dan navigasi terpisah dari persetujuan; pilihan ikut dibawa saat pindah',()=>{
 const {context:c,modals,elements,calls}=ui(false),moves=[],row={id:'nav',status:'approved',version:1,name:'Viva',saleType:'multipack',expectedComponents:[{sku:'PRD000011-001',quantity:10}]};
 c.shopeeReviewDialog(row,()=>{}, {position:1,total:35,canPrevious:false,canNext:true,move:(direction,draft,close)=>{moves.push({direction,draft});close();}});
 assert.match(modals[0].html,/sh-review-current-status[\s\S]*shopee-status-approved/);assert.match(modals[0].html,/id="svPrevious" disabled/);assert.match(modals[0].html,/1 \/ 35/);assert.match(modals[0].html,/id="svNext"/);
 elements['#svNext'].onclick();assert.equal(moves.length,1);assert.equal(moves[0].direction,1);assert.equal(moves[0].draft.expectedComponents[0].quantity,10);assert.equal(moves[0].draft.status,'approved');assert.equal(calls.length,0);assert.equal(modals[0].isConnected,false);
});

test('Simpan untuk diverifikasi langsung menutup popup, menyimpan pilihan di antrean, dan menampilkan kegagalan tanpa menganggap berhasil',async()=>{
 const {context:c,elements,modals}=ui(true);let reject,requests=[],done=[];c.api=(action,p)=>{requests.push([action,p]);return new Promise((a,b)=>reject=b);};
 c.shopeeOpenReview({id:'draft',version:1,name:'Produk',saleType:'bundle',expectedComponents:[{sku:'PRD000001-001',quantity:2}]},(...args)=>done.push(args));
 elements['#svReview'].onclick();elements['#svReview'].onclick();assert.equal(requests.length,1);assert.equal(requests[0][1].draft.components[0].quantity,2);assert.equal(requests[0][1].note,'');assert.equal(modals[0].isConnected,false);assert.equal(done[0][2],'pending');
 reject(new Error('Jaringan terputus'));await new Promise(setImmediate);assert.equal(c.ShopeeReviewJobs.get('draft').state,'error');assert.match(c.ShopeeReviewJobs.get('draft').error.message,/Jaringan/);assert.equal(done.length,1);
});

test('retry antrean memakai request key yang sama dan status disetujui baru diterapkan setelah server berhasil',async()=>{
 const {context:c,elements}=ui(true);let n=0,reject,resolve;const requests=[],events=[];c.uid=()=>String(++n);c.api=(action,p)=>{requests.push(p);return new Promise((a,b)=>{resolve=a;reject=b;});};c.ShopeeReviewJobs.onChange=j=>events.push(j.state);
 c.shopeeOpenReview({id:'retry',version:1,saleType:'bundle',expectedComponents:[{sku:'PRD000001-001',quantity:1}]},()=>{});c.$('#svNote').value='';elements['#svReview'].onclick();reject({code:'NETWORK',message:'Respons terputus'});await new Promise(setImmediate);
 const job=c.ShopeeReviewJobs.get('retry');assert.equal(job.state,'error');c.ShopeeReviewJobs.retry(job);assert.equal(requests.length,2);assert.equal(requests[0].requestKey,requests[1].requestKey);resolve({id:'retry',status:'needs_review',version:2});await new Promise(setImmediate);assert.equal(job.state,'saved');assert.equal(job.updated.status,'needs_review');assert.equal(events.at(-1),'saved');
});

test('antrean dipulihkan setelah refresh dengan pilihan yang sama dan terpisah per akun',()=>{
 const {context:c}=ui(true),memory={};c.sessionStorage={getItem:k=>memory[k]||null,setItem:(k,v)=>memory[k]=v};c.App={me:{user:{id:'akun-a'}}};
 const row={id:'listing-a',version:1,name:'Produk A'};
 c.ShopeeReviewJobs.enqueue(row,{id:row.id,requestKey:'tetap'},{...row,expectedComponents:[{sku:'PRD000001-001',quantity:3}],pendingBarcode:{mode:'internal',code:''}});
 c.ShopeeReviewJobs.account=null;c.ShopeeReviewJobs.init();const restored=c.ShopeeReviewJobs.get(row.id);assert.equal(restored.state,'error');assert.equal(restored.payload.requestKey,'tetap');assert.equal(restored.resume.expectedComponents[0].quantity,3);assert.equal(restored.resume.pendingBarcode.mode,'internal');
 c.App.me.user.id='akun-b';assert.equal(c.ShopeeReviewJobs.get(row.id),undefined);c.App.me.user.id='akun-a';assert.equal(c.ShopeeReviewJobs.get(row.id).payload.requestKey,'tetap');
});

test('brand otomatis dapat diganti manual dan pilihan tetap bertahan saat jenis penjualan berubah; pratinjau terisi sebelum paket ditemukan',async()=>{
 const {context:c,elements}=ui(true);
 const rows=[{sku:'PRD000001-001',brandId:'p',brandName:'Purbasari',productName:'Gluta Hya',displayName:'Purbasari Gluta Hya',parentSku:'PRD000001'},{sku:'PRD000002-001',brandId:'v',brandName:'Viva'}];
 c.SkuPicker={load:()=>Promise.resolve(rows)};
 c.shopeeOpenReview({id:'x',name:'Purbasari Gluta Hya',saleType:'bundle',expectedComponents:[{sku:rows[0].sku,quantity:1}]},()=>{});await new Promise(setImmediate);
 assert.equal(elements['#svBrand'].value,'p');assert.match(elements['#svTarget'].innerHTML,/Gluta Hya/);assert.match(elements['#svTarget'].innerHTML,/Belum ditentukan/);
 elements['#svBrand'].value='v';elements['#svBrand'].onchange();elements['#svType'].value='multipack';elements['#svType'].onchange();assert.equal(elements['#svBrand'].value,'v');
});

test('Setujui & berikutnya langsung menutup popup dan membuka berikutnya; gagal tidak memberi status disetujui',async()=>{
 const {context:c,elements,modals}=ui(true);let resolve,reject,saved=[],advance=[];
 c.api=(action,p)=>{saved.push(p);return new Promise((a,b)=>{resolve=a;reject=b;});};
 const row={id:'next-1',version:1,saleType:'single',quantity:1,expectedComponents:[{sku:'PRD000001-001',quantity:1}],target:{kind:'single',sku:'PRD000001-001',active:true,components:[{sku:'PRD000001-001',quantity:1}]}};
 c.shopeeReviewDialog(row,(r,next,phase)=>advance.push([r,next,phase]));
 elements['#svApproveNext'].onclick();elements['#svApproveNext'].onclick();assert.equal(saved.length,1);assert.equal(saved[0].action,'approve');assert.equal(advance.length,1);assert.equal(advance[0][1],true);assert.equal(advance[0][2],'pending');assert.equal(modals[0].isConnected,false);assert.notEqual(row.status,'approved');
 reject(new Error('Konflik versi'));await new Promise(setImmediate);const job=c.ShopeeReviewJobs.get(row.id);assert.equal(job.state,'error');assert.equal(advance.length,1);
 c.ShopeeReviewJobs.retry(job);resolve({...row,status:'approved',version:2});await new Promise(setImmediate);assert.equal(job.updated.status,'approved');assert.equal(advance.length,1,'hasil server tidak memindah produk untuk kedua kalinya');
});

test('Periksa membuka detail tabel secara sinkron tanpa menunggu atau memanggil API tambahan', () => {
  const { context, modals, calls, elements } = ui();
  const row = { id: 'listing-1', name: 'Gatsby Clay 30 gr', variationName: '3 pcs', productId: '123', variationId: '456', expectedComponents: [{sku:'PRD000168-003',quantity:3}], target: {kind:'multipack',sku:'MP000243',name:'Gatsby paket 3 pcs',active:true,components:[{sku:'PRD000168-003',quantity:3}]}, saleType: 'multipack', quantity: 3, version: 4 };
  const result = context.shopeeReviewDialog(row, () => {});
  assert.equal(modals.length, 1);assert.equal(result, modals[0]);assert.equal(calls.length, 0);
  assert.match(elements['#svTarget'].innerHTML, /Gatsby Clay 30 gr/);assert.match(elements['#svTarget'].innerHTML, /MP000243/);
  assert.equal(row.version, 4, 'snapshot version tetap dipakai untuk pemeriksaan konflik di server');
});

test('popup menampilkan urutan kolom pembanding dan menyetujui sekali tanpa ceklis atau permintaan detail tambahan', () => {
  const { context, modals, calls, elements } = ui(true);
  const row={id:'1',name:'Nama Shopee',variationName:'3 pcs',productId:'123',variationId:'456',parentSku:'PRD000168',sellerSku:'kode-lama',gtin:'899',expectedComponents:[{sku:'PRD000168-003',quantity:3}],target:{kind:'multipack',sku:'MP000243',productName:'Nama master',variationName:'30 gr',parentSku:'PRD000168',active:true,components:[{sku:'PRD000168-003',quantity:3}]},saleType:'multipack',quantity:3,version:1};
  context.shopeeReviewDialog(row,()=>{});
  assert.doesNotMatch(modals[0].html,/checkbox|svAck/);
  assert.match(modals[0].html,/Shopee Saat Ini/);assert.match(modals[0].html,/Master Sistem/);assert.match(modals[0].html,/Hasil Ekspor Shopee/);assert.doesNotMatch(modals[0].html,/svNote|Catatan pemeriksaan|svExportPreview/);
  const labels=[...elements['#svTarget'].innerHTML.matchAll(/<th scope="row">(.*?)<\/th>/g)].map(m=>m[1]);assert.deepEqual(labels,['Nama Produk','Variasi','SKU Induk / Parent','SKU','GTIN','Komposisi SKU Barang']);
  context.$('#svType').value='multipack';context.$('#svQty').value='3';
  elements['#svApprove'].onclick();elements['#svApprove'].onclick();elements['#svReview'].onclick();
  assert.equal(calls.length,1);assert.equal(calls[0][0],'shopee.review');assert.equal('acknowledged' in calls[0][1],false);
  assert.equal(elements['#svReview'].disabled,true);assert.equal(modals[0].isConnected,false,'popup langsung ditutup, hasil masih menunggu konfirmasi server');assert.equal(context.ShopeeReviewJobs.get(row.id).state,'saving');
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
