const test=require('node:test'),assert=require('node:assert/strict'),{createGas}=require('./harness.cjs');
function fixture(){const G=createGas(),c=G.ctx,a=c.setup().admin,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data;},T=ok(c.api(null,'auth.login',{email:a.email,password:a.password})).token,call=(action,p={})=>c.api(T,action,p);
 c.withLock_(()=>{c.db_('MASTER_PRODUCTS').insert({ProductID:'p',ProductCode:'PRD000001',ProductName:'Barang',Status:'ACTIVE'});for(let i=1;i<=40;i++)c.db_('PRODUCT_VARIANTS').insert({VariantID:'v'+i,ProductID:'p',SKU:'PRD000001-'+String(i).padStart(3,'0'),ProductSKUName:'Barang '+i,Status:'ACTIVE'});});
 const rows=ok(call('shopee.import',{store:'Uji',rows:[{productId:'1234567',variationId:'1',name:'Belum dipetakan',price:1,stock:1},{productId:'1234567',variationId:'2',name:'Belum dipetakan 2',price:1,stock:1}]})).rows;return {G,c,ok,call,rows};}
test('Simpan untuk diverifikasi menyimpan SKU/qty tanpa catatan atau target paket, lalu tampil oranye dan tetap tidak dapat diekspor',()=>{
 const {c,ok,call,rows}=fixture();const r=rows[0];
 const saved=ok(call('shopee.review',{id:r.id,version:r.version,action:'needs_review',note:'',draft:{saleType:'bundle',components:[{sku:'PRD000001-001',quantity:1},{sku:'PRD000001-002',quantity:2}]}}));
 assert.equal(saved.reviewRequested,true);assert.equal(saved.status,'needs_review');assert.equal(saved.quantity,3);assert.equal(saved.target,null);assert.equal(saved.expectedComponents.length,2);
 const reopened=ok(call('shopee.get',{id:r.id}));assert.equal(reopened.expectedComponents[1].quantity,2);
 const data=ok(call('shopee.workspace',{}));assert.equal(data.summary.verify,1);assert.equal(data.summary.unavailable,1,'listing lain yang belum ditinjau tetap Tidak tersedia');
 assert.equal(ok(call('shopee.list',{status:'verify'})).rows[0].id,r.id);assert.equal(call('shopee.exportPrepare',{ids:[r.id]}).ok,false);assert.equal(c.db_('BUNDLE_MASTERS').rows().length,0,'draft tidak membuat paket diam-diam');
});
test('draft parsial tetap tersimpan; komponen tidak valid dan konflik versi ditolak tanpa mengubah data',()=>{
 const {ok,call,rows}=fixture(),r=rows[0];
 const p={id:r.id,version:r.version,action:'needs_review',draft:{saleType:'bundle',components:[{sku:'PRD000001-001',quantity:1}]}};
 const saved=ok(call('shopee.review',p));assert.equal(saved.expectedComponents.length,1);assert.equal(saved.reviewRequested,true);assert.equal(call('shopee.review',p).error.code,'CONFLICT');
 assert.equal(call('shopee.review',{...p,version:saved.version,draft:{saleType:'bundle',components:[{sku:'PRD000001-001',quantity:0}]}}).ok,false);assert.equal(ok(call('shopee.get',{id:r.id})).version,saved.version);
});
test('draft dengan target yang cocok disimpan tanpa menyetujui; resolusi paket tidak menghitung seluruh katalog',()=>{
 const {c,ok,call,rows}=fixture();c.withLock_(()=>{c.db_('BUNDLE_MASTERS').insert({BundleID:'b',BundleSKU:'MP000001',BundleName:'Paket',BundleType:'MULTIPACK',Status:'ACTIVE'});c.db_('BUNDLE_COMPONENTS').insert({ComponentID:'bc',BundleID:'b',VariantID:'v1',Quantity:3,Status:'ACTIVE'});});c.resetDbCache_();
 let hashes=0;const hash=c.shopeeSignature_;c.shopeeSignature_=v=>{hashes++;return hash(v);};const resolved=c.shopeePackageResolve_({saleType:'multipack',components:[{sku:'PRD000001-001',quantity:3}]});assert.equal(resolved.target.sku,'MP000001');assert.ok(hashes<=5,'hanya signature komponen, pilihan dan target paket yang dihitung');
 const saved=ok(call('shopee.review',{id:rows[0].id,version:1,action:'needs_review',draft:{saleType:'multipack',components:[{sku:'PRD000001-001',quantity:3}],targetSku:resolved.target.sku,targetSignature:resolved.target.signature}}));assert.equal(saved.targetSku,'MP000001');assert.equal(saved.status,'needs_review');assert.equal(saved.reviewRequested,true);
});
