const test=require('node:test'),assert=require('node:assert/strict'),{createGas}=require('./harness.cjs');
function fixture(){
 const g=createGas(),c=g.ctx,admin=c.setup().admin,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;},token=ok(c.api(null,'auth.login',{email:admin.email,password:admin.password})).token,call=(a,p={})=>c.api(token,a,p);
 c.withLock_(()=>{c.db_('MASTER_BRANDS').insert({BrandID:'b',BrandName:'Viva',Status:'ACTIVE'});c.db_('MASTER_PRODUCTS').insert({ProductID:'p',BrandID:'b',ProductCode:'PRD000011',ProductName:'Air Mawar',Status:'ACTIVE'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'v',ProductID:'p',SKU:'PRD000011-001',ProductSKUName:'Viva Air Mawar 100 ml',VariantName:'100 ml',GTIN:'8992796011501',Status:'ACTIVE'});c.db_('BUNDLE_MASTERS').insert({BundleID:'mp',BundleSKU:'MP000033',BundleType:'MULTIPACK',BundleName:'Paket 10 PCS Viva Air Mawar 100 ml',Status:'ACTIVE'});c.db_('BUNDLE_COMPONENTS').insert({ComponentID:'mc',BundleID:'mp',VariantID:'v',Quantity:10,Status:'ACTIVE'});});
 const source=(id,qty,size=100)=>({productId:String(id),variationId:String(id+100),name:qty+' PCS Air mawar label lama '+size+' ml',variationName:'',parentSku:'VIV-AIR-8992796011501-'+qty,sellerSku:'VIV-AIR-8992796011501-'+qty,gtin:''});
 const rows=[source(1001,1),source(1002,10),source(1003,3),source(1004,1,200),{...source(1005,3),parentSku:'old-8992796011501-10',sellerSku:'old-8992796011501-10'},source(1006,1),source(1007,1)];
 const b=ok(call('shopee.batchCreate',{store:'Toko',fileName:'source.xlsx',base64:Buffer.from('PK-test').toString('base64'),rows})),imported=ok(call('shopee.import',{batchId:b.id,offset:0})).rows,t=ok(call('shopee.target',{sku:'PRD000011-001'}));
 ok(call('shopee.review',{id:imported[5].id,version:1,action:'needs_review',draft:{saleType:'single',components:[],targetSku:''}}));ok(call('shopee.review',{id:imported[6].id,version:1,action:'approve',sku:t.sku,targetSignature:t.signature,saleType:'single',quantity:1,components:t.components}));
 return {g,c,call,ok,b,imported};
}
test('analisis menyiapkan satuan, MP yang ada dan MP baru untuk diperiksa tanpa menyetujui/membuat paket',()=>{
 const {c,call,ok,b,imported}=fixture(),plan=ok(call('shopee.rematchPlan',{batchId:b.id}));assert.equal(plan.items.length,3);assert.equal(plan.items[2].needsPackage,true);assert.equal(plan.items[1].sku,'MP000033');assert.ok(plan.items.every(i=>i.score<=95));
 const before=c.db_('BUNDLE_MASTERS').rows().length,result=ok(call('shopee.rematchApply',{batchId:b.id,items:plan.items,requestKey:'proposal'}));assert.equal(result.saved.length,3);assert.equal(c.db_('BUNDLE_MASTERS').rows().length,before);
 assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[0].id).ReviewStatus,'suggested');const missing=ok(call('shopee.get',{id:imported[2].id}));assert.equal(missing.reviewRequested,true);assert.equal(missing.targetSku,'');assert.equal(missing.expectedComponents[0].quantity,3);
 assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[6].id).ReviewStatus,'approved');assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[5].id).ReviewStatus,'needs_review');assert.equal(c.db_('EXTERNAL_SKU_MAPPINGS').rows().length,1);
 assert.equal(call('shopee.rematchApply',{batchId:b.id,items:plan.items,requestKey:'proposal'}).replayed,true);assert.equal(ok(call('shopee.rematchPlan',{batchId:b.id})).items.length,0);
});
test('versi/master berubah ditolak; barcode ganda dan GTIN kosong tidak ditebak',()=>{
 const {c,call,ok,b,imported}=fixture(),plan=ok(call('shopee.rematchPlan',{batchId:b.id}));c.withLock_(()=>c.db_('SHOPEE_LISTINGS').update(c.db_('SHOPEE_LISTINGS').byId(imported[0].id),{Version:2}));assert.equal(ok(call('shopee.rematchApply',{batchId:b.id,items:plan.items.slice(0,1)})).saved.length,0);
 c.withLock_(()=>c.db_('PRODUCT_VARIANTS').insert({VariantID:'other',ProductID:'p',SKU:'PRD000011-002',ProductSKUName:'Viva Air Mawar 100 ml',GTIN:'8992796011501',Status:'ACTIVE'}));assert.equal(ok(call('shopee.rematchPlan',{batchId:b.id})).items.length,0);
 assert.equal(call('shopee.rematchApply',{items:Array.from({length:31},(_,i)=>({id:String(i)}))}).ok,false);
});
