const test=require('node:test'),assert=require('node:assert/strict'),{createGas}=require('./harness.cjs');
function fixture(){
 const {ctx:c}=createGas(),admin=c.setup().admin,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;},token=ok(c.api(null,'auth.login',{email:admin.email,password:admin.password})).token,call=(a,p={})=>c.api(token,a,p);
 c.withLock_(()=>{
  c.db_('MASTER_BRANDS').insert({BrandID:'v',BrandName:'Viva',Status:'ACTIVE'});c.db_('MASTER_PRODUCTS').insert({ProductID:'p',BrandID:'v',ProductCode:'PRD000011',ProductName:'Viva Air Mawar',Status:'ACTIVE'});
  c.db_('PRODUCT_VARIANTS').insert({VariantID:'v1',ProductID:'p',SKU:'PRD000011-001',ProductSKUName:'Viva Air Mawar 100 ml',VariantName:'100 ml',GTIN:'8992796011501',Status:'ACTIVE'});
  c.db_('BUNDLE_MASTERS').insert({BundleID:'b',BundleSKU:'MP000033',BundleType:'MULTIPACK',BundleName:'Paket 10 PCS Viva Air Mawar 100 ml',Status:'ACTIVE'});c.db_('BUNDLE_COMPONENTS').insert({ComponentID:'bc',BundleID:'b',VariantID:'v1',Quantity:10,Status:'ACTIVE'});
 });
 const row=(id,name)=>({productId:String(id),variationId:String(id+100),name,variationName:'',parentSku:'old-8992796011501-10',sellerSku:'old-8992796011501-10',gtin:'8992796011501',price:100,stock:2});
 const good='10 PCS Viva Air Mawar 100 ml Paket Usaha',rows=[row(1001,good),row(1002,'5 PCS Viva Air Mawar 100 ml Paket Usaha'),row(1003,'10 PCS Viva Air Mawar 200 ml Paket Usaha'),row(1004,good+' Boleh Campur'),row(1005,good),row(1006,good),{...row(1007,good),sellerSku:'old-8992796019999-10'}];
 const batch=ok(call('shopee.batchCreate',{store:'Toko',fileName:'source.xlsx',base64:Buffer.from('PK-original').toString('base64'),rows}));
 const imported=ok(call('shopee.import',{batchId:batch.id,offset:0})).rows,target=ok(call('shopee.target',{sku:'MP000033'}));
 ok(call('shopee.review',{id:imported[4].id,version:1,action:'needs_review',draft:{saleType:'multipack',components:[{sku:'PRD000011-001',quantity:10}],targetSku:target.sku,targetSignature:target.signature}}));
 ok(call('shopee.review',{id:imported[5].id,version:1,action:'ignored',note:'Periksa terpisah'}));
 return {c,call,ok,batch,imported,target,rows};
}
test('rencana hanya kandidat kuat; tidak membuat paket atau mengubah draf, abaikan, barcode konflik',()=>{
 const {c,call,ok,batch,imported}=fixture(),before=c.db_('BUNDLE_MASTERS').rows().length,plan=ok(call('shopee.strongPlan',{batchId:batch.id}));
 assert.equal(plan.items.length,1);assert.equal(plan.items[0].id,imported[0].id);assert.equal(plan.items[0].sku,'MP000033');assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[0].id).ReviewStatus,'unmapped');
 const result=ok(call('shopee.approveStrong',{batchId:batch.id,items:plan.items,requestKey:'strong1'}));assert.equal(result.approved.length,1);assert.equal(result.skipped.length,0);assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[0].id).ReviewStatus,'approved');assert.equal(c.db_('BUNDLE_MASTERS').rows().length,before);
 assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[4].id).ReviewStatus,'needs_review');assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[5].id).ReviewStatus,'ignored');assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[6].id).ReviewStatus,'unmapped');
 const version=c.db_('SHOPEE_LISTINGS').byId(imported[0].id).Version,replay=call('shopee.approveStrong',{batchId:batch.id,items:plan.items,requestKey:'strong1'});assert.equal(replay.replayed,true);assert.equal(c.db_('SHOPEE_LISTINGS').byId(imported[0].id).Version,version);
 assert.equal(ok(call('shopee.strongPlan',{batchId:batch.id})).items.length,0);
});
test('perubahan versi/master antara rencana dan simpan tidak disetujui; skor client tidak dipercaya',()=>{
 const {c,call,ok,batch,imported}=fixture(),plan=ok(call('shopee.strongPlan',{batchId:batch.id}));
 c.withLock_(()=>c.db_('SHOPEE_LISTINGS').update(c.db_('SHOPEE_LISTINGS').byId(imported[0].id),{Version:2}));
 const result=ok(call('shopee.approveStrong',{batchId:batch.id,items:plan.items}));assert.equal(result.approved.length,0);assert.equal(result.skipped.length,1);
 const forged={...plan.items[0],id:imported[2].id,version:1,score:100};assert.equal(ok(call('shopee.approveStrong',{items:[forged],threshold:0})).approved.length,0);
 assert.equal(call('shopee.approveStrong',{items:Array.from({length:21},(_,i)=>({...forged,id:String(i)}))}).ok,false);
});
test('variasi satu listing dengan parent berbeda tetap manual dan akun tanpa izin tidak dapat menyetujui',()=>{
 const {c,call,ok}=fixture();
 c.withLock_(()=>{c.db_('MASTER_PRODUCTS').insert({ProductID:'p2',BrandID:'v',ProductCode:'PRD000012',ProductName:'Viva Milk Cleanser',Status:'ACTIVE'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'v2',ProductID:'p2',SKU:'PRD000012-001',ProductSKUName:'Viva Milk Cleanser 100 ml',VariantName:'100 ml',GTIN:'8992796011136',Status:'ACTIVE'});c.db_('BUNDLE_MASTERS').insert({BundleID:'b2',BundleSKU:'MP000034',BundleType:'MULTIPACK',BundleName:'Paket 10 PCS Viva Milk Cleanser 100 ml',Status:'ACTIVE'});c.db_('BUNDLE_COMPONENTS').insert({ComponentID:'bc2',BundleID:'b2',VariantID:'v2',Quantity:10,Status:'ACTIVE'});});
 const rows=[{productId:'2001',variationId:'201',name:'10 PCS Viva Air Mawar 100 ml / Viva Milk Cleanser 100 ml Paket Usaha',variationName:'Air Mawar',gtin:'8992796011501'},{productId:'2001',variationId:'202',name:'10 PCS Viva Air Mawar 100 ml / Viva Milk Cleanser 100 ml Paket Usaha',variationName:'Milk Cleanser',gtin:'8992796011136'}],batch=ok(call('shopee.batchCreate',{store:'Toko',fileName:'variants.xlsx',base64:Buffer.from('PK-variants').toString('base64'),rows}));ok(call('shopee.import',{batchId:batch.id,offset:0}));assert.equal(ok(call('shopee.strongPlan',{batchId:batch.id})).items.length,0);
 ok(call('user.create',{email:'photo@strong.test',fullName:'Foto',role:'photo_staff',password:'Password#2026'}));const token=ok(c.api(null,'auth.login',{email:'photo@strong.test',password:'Password#2026'})).token;
 assert.equal(c.api(token,'shopee.strongPlan',{}).error.code,'FORBIDDEN');assert.equal(c.api(token,'shopee.approveStrong',{items:[]}).error.code,'FORBIDDEN');
});

