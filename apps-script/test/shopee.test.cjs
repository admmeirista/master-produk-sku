const test = require('node:test');
const assert = require('node:assert/strict');
const {createGas} = require('./harness.cjs');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const G = createGas();
const call = (token, action, payload) => JSON.parse(JSON.stringify(G.ctx.api(token, action, payload || {})));
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
let A, V, S, product, single, mp, bd;
const source = (overrides={}) => Object.assign({productId:'123456789',variationId:'1001',name:'Viva Air Mawar 100 ml',variationName:'',sellerSku:'SKU/00001',gtin:'',price:15000,stock:20}, overrides);
const imp = (rows, store='Meirista') => ok(call(A,'shopee.import',{store,fileName:'Tarikan Shopee.xlsx',rows}));
const list = (p={}) => ok(call(A,'shopee.list',p));
function approval(row, sku, overrides={}) {
  const t = ok(call(A,'shopee.target',{sku}));
  return Object.assign({id:row.id,version:row.version,action:'approve',sku,targetSignature:t.signature,saleType:t.kind,quantity:t.components.reduce((s,c)=>s+c.quantity,0),components:t.components.map(c=>({sku:c.sku,quantity:c.quantity})),acknowledged:true,note:'Nama, varian dan seluruh isi paket sudah diperiksa.'},overrides);
}
test('persiapan pemeriksaan Shopee: master satuan, MP, BD dan pengguna',()=>{
  const setup = G.ctx.setup(); A=ok(call(null,'auth.login',{email:setup.admin.email,password:setup.admin.password})).token;
  const b=ok(call(A,'brand.create',{name:'Viva'}));
  const c=ok(call(A,'category.list',{})).find(c=>c.name==='Toner');
  product=ok(call(A,'product.save',{input:{brandId:b.id,categoryId:c.id,name:'Air Mawar',baseUnit:'PCS',hasVariants:true,variants:[{attributes:[{name:'Volume',value:'100 ml'}],barcode:{mode:'none'}},{attributes:[{name:'Volume',value:'200 ml'}],barcode:{mode:'none'}}]}}));
  single=product.variants[0].sku;
  mp=ok(call(A,'bundle.save',{type:'MULTIPACK',name:'Paket Air Mawar 3 PCS',components:[{variantId:product.variants[0].id,quantity:3}]})).sku;
  bd=ok(call(A,'bundle.save',{type:'MIXED',name:'Kombinasi Air Mawar',components:[{variantId:product.variants[0].id,quantity:1},{variantId:product.variants[1].id,quantity:1}]})).sku;
  for(const [email,role] of [['view@local.test','viewer'],['photo@local.test','photo_staff']])ok(call(A,'user.create',{email,fullName:email,role,password:'Password#2026'}));
  V=ok(call(null,'auth.login',{email:'view@local.test',password:'Password#2026'})).token;
  S=ok(call(null,'auth.login',{email:'photo@local.test',password:'Password#2026'})).token;
});
test('listing tanpa pasangan tetap tersimpan; import idempoten, identitas toko + produk + variasi, filter dan pagination',()=>{
  imp([source(),source({variationId:'1002',name:'[3 PCS] Air Mawar',stock:0})]);
  imp([source({price:16000})]);
  assert.equal(list().total,2);
  imp([source()],'Toko Kedua');assert.equal(list().total,3);
  assert.equal(list({store:'Meirista',withStock:true}).total,1);
  assert.equal(list({search:'1002'}).total,1);
  const paged=list({pageSize:1,page:2});assert.equal(paged.rows.length,1);assert.equal(paged.total,3);
  assert.equal(list().summary.unmapped,1);assert.equal(list().summary.suggested,2,'nama satuan persis memberi usulan tanpa menyetujui otomatis');
  const failed=call(A,'shopee.import',{rows:[source({productId:'222222222'}),source({productId:'not-an-id'})]});assert.equal(failed.ok,false);assert.equal(list().total,3,'tidak ada setengah batch tersimpan');
  assert.equal(call(V,'shopee.import',{rows:[source()]}).error.code,'FORBIDDEN');
  assert.equal(call(S,'shopee.list',{}).error.code,'FORBIDDEN');
});
test('persetujuan memakai SKU variasi, bukan SKU induk; viewer tidak dapat menyetujui',()=>{
  const r=list({store:'Meirista',search:'1001'}).rows[0];
  assert.equal(call(V,'shopee.review',approval(r,single)).error.code,'FORBIDDEN');
  assert.equal(call(A,'shopee.review',approval(r,single,{acknowledged:false})).ok,false);
  const saved=ok(call(A,'shopee.review',approval(r,single)));
  assert.equal(saved.status,'approved');assert.equal(saved.targetSku,single);assert.equal(saved.sellerSku,'SKU/00001');
  const mappings=ok(call(A,'mapping.list',{system:'shopee'})).rows;assert.equal(mappings.length,1);assert.equal(mappings[0].internalSku,single);assert.equal(mappings[0].externalSku,'SKU/00001');
  assert.equal(call(A,'shopee.review',approval(r,single)).error.code,'CONFLICT');
});
test('paket 3 pcs wajib MP dengan komponen/kuantitas tepat; paket campuran wajib BD; GTIN satuan tidak disalin ke paket',()=>{
  let r=list({store:'Meirista',search:'1002'}).rows[0];
  assert.equal(call(A,'shopee.review',approval(r,single,{saleType:'multipack',quantity:3})).error.code,'VALIDATION_FAILED');
  assert.equal(call(A,'shopee.review',approval(r,mp,{components:[{sku:product.variants[1].sku,quantity:3}]})).error.code,'VALIDATION_FAILED');
  assert.equal(call(A,'shopee.review',approval(r,mp,{quantity:6})).error.code,'VALIDATION_FAILED');
  const saved=ok(call(A,'shopee.review',approval(r,mp)));assert.equal(saved.target.kind,'multipack');assert.equal(saved.target.components[0].quantity,3);assert.equal(saved.target.gtin,'');
  imp([source({productId:'333333333',variationId:'1003',name:'Kombinasi 100 ml + 200 ml'})]);r=list({search:'333333333'}).rows[0];
  assert.equal(call(A,'shopee.review',approval(r,mp,{saleType:'bundle',quantity:2,components:[{sku:single,quantity:1},{sku:product.variants[1].sku,quantity:1}]})).ok,false);
  assert.equal(ok(call(A,'shopee.review',approval(r,bd))).targetSku,bd);
});
test('master berubah setelah pratinjau / persetujuan: signature dan status memaksa pemeriksaan ulang',()=>{
  const r=list({store:'Meirista',search:'1001'}).rows[0],p=approval(r,single);
  G.ctx.withLock_(()=>{const row=G.ctx.db_('PRODUCT_VARIANTS').byId(product.variants[0].id);G.ctx.db_('PRODUCT_VARIANTS').update(row,{ProductSKUName:'Viva Air Mawar Nama Baru 100 ml'});});
  assert.equal(call(A,'shopee.review',p).error.code,'CONFLICT');
  assert.equal(list({store:'Meirista',search:'1001'}).rows[0].status,'mismatch');
  assert.ok(list({status:'review'}).rows.some(x=>x.id===r.id));
});

