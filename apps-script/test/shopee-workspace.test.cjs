const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createGas}=require('./harness.cjs');
function fixture(){const G=createGas(),a=G.ctx.setup().admin,c=G.ctx,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data;},token=ok(c.api(null,'auth.login',{email:a.email,password:a.password})).token,call=(act,p={})=>c.api(token,act,p);return {G,c,a,ok,call};}
test('snapshot server dipakai ulang antar filter tanpa menghitung katalog lagi, lalu invalid setelah penulisan',()=>{
 const {c,ok,call}=fixture();ok(call('shopee.import',{store:'Toko',rows:[{productId:'1234567',variationId:'1',name:'Produk A',price:1,stock:2}]}));
 assert.equal(ok(call('shopee.workspace',{})).rows.length,1);const original=c.shopeeCatalog_;c.shopeeCatalog_=()=>{throw Error('Tidak perlu membangun katalog baru');};assert.equal(ok(call('shopee.workspace',{})).rows.length,1);c.shopeeCatalog_=original;
 ok(call('shopee.import',{store:'Toko',rows:[{productId:'1234568',variationId:'2',name:'Produk B',price:1,stock:2}]}));assert.equal(ok(call('shopee.workspace',{})).rows.length,2);
});
test('pencarian, status dan pagination berjalan lokal; perubahan review memperbarui jumlah tanpa RPC',()=>{
 const c={};vm.runInNewContext(fs.readFileSync('apps-script/src/ShopeeWorkspace.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);
 const rows=Array.from({length:1304},(_,i)=>({id:String(i),name:'Produk '+i,status:i%2?'approved':'needs_review',target:{active:true,sku:'SKU'+i}})),data={rows,summary:{all:1304,verify:652,approved:652,unavailable:0}};
 let d=c.ShopeeWorkspace.page(data,{page:2,pageSize:30,status:'approved'});assert.equal(d.rows.length,30);assert.equal(d.rows[0].id,'61');
 d=c.ShopeeWorkspace.page(data,{page:1,pageSize:30,search:'SKU1001'});assert.equal(d.rows.length,1);assert.equal(d.rows[0].id,'1001');
 c.ShopeeWorkspace.update(data,{...rows[0],status:'approved'});assert.equal(data.summary.approved,653);assert.equal(data.summary.verify,651);
});
test('arsip template awal tidak mengimpor ulang listing dan ekspor menemukan template tanpa batch aktif',()=>{
 const {c,a,ok,call}=fixture();
 c.withLock_(()=>{c.db_('MASTER_PRODUCTS').insert({ProductID:'p',ProductCode:'PRD000001',ProductName:'Produk',Status:'ACTIVE'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'v',ProductID:'p',SKU:'PRD000001-001',ProductSKUName:'Produk',Status:'ACTIVE'});});
 const source={productId:'1234567',variationId:'1',name:'Produk',variationName:'',sellerSku:'lama',parentSku:'',gtin:'',price:100,stock:2,sourceRow:7};
 const row=ok(call('shopee.import',{store:'Toko',rows:[source]})).rows[0],target=ok(call('shopee.target',{sku:'PRD000001-001'}));
 const approved=ok(call('shopee.review',{id:row.id,version:row.version,action:'approve',sku:target.sku,targetSignature:target.signature,saleType:'single',quantity:1,components:[{sku:target.sku,quantity:1}]}));
 const before=approved.version,base64=Buffer.from('PK-template-asli').toString('base64');c.withLock_(()=>c.shopeeOriginalTemplateSeed_({email:a.email},{store:'Toko',fileName:'1.xlsx',base64,rows:[source]}));
 const prepared=ok(call('shopee.exportPrepare',{ids:[row.id]}));assert.equal(prepared.rows.length,1);assert.equal(prepared.template.base64,base64);assert.equal(prepared.rows[0].version,before,'arsip tidak mengubah versi/persetujuan');
 assert.equal(ok(call('shopee.exportPrepare',{ids:[row.id],loadedTemplateId:prepared.template.id})).template.base64,undefined,'template yang sudah dimuat tidak dikirim ulang');
 c.withLock_(()=>c.db_('PRODUCT_VARIANTS').update(c.db_('PRODUCT_VARIANTS').byId('v'),{Status:'INACTIVE'}));assert.equal(call('shopee.exportPrepare',{ids:[row.id]}).ok,false,'master diperiksa ulang saat ekspor');
});
