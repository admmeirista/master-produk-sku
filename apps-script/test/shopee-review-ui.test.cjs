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
    modal: html => { const m = { html, isConnected: true, attrs:{},setAttribute(k,v){this.attrs[k]=v;},close() { this.isConnected = false; } }; modals.push(m); return m; },
    loadingBox: text => text, errBox: text => 'Error: ' + text,
    api: (...args) => { calls.push(args); return new Promise(() => {}); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ShopeePlacementCore.gs'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/Shopee.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/PackageForm.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ShopeePackage.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ShopeeReviewHelpers.html'), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context);
  return { context, modals, calls, elements };
}
test('setiap baris BD memiliki brand sendiri; mengganti brand hanya mengosongkan SKU baris itu',async()=>{
 const {context:c,elements}=ui(true),pickers=[],rows=[{sku:'PRD000001-001',brandId:'p',brandName:'Purbasari',displayName:'Body Serum'},{sku:'PRD000002-001',brandId:'v',brandName:'Viva',displayName:'Air Mawar'}],lines=[{sku:rows[0].sku,quantity:1},{sku:rows[1].sku,quantity:2}],host={innerHTML:''};let changed=0;
 c.SkuPicker={load:()=>Promise.resolve(rows)};c.skuCombo=(host,kinds,select,placeholder,value,filter)=>pickers.push({host,select,filter});
 c.packageLines(host,{prefix:'bp',lines,type:'bundle',writable:true,brandId:'p',changed:()=>changed++,remove:()=>{}});await new Promise(setImmediate);
 assert.match(host.innerHTML,/bpBrand0/);assert.match(host.innerHTML,/bpBrand1/);assert.equal(elements['#bpBrand0'].value,'p');assert.equal(elements['#bpBrand1'].value,'v');assert.equal(pickers.at(-1).filter.brandId,'v');
 elements['#bpBrand0'].value='v';elements['#bpBrand0'].onchange();assert.equal(lines[0].sku,'');assert.equal(lines[1].sku,rows[1].sku);assert.equal(lines[1].quantity,2);assert.equal(changed,1);assert.equal(pickers.at(-1).filter.brandId,'v');
 pickers.at(-1).select(rows[1]);assert.equal(lines[0].sku,rows[1].sku);assert.equal(lines[0].brandId,'v');
});
test('kartu barang memakai filter brand sendiri dan mempertahankan qty barang lainnya',async()=>{
 const {context:c,elements}=ui(true),rows=[{sku:'PRD000003-001',brandId:'p',brandName:'Purbasari',displayName:'Body Serum',gtin:'8999225912415'},{sku:'PRD000011-001',brandId:'v',brandName:'Viva',displayName:'Air Mawar',gtin:'8992796011501'}],lines=rows.map(r=>({sku:r.sku,quantity:2})),pickers=[];let changes=0;
 c.SkuPicker={load:()=>Promise.resolve(rows)};c.skuCombo=(host,k,select,placeholder,value,filter)=>pickers.push({select,filter});
 c.packageLines({innerHTML:''},{prefix:'sv',reviewCards:true,lines,type:'bundle',writable:true,changed:()=>changes++,remove:()=>{}});await new Promise(setImmediate);
 assert.equal(elements['#svBrand0'].value,'p');assert.equal(elements['#svBrand1'].value,'v');assert.equal(pickers.at(-1).filter.brandId,'v');
 elements['#svBrand0'].value='v';elements['#svBrand0'].onchange();assert.equal(lines[0].sku,'');assert.equal(lines[1].sku,rows[1].sku);assert.equal(lines[1].quantity,2);assert.equal(changes,1);pickers.at(-1).select(rows[1]);assert.equal(lines[0].brandId,'v');assert.match(elements['#svMeta0'].innerHTML,/8992796011501/);
 c.packageLines({innerHTML:''},{prefix:'sv',reviewCards:true,pickerRows:rows,brandId:'p',lines:[lines[0]],type:'single',writable:true,changed:()=>{},remove:()=>{}});elements['#svBrand0'].value='';elements['#svBrand0'].onchange();assert.equal(pickers.at(-1).filter.brandId,'','Semua brand tidak dikunci kembali oleh tebakan brand dari judul');
});
test('preview ringkas tetap memakai aturan ekspor single, variasi, parent gabungan, dan paket baru',()=>{
 const {context:c}=ui(),target={sku:'MP000033',kind:'multipack',parentSku:'PRD000011',gtin:'',active:true},row={parentSku:'LAMA',sellerSku:'LAMA',gtin:''};
 const single=c.shopeeReviewExportRows(row,target,c.ShopeePlacement.preview({kind:'single'},target));assert.match(single,/MP000033/);assert.match(single,/Kosong \(tanpa variasi\)/);assert.equal((single.match(/<tr>/g)||[]).length,3);
 const shape={kind:'variants',originalParentKnown:true,originalParentSku:'GRUP-LAMA',masterParentSkus:['PRD000011','PRD000012']},mixed=c.shopeeReviewExportRows(row,target,c.ShopeePlacement.preview(shape,target));assert.match(mixed,/GRUP-LAMA/);assert.match(mixed,/MP000033/);
 const pending=c.shopeeReviewExportRows(row,{preview:true},c.ShopeePlacement.preview({kind:'single'},{preview:true,kind:'multipack'}),'MP baru saat disetujui');assert.match(pending,/MP baru saat disetujui/);assert.doesNotMatch(pending,/undefined/);
});
test('mengubah barcode paket memperbarui preview tanpa mengubah GTIN master atau membuat permintaan API',()=>{
 const {context:c,elements,calls}=ui(true),target={sku:'MP000033',kind:'multipack',active:true,parentSku:'PRD000011',gtin:'',components:[{sku:'PRD000011-001',quantity:10}]};c.shopeeOpenReview({id:'barcode-preview',version:1,saleType:'multipack',listingShape:{kind:'single'},target,expectedComponents:target.components},()=>{});
 elements['[data-package-barcode]'].value='gtin';elements['[data-package-barcode]'].onchange();elements['#pbrequest1Code'].value='8992796011501';elements['#pbrequest1Code'].oninput();assert.match(elements['#svTarget'].innerHTML,/8992796011501/);assert.equal(target.gtin,'');assert.equal(calls.length,0);
 elements['[data-package-barcode]'].value='internal';elements['[data-package-barcode]'].onchange();assert.doesNotMatch(elements['#svTarget'].innerHTML,/8992796011501/);
});