test('unduhan hanya menerapkan persetujuan yang cocok dengan identitas file dan master terbaru',()=>{
  const raw=source({productId:'654321987',variationId:'42',name:'Viva Air Mawar 100 ml',parentSku:'lama'});
  const imported=imp([raw]);assert.equal(imported.rows.length,1);assert.equal(imported.rows[0].productId,raw.productId);
  const exp=(rows)=>ok(call(A,'shopee.export',{store:'Meirista',rows}));
  assert.equal(exp([raw])[0].eligible,false,'usulan belum boleh mengubah file');
  ok(call(A,'shopee.review',approval(imported.rows[0],single)));
  let result=exp([raw])[0];assert.equal(result.eligible,true);assert.equal(result.sku,single);assert.equal(result.parentSku,product.productCode);
  assert.equal(exp([Object.assign({},raw,{variationName:'200 ml'})])[0].eligible,false);
  assert.equal(exp([Object.assign({},raw,{sellerSku:'file-lain'})])[0].eligible,false);
  assert.equal(exp([Object.assign({},raw,{parentSku:'parent-lain'})])[0].eligible,false);
  G.ctx.withLock_(()=>{const v=G.ctx.db_('PRODUCT_VARIANTS').byId(product.variants[0].id);G.ctx.db_('PRODUCT_VARIANTS').update(v,{GTIN:'8991234567890'});});
  assert.equal(exp([raw])[0].eligible,false,'master berubah membatalkan kelayakan unduh');
  const current=list({search:raw.productId}).rows[0];ok(call(A,'shopee.review',approval(current,single)));
  assert.equal(exp([raw])[0].gtin,'8991234567890');
  const packRaw=source({productId:'876543210',variationId:'43',name:'[3 PCS] Air Mawar',gtin:'8991234567890'});
  const pack=imp([packRaw]).rows[0];ok(call(A,'shopee.review',approval(pack,mp)));
  result=exp([packRaw])[0];assert.equal(result.sku,mp);assert.equal(result.gtin,'','GTIN satuan tidak menjadi GTIN paket');
  assert.equal(call(A,'shopee.export',{rows:[]}).ok,false);
});

