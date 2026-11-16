const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createGas}=require('./harness.cjs');
test('indeks SKU barang tidak membangun sellables/BOM, menyaring status aktif dan berganti setelah master berubah',()=>{
 const G=createGas(),c=G.ctx;c.setup();
 c.withLock_(()=>{c.db_('MASTER_BRANDS').insert({BrandID:'b',BrandName:'Brand'});c.db_('MASTER_PRODUCTS').insert({ProductID:'p',BrandID:'b',ProductName:'Produk',Status:'ACTIVE'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'v',ProductID:'p',SKU:'PRD000001-001',ProductSKUName:'Brand Produk',Status:'ACTIVE',GTIN:'12345678'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'inactive',ProductID:'p',SKU:'PRD000001-002',Status:'INACTIVE'});});
 c.sellables_=()=>{throw Error('Tidak boleh membangun katalog lengkap');};
 let d=c.skuPickerIndex_();assert.equal(d.rows.length,1);assert.equal(d.rows[0].brandId,'b');assert.equal(d.rows[0].barcode,'12345678');
 const original=c.variantDisplayName_;c.variantDisplayName_=()=>{throw Error('Harus memakai cache');};assert.equal(c.skuPickerIndex_().rows.length,1);c.variantDisplayName_=original;
 c.withLock_(()=>c.db_('PRODUCT_VARIANTS').update(c.db_('PRODUCT_VARIANTS').byId('v'),{Status:'INACTIVE'}));assert.equal(c.skuPickerIndex_().rows.length,0);
});
test('pencarian SKU lokal mendukung brand opsional dan token nama/GTIN tanpa mengubah pilihan SKU',async()=>{
 const c={};vm.runInNewContext(fs.readFileSync('apps-script/src/SkuPicker.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);
 const rows=[{sku:'A',displayName:'Resik White 50 ml',brandId:'r',brandName:'Resik',gtin:'8991'},{sku:'B',displayName:'Resik White 90 ml',brandId:'r',brandName:'Resik'},{sku:'C',displayName:'Lotion White 50 ml',brandId:'x',brandName:'Lotion'}];
 assert.equal(c.SkuPicker.filter(rows,'white 50','').length,2);assert.equal(c.SkuPicker.filter(rows,'white 50','r')[0].sku,'A');assert.equal(c.SkuPicker.filter(rows,'8991','')[0].sku,'A');assert.equal(c.SkuPicker.filter(rows,'','x').length,1);assert.equal(rows.length,3);
});
test('cache SKU menggabungkan permintaan, bertahan saat review disetujui, dan tidak menerima respons akun lama',async()=>{
 let key='a',resolve,calls=0;const c={Date,FastReadCache:{key:()=>key,get:()=>null,put(){}},api:()=>{calls++;return new Promise(r=>resolve=r);}};
 vm.runInNewContext(fs.readFileSync('apps-script/src/SkuPicker.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);
 const a=c.SkuPicker.load(),b=c.SkuPicker.load();assert.equal(calls,1);resolve({rows:[{sku:'one'}]});await Promise.all([a,b]);assert.equal((await c.SkuPicker.load())[0].sku,'one');assert.equal(calls,1);
 c.SkuPicker.clear();const old=c.SkuPicker.load(),resolveOld=resolve;key='b';const newer=c.SkuPicker.load();resolve({rows:[{sku:'two'}]});await newer;resolveOld({rows:[{sku:'late'}]});assert.equal((await old).length,0);assert.equal((await c.SkuPicker.load())[0].sku,'two');assert.equal(calls,3);
});
