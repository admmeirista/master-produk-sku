const test=require('node:test'),assert=require('node:assert/strict');
const {createGas}=require('./harness.cjs');
const G=createGas();
const api=(action,p={})=>JSON.parse(JSON.stringify(G.ctx.api(token,action,p)));
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;};
let token,product,skus,mp,bd,serial=700000000;
const resolve=(saleType,components)=>ok(api('shopee.packageResolve',{saleType,components}));
const listing=()=>ok(api('shopee.import',{store:'Test',rows:[{productId:String(++serial),variationId:'1',name:'Listing paket Shopee',price:10000,stock:2}]})).rows[0];
const approve=(r,preview,create=false)=>api('shopee.review',{id:r.id,version:r.version,action:'approve',note:'',selection:{saleType:preview.saleType,components:preview.components,signature:preview.signature},sku:preview.target&&preview.target.sku,targetSignature:preview.target&&preview.target.signature,createPackage:create});
const count=()=>G.ctx.db_('BUNDLE_MASTERS').rows().length;

test('persiapan: master barang, MP dan BD yang sudah tersedia',()=>{
 const a=G.ctx.setup().admin;token=ok(JSON.parse(JSON.stringify(G.ctx.api(null,'auth.login',{email:a.email,password:a.password})))).token;
 const b=ok(api('brand.create',{name:'Uji'})),c=ok(api('category.list')).find(c=>c.name==='Toner');
 product=ok(api('product.save',{input:{brandId:b.id,categoryId:c.id,name:'Toner',baseUnit:'PCS',hasVariants:true,variants:['100 ml','200 ml','300 ml'].map(value=>({attributes:[{name:'Volume',value}],barcode:{mode:'none'}}))}}));
 skus=product.variants.map(v=>v.sku);
 mp=ok(api('bundle.save',{name:'Paket Toner 3',type:'MULTIPACK',components:[{variantId:product.variants[0].id,quantity:3}]}));
 bd=ok(api('bundle.save',{name:'Kombinasi Toner',type:'MIXED',components:[{variantId:product.variants[0].id,quantity:1},{variantId:product.variants[1].id,quantity:2}]}));
});
test('MP yang sama dipakai ulang; satuan langsung memakai Child SKU',()=>{
 const before=count(),p=resolve('multipack',[{sku:skus[0],quantity:3}]);assert.equal(p.target.sku,mp.sku);
 const saved=ok(approve(listing(),p));assert.equal(saved.targetSku,mp.sku);assert.equal(saved.packageCreated,false);assert.equal(count(),before);
 const single=resolve('single',[{sku:skus[0],quantity:1}]);assert.equal(ok(approve(listing(),single)).targetSku,skus[0]);assert.equal(count(),before);
});
test('BD sama ditemukan tanpa tergantung urutan baris; komposisi berbeda tidak boleh cocok',()=>{
 const a=resolve('bundle',[{sku:skus[0],quantity:1},{sku:skus[1],quantity:2}]),b=resolve('bundle',[{sku:skus[1],quantity:2},{sku:skus[0],quantity:1}]);
 assert.equal(a.target.sku,bd.sku);assert.equal(b.target.sku,bd.sku);assert.equal(a.signature,b.signature);
 assert.equal(resolve('bundle',[{sku:skus[0],quantity:2},{sku:skus[1],quantity:1}]).target,null);
});
test('buat MP dan setujui atomik: tampil di Kemasan & Bundling, BOM dan mapping benar; permintaan bersaing memakai MP sama',()=>{
 const preview=resolve('multipack',[{sku:skus[0],quantity:7}]);assert.equal(preview.target,null);const before=count();
 const r=listing();assert.equal(approve(r,preview,false).ok,false);assert.equal(count(),before);
 const saved=ok(approve(r,preview,true));assert.equal(saved.packageCreated,true);assert.match(saved.targetSku,/^MP\d{6}$/);assert.equal(saved.target.components[0].quantity,7);
 const bundle=ok(api('bundle.list',{search:saved.targetSku})).rows[0];assert.equal(bundle.type,'MULTIPACK');assert.equal(bundle.stockMode,'VIRTUAL');assert.equal(bundle.components[0].sku,skus[0]);
 const second=ok(approve(listing(),preview,true));assert.equal(second.targetSku,saved.targetSku);assert.equal(second.packageCreated,false);assert.equal(count(),before+1);
 assert.equal(ok(api('mapping.list',{system:'shopee',search:r.productId})).rows[0].internalSku,saved.targetSku);
});
test('buat BD dari beberapa SKU + qty lalu gunakan ulang, tanpa menyalin GTIN komponen',()=>{
 const preview=resolve('bundle',[{sku:skus[0],quantity:2},{sku:skus[2],quantity:4}]);const before=count();
 const saved=ok(approve(listing(),preview,true));assert.match(saved.targetSku,/^BD\d{6}$/);assert.equal(saved.target.gtin,'');assert.equal(saved.quantity,6);assert.equal(saved.target.components.length,2);
 const reversed=resolve('bundle',[{sku:skus[2],quantity:4},{sku:skus[0],quantity:2}]);assert.equal(reversed.target.sku,saved.targetSku);assert.equal(ok(approve(listing(),reversed)).targetSku,saved.targetSku);assert.equal(count(),before+1);
});
test('validasi input menolak tipe/jumlah salah, duplikat, paket bersarang dan barang tidak aktif',()=>{
 for(const [type,components] of [['single',[{sku:skus[0],quantity:2}]],['multipack',[{sku:skus[0],quantity:1}]],['bundle',[{sku:skus[0],quantity:2}]],['bundle',[{sku:skus[0],quantity:1},{sku:skus[0],quantity:2}]],['multipack',[{sku:mp.sku,quantity:3}]],['multipack',[{sku:skus[0],quantity:1001}]]])assert.equal(api('shopee.packageResolve',{saleType:type,components}).ok,false);
 G.ctx.withLock_(()=>G.ctx.db_('PRODUCT_VARIANTS').update(G.ctx.db_('PRODUCT_VARIANTS').byId(product.variants[2].id),{Status:'INACTIVE'}));
 assert.equal(api('shopee.packageResolve',{saleType:'multipack',components:[{sku:skus[2],quantity:2}]}).ok,false);
 G.ctx.withLock_(()=>G.ctx.db_('PRODUCT_VARIANTS').update(G.ctx.db_('PRODUCT_VARIANTS').byId(product.variants[2].id),{Status:'ACTIVE'}));
});
test('paket nonaktif dengan isi sama tidak digandakan',()=>{
 G.ctx.withLock_(()=>G.ctx.db_('BUNDLE_MASTERS').update(G.ctx.db_('BUNDLE_MASTERS').byId(mp.id),{Status:'INACTIVE'}));
 const p=resolve('multipack',[{sku:skus[0],quantity:3}]);assert.ok(p.blocked.includes(mp.sku));const before=count();assert.equal(approve(listing(),p,true).ok,false);assert.equal(count(),before);
 G.ctx.withLock_(()=>G.ctx.db_('BUNDLE_MASTERS').update(G.ctx.db_('BUNDLE_MASTERS').byId(mp.id),{Status:'ACTIVE'}));
});
test('perubahan barang sejak preview dan izin membuat paket diperiksa sebelum menulis',()=>{
 let p=resolve('multipack',[{sku:skus[1],quantity:9}]),r=listing();const before=count();
 G.ctx.withLock_(()=>G.ctx.db_('PRODUCT_VARIANTS').update(G.ctx.db_('PRODUCT_VARIANTS').byId(product.variants[1].id),{GTIN:'8991234567890'}));
 assert.equal(approve(r,p,true).error.code,'CONFLICT');assert.equal(count(),before);
 p=resolve('multipack',[{sku:skus[1],quantity:9}]);const original=G.ctx.assertPerm_;G.ctx.assertPerm_=(user,perm)=>{if(perm==='product.write')return original({role:'viewer'},perm);return original(user,perm);};
 try{assert.equal(approve(r,p,true).error.code,'FORBIDDEN');assert.equal(count(),before);}finally{G.ctx.assertPerm_=original;}
});
test('gagal simpan mapping membatalkan paket baru, BOM, counter dan persetujuan sekaligus',()=>{
 const p=resolve('multipack',[{sku:skus[2],quantity:11}]),r=listing(),before=count(),comps=G.ctx.db_('BUNDLE_COMPONENTS').rows().length,counters=JSON.stringify(G.ctx.db_('SYSTEM_COUNTERS').rows());
 G.failWrites('EXTERNAL_SKU_MAPPINGS',0);const failed=approve(r,p,true);G.failWrites('EXTERNAL_SKU_MAPPINGS',null);
 assert.equal(failed.error.code,'WRITE_FAILED');assert.equal(count(),before);assert.equal(G.ctx.db_('BUNDLE_COMPONENTS').rows().length,comps);assert.equal(JSON.stringify(G.ctx.db_('SYSTEM_COUNTERS').rows()),counters);
 assert.notEqual(ok(api('shopee.get',{id:r.id})).status,'approved');
 const saved=ok(approve(r,p,true));assert.equal(saved.packageCreated,true);assert.equal(count(),before+1);
});
