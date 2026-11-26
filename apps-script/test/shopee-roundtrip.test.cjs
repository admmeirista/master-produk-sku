const test=require('node:test'),assert=require('node:assert/strict'),{createGas}=require('./harness.cjs');
function fixture(){
 const g=createGas(),c=g.ctx,admin=c.setup().admin,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;},token=ok(c.api(null,'auth.login',{email:admin.email,password:admin.password})).token,call=(a,p={})=>ok(c.api(token,a,p));
 c.withLock_(()=>{
 c.db_('MASTER_BRANDS').insert({BrandID:'b',BrandName:'Purbasari',Status:'ACTIVE'});
 c.db_('MASTER_PRODUCTS').insert({ProductID:'p',BrandID:'b',ProductCode:'PRD000003',ProductName:'Gluta Hya Body Serum',Status:'ACTIVE'});
 c.db_('PRODUCT_VARIANTS').insert({VariantID:'v',ProductID:'p',SKU:'PRD000003-001',ProductSKUName:'Purbasari Gluta Hya Body Serum 180 ml',VariantName:'180 ml',GTIN:'8999225912415',Status:'ACTIVE'});
 c.db_('BUNDLE_MASTERS').insert({BundleID:'mp',BundleSKU:'MP000003',BundleType:'MULTIPACK',BundleName:'Paket 12 PCS Purbasari Gluta Hya Body Serum 180 ml',Status:'ACTIVE'});
 c.db_('BUNDLE_COMPONENTS').insert({ComponentID:'mc',BundleID:'mp',VariantID:'v',Quantity:12,Status:'ACTIVE'});
 });
 const source={productId:'123456',variationId:'999',name:'12 PCS Purbasari Gluta Hya Body Serum 180 ml',variationName:'',parentSku:'MP000003',sellerSku:'',gtin:''};
 function imp(row){const b=call('shopee.batchCreate',{store:'Toko',fileName:'template.xlsx',base64:Buffer.from('PK-source').toString('base64'),rows:[row]});return {batch:b,row:call('shopee.import',{batchId:b.id,offset:0}).rows[0]};}
 let {row}=imp(source);const t=call('shopee.target',{sku:'MP000003'});
 row=call('shopee.review',{id:row.id,version:row.version,action:'approve',sku:t.sku,targetSignature:t.signature,saleType:t.kind,quantity:12,components:t.components});
 return {g,c,call,source,imp,row,t};
}
test('reimport hasil ekspor yang berganti judul mempertahankan persetujuan MP dan hasil ekspor',()=>{
 const {c,call,source,imp}=fixture(),r=imp({...source,name:'[12 PCS] Purbasari Gluta Hya Body Serum 180 ml Serum Badan Perawatan Kulit Tubuh'}).row;
 assert.equal(r.status,'approved');assert.equal(r.targetSku,'MP000003');assert.equal(c.db_('EXTERNAL_SKU_MAPPINGS').rows().filter(m=>m.IsActive).length,1);
 const fresh=call('shopee.get',{id:r.id}),p=c.ShopeePlacement.preview(fresh.listingShape,fresh.target);assert.equal(p.parentSku,'MP000003');assert.equal(p.sku,'');
});
test('riwayat persetujuan mengalahkan skor judul dan alias variasi; daftar bahan/SPF tidak menjadi bundling',()=>{
 const {c,call,imp,source,t}=fixture(),variant={...source,variationName:'01 Cream Beige',parentSku:'PRD000003',sellerSku:t.sku};
 let first=imp(variant).row;call('shopee.review',{id:first.id,version:first.version,action:'approve',sku:t.sku,targetSignature:t.signature,saleType:t.kind,quantity:12,components:t.components});
 const renamed={...variant,name:'12 PCS Body Serum Tone Up SPF 20++ | Niacinamide + Ceramide + Hyaluronic Acid'},result=imp(renamed);
 assert.equal(result.row.status,'approved');
 const view=call('shopee.workspace',{batchId:result.batch.id}).rows[0];assert.equal(view.match.method,'approval_history');assert.equal(view.match.score,99);
 c.withLock_(()=>c.db_('SHOPEE_LISTINGS').update(c.db_('SHOPEE_LISTINGS').byId(first.id),{ReviewStatus:'needs_review',ReviewNote:'Data Shopee berubah sejak pemeriksaan sebelumnya; periksa ulang nama, variasi, dan komposisi.',ReviewedAt:'',ReviewedTargetSignature:''}));
 const plan=call('shopee.strongPlan',{batchId:result.batch.id,roundtripOnly:true});assert.equal(plan.items.length,1);assert.equal(plan.items[0].reason.includes('Riwayat persetujuan'),true);
 assert.equal(call('shopee.approveStrong',{batchId:result.batch.id,roundtripOnly:true,items:plan.items}).approved.length,1);
});
test('perubahan master setelah persetujuan tetap ditahan meskipun kode Shopee sama',()=>{
 const {c,call,source,imp,row}=fixture();c.withLock_(()=>{
 const variant=c.db_('PRODUCT_VARIANTS').find(v=>v.SKU==='PRD000003-001');c.db_('PRODUCT_VARIANTS').update(variant,{GTIN:'8999225911258'});
 });
 const b=imp({...source,name:source.name+' SPF 20++ Niacinamide + Ceramide'}).batch;
 assert.equal(call('shopee.strongPlan',{batchId:b.id,roundtripOnly:true}).items.length,0);
 assert.notEqual(call('shopee.get',{id:row.id}).status,'approved');
});
test('GTIN kosong pada template tidak mereset persetujuan satuan yang SKU-nya tetap sama',()=>{
 const {call,imp,source}=fixture(),t=call('shopee.target',{sku:'PRD000003-001'}),single={...source,name:'Purbasari Gluta Hya Body Serum 180 ml',parentSku:t.sku,gtin:''};
 let r=imp(single).row;call('shopee.review',{id:r.id,version:r.version,action:'approve',sku:t.sku,targetSignature:t.signature,saleType:t.kind,quantity:1,components:t.components});
 r=imp({...single,name:single.name+' SPF 20++ Niacinamide + Ceramide'}).row;assert.equal(r.status,'approved');assert.equal(r.target.gtin,'8999225912415');
});
test('kode sama tidak meloloskan jumlah, ukuran atau GTIN yang bertentangan',()=>{
 for(const change of [{name:'6 PCS Purbasari Gluta Hya Body Serum 180 ml'},{name:'12 PCS Purbasari Gluta Hya Body Serum 200 ml'},{gtin:'8999225912415'}]){
 const {imp,source}=fixture(),r=imp({...source,...change}).row;assert.equal(r.status,'needs_review');
 }
});
test('pemulihan hanya persetujuan importer yang terbukti; manual dan master berubah tetap ditahan',()=>{
 const {c,call,source,imp,row,t}=fixture(),changed={...source,name:source.name+' Perawatan Kulit'};
 c.withLock_(()=>c.db_('SHOPEE_LISTINGS').update(c.db_('SHOPEE_LISTINGS').byId(row.id),{ReviewStatus:'needs_review',ReviewNote:'Data Shopee berubah sejak pemeriksaan sebelumnya; periksa ulang nama, variasi, dan komposisi.',ReviewedAt:'',ReviewedTargetSignature:''}));
 const b=imp(changed).batch,plan=call('shopee.strongPlan',{batchId:b.id,roundtripOnly:true});assert.equal(plan.items.length,1);
 const saved=call('shopee.approveStrong',{batchId:b.id,roundtripOnly:true,items:plan.items});assert.equal(saved.approved.length,1);
 let r=call('shopee.get',{id:row.id});call('shopee.review',{id:r.id,version:r.version,action:'needs_review',draft:{saleType:t.kind,targetSku:t.sku,targetSignature:t.signature,components:t.components}});
 assert.equal(call('shopee.strongPlan',{batchId:b.id,roundtripOnly:true}).items.length,0);
});