test('status di header dan navigasi terpisah dari persetujuan; pilihan ikut dibawa saat pindah',()=>{
 const {context:c,modals,elements,calls}=ui(false),moves=[],row={id:'nav',status:'approved',version:1,name:'Viva',saleType:'multipack',expectedComponents:[{sku:'PRD000011-001',quantity:10}]};
 c.shopeeReviewDialog(row,()=>{}, {position:1,total:35,canPrevious:false,canNext:true,move:(direction,draft,close)=>{moves.push({direction,draft});close();}});
 assert.match(modals[0].html,/sh-review-current-status[\s\S]*shopee-status-approved/);assert.match(modals[0].html,/id="svPrevious" disabled/);assert.match(modals[0].html,/1 \/ 35/);assert.match(modals[0].html,/id="svNext"/);
 elements['#svNext'].onclick();assert.equal(moves.length,1);assert.equal(moves[0].direction,1);assert.equal(moves[0].draft.expectedComponents[0].quantity,10);assert.equal(moves[0].draft.status,'approved');assert.equal(calls.length,0);assert.equal(modals[0].isConnected,false);
});
test('persentase tampil bersama status; skor lama disembunyikan setelah pilihan diubah',()=>{
 const {context:c,modals,elements}=ui(true),target={sku:'MP000033',kind:'multipack',active:true,parentSku:'PRD000011',components:[{sku:'PRD000011-001',quantity:10}]};
 c.shopeeOpenReview({id:'score',version:1,status:'suggested',name:'Viva',saleType:'multipack',expectedComponents:target.components,target,match:{score:99,candidateSku:target.sku,reason:'Brand, ukuran, qty sesuai'}},()=>{});
 assert.match(modals[0].html,/sh-review-current-status[\s\S]*sh-review-current-confidence[\s\S]*99%/);assert.doesNotMatch(modals[0].html,/sh-review-match-info/);assert.match(elements['#svHeaderConfidence'].innerHTML,/99%/);
 elements['#svType'].value='single';elements['#svType'].onchange();assert.doesNotMatch(elements['#svHeaderConfidence'].innerHTML,/99%/);assert.match(elements['#svHeaderConfidence'].innerHTML,/Pilihan berubah/);
});
test('konfirmasi penyimpanan tidak memunculkan toast otomatis',async()=>{
 const {context:c}=ui(true),notices=[];c.toast=(...args)=>notices.push(args);c.api=()=>Promise.resolve({id:'saved',status:'approved'});
 c.ShopeeReviewJobs.enqueue({id:'saved',name:'Viva'},{id:'saved'},{});await new Promise(setImmediate);assert.equal(c.ShopeeReviewJobs.jobs[0].state,'saved');assert.equal(notices.length,0);
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
 assert.equal(elements['#svBrand'].value,'p');assert.match(elements['#svMasterDetails'].innerHTML,/Gluta Hya/);assert.match(elements['#svMasterDetails'].innerHTML,/Belum ditentukan/);
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
  assert.match(modals[0].html, /Gatsby Clay 30 gr/);assert.match(elements['#svMasterDetails'].innerHTML, /MP000243/);
  assert.equal(row.version, 4, 'snapshot version tetap dipakai untuk pemeriksaan konflik di server');
});