test('rencana unduhan menjaga baris belum disetujui dan parent produk dengan campuran pasangan',()=>{
  const context={Pages:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ShopeeWorkflow.html'),'utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),context);
  const header=['Kode Produk','Nama Produk','Kode Variasi','Nama Variasi','SKU Induk','SKU','Harga','GTIN','Stok'];
  const rows=[{productId:'123',variationId:'1',sourceRow:7},{productId:'123',variationId:'2',sourceRow:8},{productId:'456',variationId:'3',sourceRow:9}];
  const file={rows,aoa:[['metadata'],header,['petunjuk']]};
  const results=[{productId:'123',variationId:'1',eligible:true,sku:'MP000243',parentSku:'PRD000168',gtin:''},{productId:'123',variationId:'2',eligible:false},{productId:'456',variationId:'3',eligible:true,sku:'PRD000001-001',parentSku:'PRD000001',gtin:'0012345678901'}];
  let plan=context.shopeeExportChanges(file,results);assert.equal(plan.eligible,2);assert.equal(plan.unchanged,1);
  assert.ok(!plan.changes.some(c=>c.row===8));assert.ok(!plan.changes.some(c=>c.row===7&&c.col===4),'parent ditahan bila variasi lain belum disetujui');
  assert.equal(plan.changes.find(c=>c.row===7&&c.col===7).value,'');assert.equal(plan.changes.find(c=>c.row===9&&c.col===7).value,'0012345678901');
  assert.ok(plan.changes.every(c=>[4,5,7].includes(c.col)),'harga/stok/ID/nama tetap');
  results[1]={productId:'123',variationId:'2',eligible:true,sku:'PRD000168-003',parentSku:'PRD000168',gtin:''};
  plan=context.shopeeExportChanges(file,results);assert.equal(plan.changes.filter(c=>c.col===4).length,3);
  results[1].parentSku='PRD000999';plan=context.shopeeExportChanges(file,results);assert.equal(plan.changes.filter(c=>c.col===4).length,1);
});
test('import perubahan harga mempertahankan persetujuan; perubahan identitas mencabut mapping; kode yang diperbarui mengikuti snapshot',()=>{
  let r=list({store:'Meirista',search:'1001'}).rows[0];ok(call(A,'shopee.review',approval(r,single)));
  imp([source({price:17000,sellerSku:single})]);r=list({store:'Meirista',search:'1001'}).rows[0];assert.equal(r.status,'approved');assert.equal(r.skuMatches,true);
  assert.equal(ok(call(A,'mapping.list',{system:'shopee',search:'123456789'})).rows.find(m=>m.externalVariationId==='1001').externalSku,single);
  imp([source({name:'Produk lain 100 ml',sellerSku:single})]);r=list({store:'Meirista',search:'1001'}).rows[0];assert.equal(r.status,'needs_review');
  assert.ok(!ok(call(A,'mapping.list',{system:'shopee'})).rows.some(m=>m.externalProductId==='123456789'&&m.externalVariationId==='1001'));
});
test('snapshot awal aman diulang, tidak menimpa hasil pemeriksaan, tidak memakai SKU dengan nama master berbeda',()=>{
  const t=ok(call(A,'shopee.target',{sku:mp})),u={email:'owner@toko.local'};
  const seed=(pid,name)=>[pid,'12','[3 PCS] Air Mawar','',product.productCode,'old','',10000,3,'multipack',3,mp,name,t.gtin,[{sku:single,quantity:3}],'Audit awal',7];
  const rows=[seed('888888888',t.name),seed('999999999','Nama berbeda')];
  let rep=G.ctx.withLock_(()=>G.ctx.shopeeSeed_(u,rows));assert.equal(rep.created,2);assert.equal(rep.suggested,1);
  assert.equal(list({search:'888888888'}).rows[0].status,'suggested');assert.equal(list({search:'999999999'}).rows[0].targetSku,'');
  rep=G.ctx.withLock_(()=>G.ctx.shopeeSeed_(u,rows));assert.equal(rep.created,0);
  const r=list({search:'888888888'}).rows[0];ok(call(A,'shopee.review',{id:r.id,version:r.version,action:'ignored',note:'Bukan produk yang dipasarkan'}));
  G.ctx.withLock_(()=>G.ctx.shopeeSeed_(u,rows));assert.equal(list({search:'888888888'}).rows[0].status,'ignored');
});
test('parser frontend menerima template Shopee, menjaga ID teks, menolak ID rusak/duplikat/kolom tidak lengkap',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../src/Shopee.html'),'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '');
  const context={Pages:{}};vm.runInNewContext(code,context);
  const header=['Kode Produk','Nama Produk','Kode Variasi','Nama Variasi','SKU Induk','SKU','Harga','GTIN','Stok'];
  const row=['0012345678901234567890','Air Mawar','0000123','100 ml','parent','old',10000,'0012345678901',2];
  const rows=context.shopeeReadRows([['metadata'],header,['','','','','','','Wajib'],row]);
  assert.equal(rows[0].productId,row[0]);assert.equal(rows[0].variationId,row[2]);assert.equal(rows[0].gtin,row[7]);assert.equal(rows[0].sourceRow,4);
  assert.throws(()=>context.shopeeReadRows([header,row,row]),/berulang/);
  assert.throws(()=>context.shopeeReadRows([header,[Number.MAX_SAFE_INTEGER+2,'Name']]),/angka aman/);
  assert.throws(()=>context.shopeeReadRows([['Kode Produk','Nama Produk'],['123','Name']]),/belum lengkap/);
});
test('gagal menulis mapping membatalkan persetujuan listing dan seluruh perubahan mapping',()=>{
  imp([source({productId:'777777777',variationId:'777'})]);
  const r=list({search:'777777777'}).rows[0];
  const before=ok(call(A,'mapping.list',{system:'shopee'})).total;
  G.failWrites('EXTERNAL_SKU_MAPPINGS',0);
  const result=call(A,'shopee.review',approval(r,single));
  G.failWrites('EXTERNAL_SKU_MAPPINGS',null);
  assert.equal(result.error.code,'WRITE_FAILED');
  const after=ok(call(A,'shopee.get',{id:r.id}));assert.equal(after.status,r.status);assert.equal(after.version,r.version);
  assert.equal(ok(call(A,'mapping.list',{system:'shopee'})).total,before);
});
test('tabel baru otomatis memperluas grid Sheets untuk snapshot lebih dari 1.000 listing',()=>{
  const L=createGas();L.ctx.setup();const sh=L.sheets.get('SHOPEE_LISTINGS');
  let capacity=1000;const get=sh.getRange.bind(sh);
  sh.getMaxRows=()=>capacity;
  sh.insertRowsAfter=(last,count)=>{assert.equal(last,capacity);capacity+=count;};
  sh.getRange=(r,c,nr=1,nc=1)=>{assert.ok(r+nr-1<=capacity,'range melewati grid Sheets');return get(r,c,nr,nc);};
  L.ctx.withLock_(()=>L.ctx.db_('SHOPEE_LISTINGS').insertMany(Array.from({length:5007},(_,i)=>({ListingID:'listing-'+i,StoreAccount:'Meirista',ExternalProductId:String(100000+i),ReviewStatus:'unmapped',Version:1}))));
  assert.equal(L.ctx.db_('SHOPEE_LISTINGS').rows().length,5007);assert.ok(capacity>=5008);
});