test('mode GTIN hanya menyetujui satuan GTIN unik dari master terbaru, menyimpan mapping dan siap ekspor',()=>{
 const {c,call,ok}=fixture();const rows=[{productId:'3001',name:'Air mawar label lama SPF 50 PA++++ Niacinamide + Ceramide',gtin:'8992796011501'},{productId:'3002',name:'Viva Air Mawar 100 ml',gtin:''},{productId:'3003',name:'Viva Air Mawar 200 ml',gtin:'8992796011501'}];
 const batch=ok(call('shopee.batchCreate',{store:'Toko',fileName:'gtin.xlsx',base64:Buffer.from('PK-gtin').toString('base64'),rows:rows.map(r=>({...r,variationName:''}))}));const imported=ok(call('shopee.import',{batchId:batch.id,offset:0})).rows;
 const plan=ok(call('shopee.strongPlan',{batchId:batch.id,gtinOnly:true}));assert.equal(plan.items.length,1);assert.equal(plan.items[0].id,imported[0].id);assert.equal(plan.items[0].sku,'PRD000011-001');
 const saved=ok(call('shopee.approveStrong',{batchId:batch.id,gtinOnly:true,items:plan.items,requestKey:'gtin-batch'}));assert.equal(saved.approved.length,1);const row=c.db_('SHOPEE_LISTINGS').byId(imported[0].id);assert.equal(row.ReviewStatus,'approved');assert.equal(row.SaleType,'single');assert.equal(row.TargetSku,'PRD000011-001');assert.match(row.ReviewNote,/GTIN Shopee sama persis/);
 assert.equal(c.db_('EXTERNAL_SKU_MAPPINGS').rows().filter(x=>x.IsActive&&x.InternalSku==='PRD000011-001').length,1);
 assert.equal(ok(call('shopee.strongPlan',{batchId:batch.id,gtinOnly:true})).items.length,0);
});