test('popup menampilkan urutan kolom pembanding dan menyetujui sekali tanpa ceklis atau permintaan detail tambahan', () => {
  const { context, modals, calls, elements } = ui(true);
  const row={id:'1',name:'Nama Shopee',variationName:'3 pcs',productId:'123',variationId:'456',parentSku:'PRD000168',sellerSku:'kode-lama',gtin:'899',expectedComponents:[{sku:'PRD000168-003',quantity:3}],target:{kind:'multipack',sku:'MP000243',productName:'Nama master',variationName:'30 gr',parentSku:'PRD000168',active:true,components:[{sku:'PRD000168-003',quantity:3}]},saleType:'multipack',quantity:3,version:1};
  context.shopeeReviewDialog(row,()=>{});
  assert.doesNotMatch(modals[0].html,/checkbox|svAck/);
  assert.match(modals[0].html,/Shopee saat ini/);assert.match(modals[0].html,/Master Sistem/);assert.match(modals[0].html,/Hasil ekspor Shopee/);assert.doesNotMatch(modals[0].html,/svNote|Catatan pemeriksaan|svExportPreview/);
  const labels=[...elements['#svTarget'].innerHTML.matchAll(/<th scope="row">(.*?)<\/th>/g)].map(m=>m[1]);assert.deepEqual(labels,['SKU Induk','SKU','GTIN']);
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

test('satuan menampilkan GTIN master, mengabaikan barcode draf paket, dan segera mengikuti pergantian SKU',async()=>{
 const {context:c,elements}=ui(true),pickers=[],requests=[];let resolve;
 const rows=[{sku:'PRD000004-001',displayName:'White Glow 180 ml',gtin:'8999225911258',internalBarcode:''},{sku:'PRD000003-001',displayName:'Gluta Hya 180 ml',gtin:'8999225911265',internalBarcode:''}];
 c.SkuPicker={load:()=>Promise.resolve(rows)};c.skuCombo=(host,kinds,changed)=>pickers.push(changed);
 c.api=(action,p)=>{requests.push([action,p]);return new Promise(r=>resolve=r);};
 const target={...rows[0],kind:'single',active:true,components:[{sku:rows[0].sku,quantity:1}]};
 c.shopeeOpenReview({id:'barcode-single',version:1,saleType:'single',target,expectedComponents:target.components,pendingBarcode:{mode:'gtin',code:'8992796011501'}},()=>{});
 await new Promise(setImmediate);
 assert.match(elements['#svBarcode'].innerHTML,/GTIN barang/);assert.match(elements['#svBarcode'].innerHTML,/8999225911258/);assert.doesNotMatch(elements['#svBarcode'].innerHTML,/Barcode paket|GTIN paket|<select|8992796011501/);
 pickers.at(-1)(rows[1]);assert.match(elements['#svBarcode'].innerHTML,/8999225911265/);assert.doesNotMatch(elements['#svBarcode'].innerHTML,/8999225911258/);
 const next={...rows[1],kind:'single',active:true,components:[{sku:rows[1].sku,quantity:1}]};resolve({target:next,quantity:1});await new Promise(setImmediate);
 elements['#svApprove'].onclick();const saved=requests.find(([action])=>action==='shopee.review')[1];assert.equal(saved.sku,rows[1].sku);assert.equal('barcode' in saved,false,'mapping satuan tidak mengubah barcode master');
});

test('barcode internal satuan tidak ditulis sebagai GTIN; kembali ke paket memulihkan form paket',()=>{
 const {context:c,elements}=ui(true),host={innerHTML:''};const form=c.packageBarcode(host,{},true);
 form.set({internalBarcode:'2000000000008'},true);assert.match(host.innerHTML,/GTIN belum tersedia di master/);assert.match(host.innerHTML,/Barcode internal barang/);assert.match(host.innerHTML,/2000000000008/);assert.doesNotMatch(host.innerHTML,/MasterGtin" value="200/);
 form.set({},true);assert.doesNotMatch(host.innerHTML,/2000000000008|Barcode internal barang/);
 form.set({gtin:'8992796011501'},false);assert.match(host.innerHTML,/GTIN paket/);assert.match(host.innerHTML,/<select/);assert.equal(form.get().code,'8992796011501');
});

test('paket belum ada: tombol menjelaskan pembuatan MP dan mengirim createPackage sebelum lanjut',async()=>{
 const {context:c,elements,modals}=ui(true),requests=[],done=[];c.api=(action,p)=>{requests.push([action,p]);return action==='shopee.packageResolve'?Promise.resolve({target:null,signature:'bom-3',quantity:3}):new Promise(()=>{});};
 c.shopeeOpenReview({id:'new-mp',version:1,saleType:'multipack',expectedComponents:[{sku:'PRD000011-001',quantity:3}]},(...a)=>done.push(a));await new Promise(setImmediate);
 assert.match(elements['#svApproveNext'].textContent,/Buat paket & berikutnya/);assert.match(elements['#svActionHint'].textContent,/Paket Penjualan/);elements['#svApproveNext'].onclick();const payload=requests.find(([a])=>a==='shopee.review')[1];assert.equal(payload.createPackage,true);assert.equal(payload.selection.saleType,'multipack');assert.equal(done[0][1],true);assert.equal(modals[0].isConnected,false);
});

test('mobile berganti tab tanpa API atau kehilangan pilihan SKU dan qty',()=>{
 const {context:c,calls,modals}=ui(false),attrs={},buttons=['mapping','compare'].map(view=>({getAttribute:()=>view,setAttribute:(k,v)=>attrs[view+':'+k]=v}));
 c.$$=selector=>selector==='[data-review-panel]'?buttons:[];const row={id:'mobile',saleType:'single',expectedComponents:[{sku:'PRD000011-001',quantity:1}]};
 c.shopeeOpenReview(row,()=>{});buttons[1].onclick();assert.equal(modals[0].attrs['data-review-panel'],'compare');assert.equal(attrs['compare:aria-pressed'],'true');buttons[0].onclick();assert.equal(modals[0].attrs['data-review-panel'],'mapping');assert.equal(row.expectedComponents[0].sku,'PRD000011-001');assert.equal(calls.length,0);
});

test('pilihan jenis penjualan langsung menyinkronkan qty dan isi form',()=>{
 const {context:c,elements}=ui(true),pressed={},buttons=['single','multipack','bundle'].map(type=>({getAttribute:()=>type,setAttribute:(k,v)=>pressed[type]=v}));c.$$=selector=>selector==='[data-sale-type]'?buttons:[];
 c.shopeeOpenReview({id:'types',saleType:'multipack',expectedComponents:[{sku:'PRD000011-001',quantity:6}]},()=>{});buttons[0].onclick();assert.equal(elements['#svType'].value,'single');assert.equal(elements['#svTotal'].textContent,'1 barang');assert.equal(pressed.single,'true');buttons[2].onclick();assert.equal(elements['#svType'].value,'bundle');assert.equal(elements['#svTotal'].textContent,'2 barang');
});
