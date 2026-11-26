const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
function engine(){const c={};vm.runInNewContext(fs.readFileSync('apps-script/src/ShopeeRoundtripService.gs','utf8')+'\n'+fs.readFileSync('apps-script/src/ShopeeMatchingService.gs','utf8'),c);return c;}
test('plus pada bahan dan SPF aman untuk satuan dan MP; plus antarbarang tetap perlu diperiksa',()=>{
 const c=engine();for(const ingredients of ['Niacinamide + Ceramide + Hyaluronic Acid','Vitamin B3 + Vitamin E','AHA + BHA + PHA']){
 const unit=c.shopeeMatchSale_({name:'Body Serum SPF 20++ PA++++ '+ingredients});assert.equal(unit.type,'single');assert.equal(unit.unclear,false);
 const pack=c.shopeeMatchSale_({name:'6 PCS Body Serum SPF 20++ '+ingredients});assert.equal(pack.type,'multipack');assert.equal(pack.quantity,6);assert.equal(pack.unclear,false);
 }
 assert.equal(c.shopeeMatchSale_({name:'Body Serum + Body Lotion'}).unclear,true);
 assert.equal(c.shopeeMatchSale_({name:'Body Serum SPF 50++ + Body Lotion'}).unclear,true);
 assert.equal(c.shopeeMatchSale_({name:'6 PCS Body Serum',variationName:'Random Campur'}).unclear,true);
});
function catalog(){
 const single=(sku,name,brandId,brandName,variationName)=>({sku,name,productName:name,kind:'single',brandId,brandName,variationName,parentSku:'PRD000011',active:true,components:[{sku,name,quantity:1}]}),v=single('PRD000011-001','Viva Air Mawar 100 ml','v','Viva','100 ml'),w=single('PRD000075-001','Pixy Stick Deodorant Woody 34 gr','p','Pixy','Woody 34 gr'),b=single('PRD000075-002','Pixy Stick Deodorant Bouquet 34 gr','p','Pixy','Bouquet 34 gr');
 const pack=(sku,unit,n)=>({sku,name:'Paket '+n+' PCS '+unit.name,kind:'multipack',active:true,variationName:unit.variationName,parentSku:unit.parentSku,components:[{sku:unit.sku,name:unit.name,quantity:n}]});
 return Object.fromEntries([v,w,b,pack('MP000033',v,10),pack('MP000208',w,12),pack('MP000210',b,12)].map(t=>[t.sku,t]));
}
test('kode ekspor MP didahulukan atas nama paket duplikat; parent PRD bukan SKU jual MP',()=>{
 const c=engine(),cat=catalog();cat.MP000034={...cat.MP000033,sku:'MP000034'};
 const index=c.shopeeMatchIndex_(cat),row={name:'10 PCS Viva Air Mawar 100 ml Paket Usaha',parentSku:'MP000033',sellerSku:'',listingShape:{kind:'single'}};
 const m=c.shopeeMatchListing_(row,index);assert.equal(m.method,'system_sku');assert.equal(m.candidateSku,'MP000033');assert.equal(m.proposed,true);
 assert.equal(c.shopeeMatchListing_({...row,parentSku:'PRD000011'},index).proposed,false);
 assert.equal(c.shopeeMatchListing_({...row,parentSku:'MP999999'},index).proposed,false);
 assert.equal(c.shopeeMatchListing_({...row,name:'3 PCS Viva Air Mawar 100 ml'},index).proposed,false);
});
test('brand lalu nama/ukuran/qty memberi usulan MP yang sesuai; kata paket usaha tidak menghalangi',()=>{
 const c=engine(),cat=catalog(),m=c.shopeeMatchListing_({name:'[ 10 PCS ] VIVA AIR MAWAR 100 ml [ KECIL ] /Penyegar/ Paket Usaha 10 PCS Air Mawar Viva/ Relaksasi/ Tonik'},c.shopeeMatchIndex_(cat));
 assert.equal(m.proposed,true);assert.equal(m.candidateSku,'MP000033');assert.ok(m.score>=82&&m.score<100);assert.match(m.reason,/Ukuran sesuai/);
});
test('ukuran berbeda atau hanya brand tidak menghasilkan pemetaan yakin',()=>{
 const c=engine(),idx=c.shopeeMatchIndex_(catalog());for(const name of ['Viva Air Mawar 200 ml','Viva','Produk yang tidak ada']){const m=c.shopeeMatchListing_({name},idx);assert.equal(m.proposed,false);assert.ok(m.score<82);}
});
test('varian tidak boleh ditebak: Woody, Bouquet, dan pilihan campur dibedakan',()=>{
 const c=engine(),idx=c.shopeeMatchIndex_(catalog());let m=c.shopeeMatchListing_({name:'[12 PCS] Pixy Stick Deodorant Woody 34 gr'},idx);assert.equal(m.candidateSku,'MP000208');assert.equal(m.proposed,true);
 for(const name of ['[12 PCS] Pixy Stick Deodorant 34 gr','[12 PCS] Pixy Stick Deodorant Woody 34 gr Boleh Campur']){m=c.shopeeMatchListing_({name},idx);assert.equal(m.proposed,false);}
});
test('nama variasi mengalahkan judul gabungan yang menyebut dua produk',()=>{
 const c=engine(),cat=catalog(),name='[12 PCS] Pixy Stick Deodorant Woody / Bouquet 34 gr';
 let m=c.shopeeMatchListing_({name,variationName:'Biru/Bouquet'},c.shopeeMatchIndex_(cat));assert.equal(m.proposed,true);assert.equal(m.candidateSku,'MP000210');
 delete cat.MP000210;m=c.shopeeMatchListing_({name,variationName:'Bouquet'},c.shopeeMatchIndex_(cat));assert.notEqual(m.candidateSku,'MP000208');assert.equal(m.componentSku,'PRD000075-002');assert.equal(m.needsPackage,true);
});
test('paket dengan qty berbeda tidak dipakai; komponen yang jelas disiapkan untuk membuat MP baru',()=>{
 const c=engine(),m=c.shopeeMatchListing_({name:'[20 PCS] Viva Air Mawar 100 ml'},c.shopeeMatchIndex_(catalog()));assert.equal(m.proposed,true);assert.equal(m.needsPackage,true);assert.equal(m.componentSku,'PRD000011-001');assert.equal(m.quantity,20);assert.notEqual(m.candidateSku,'MP000033');
});
test('hitungan botol dan satuan mengikuti pilihan variasi; nomor shade yang berbeda tidak disamakan',()=>{
 const c=engine(),cat=catalog();let m=c.shopeeMatchListing_({name:'3 botol Viva Air Mawar 100 ml'},c.shopeeMatchIndex_(cat));assert.equal(m.needsPackage,true);assert.equal(m.quantity,3);
 m=c.shopeeMatchListing_({name:'10 PCS Viva Air Mawar 100 ml',variationName:'Satuan'},c.shopeeMatchIndex_(cat));assert.equal(m.candidateSku,'PRD000011-001');assert.equal(m.needsPackage,undefined);
 cat['PRD000099-001']={...cat['PRD000075-001'],sku:'PRD000099-001',name:'Pixy Lip Cream 01',productName:'Pixy Lip Cream',variationName:'01',components:[{sku:'PRD000099-001',name:'Pixy Lip Cream 01',quantity:1}]};
 m=c.shopeeMatchListing_({name:'Pixy Lip Cream 01 / 02',variationName:'02'},c.shopeeMatchIndex_(cat));assert.equal(m.proposed,false);
});
test('katalog ringan untuk pencocokan tidak menghitung signature seluruh SKU',()=>{
 const {createGas}=require('./harness.cjs'),{ctx:c}=createGas();c.setup();c.withLock_(()=>{c.db_('MASTER_PRODUCTS').insert({ProductID:'p',ProductCode:'PRD000011',ProductName:'Viva',Status:'ACTIVE'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'v',ProductID:'p',SKU:'PRD000011-001',Status:'ACTIVE'});});
 let hashes=0;const hash=c.shopeeSignature_;c.shopeeSignature_=v=>{hashes++;return hash(v);};const light=c.shopeeCatalog_(undefined,true);assert.equal(hashes,0);assert.equal(light['PRD000011-001'].signature,undefined);const normal=c.shopeeCatalog_(['PRD000011-001']);assert.equal(hashes,1);assert.ok(normal['PRD000011-001'].signature);
});
test('dua paket identik membuat kandidat ambigu; BD/campuran tidak disetujui dari nama saja',()=>{
 const c=engine(),cat=catalog();cat.MP000099={...cat.MP000033,sku:'MP000099'};let m=c.shopeeMatchListing_({name:'10 PCS Viva Air Mawar 100 ml'},c.shopeeMatchIndex_(cat));assert.equal(m.proposed,false);assert.ok(m.score<=74);
 cat.BD000001={sku:'BD000001',name:'Paket Viva dan Pixy',kind:'bundle',active:true,components:[...cat['PRD000011-001'].components,...cat['PRD000075-001'].components]};m=c.shopeeMatchListing_({name:'[2 Produk] Viva Air Mawar 100 ml + Pixy Woody 34 gr'},c.shopeeMatchIndex_(cat));assert.equal(m.proposed,false);
});
test('analisis read-only hanya mengusulkan untuk tidak tersedia; persetujuan/abaikan/draf tetap',()=>{
 const c=engine(),cat=catalog();c.shopeeCatalog_=()=>cat;
 const rows=[{id:'new',name:'10 PCS Viva Air Mawar 100 ml',status:'unmapped'}, {id:'manual',name:'10 PCS Viva Air Mawar 100 ml',status:'approved',target:cat['PRD000011-001'],targetSku:'PRD000011-001'}, {id:'ignore',name:'10 PCS Viva Air Mawar 100 ml',status:'ignored'}, {id:'draft',name:'10 PCS Viva Air Mawar 100 ml',status:'needs_review',reviewRequested:true,expectedComponents:[]}];
 const result=c.shopeeAnalyzeViews_(rows);assert.equal(result.analyzed,1);assert.equal(result.proposed,1);assert.equal(rows[0].status,'suggested');assert.equal(rows[0].targetSku,'MP000033');assert.equal(rows[0].quantity,10);assert.equal(rows[1].status,'approved');assert.equal(rows[1].targetSku,'PRD000011-001');assert.equal(rows[2].status,'ignored');assert.equal(rows[3].target,undefined);
});
test('workspace memakai master terbaru; usulan tidak tersimpan sebagai persetujuan dan belum dapat diekspor',()=>{
 const {createGas}=require('./harness.cjs'),{ctx:c}=createGas(),admin=c.setup().admin;
 const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;},token=ok(c.api(null,'auth.login',{email:admin.email,password:admin.password})).token,call=(a,p={})=>c.api(token,a,p);
 c.withLock_(()=>{
  c.db_('MASTER_BRANDS').insert({BrandID:'v',BrandName:'Viva',Status:'ACTIVE'});
  c.db_('MASTER_PRODUCTS').insert({ProductID:'p',BrandID:'v',ProductCode:'PRD000011',ProductName:'Viva Air Mawar',Status:'ACTIVE'});
  c.db_('PRODUCT_VARIANTS').insert({VariantID:'v1',ProductID:'p',SKU:'PRD000011-001',ProductSKUName:'Viva Air Mawar 100 ml',VariantName:'100 ml',Status:'ACTIVE'});
  c.db_('BUNDLE_MASTERS').insert({BundleID:'b',BundleSKU:'MP000033',BundleType:'MULTIPACK',BundleName:'Paket 10 PCS Viva Air Mawar 100 ml',Status:'ACTIVE'});
  c.db_('BUNDLE_COMPONENTS').insert({ComponentID:'bc',BundleID:'b',VariantID:'v1',Quantity:10,Status:'ACTIVE'});
 });
 const original=ok(call('shopee.import',{store:'Toko',rows:[{productId:'42207958860',variationId:'290673827209',name:'10 PCS Viva Air Mawar 100 ml Paket Usaha',variationName:''}]})).rows[0];assert.equal(original.status,'unmapped');
 const data=ok(call('shopee.workspace')),row=data.rows[0];assert.equal(row.status,'suggested');assert.equal(row.targetSku,'MP000033');assert.ok(row.match.score>=82);assert.equal(data.matching.proposed,1);assert.equal(data.summary.verify,1);
 assert.equal(c.db_('SHOPEE_LISTINGS').byId(row.id).ReviewStatus,'unmapped');assert.equal(ok(call('shopee.exportSelected',{ids:[row.id]})).rejected.length,1);
 const approved=ok(call('shopee.review',{id:row.id,version:row.version,action:'approve',sku:row.targetSku,targetSignature:row.target.signature,saleType:row.saleType,quantity:row.quantity,components:row.expectedComponents}));assert.equal(approved.status,'approved');
});

test('GTIN unik memetakan satuan meski nama brand/variasi memakai alias dan SPF/bahan mengandung plus',()=>{
 const c=engine(),cat=catalog();cat['PRD000011-001'].gtin='8992796011501';const idx=c.shopeeMatchIndex_(cat);
 for(const row of [{name:'Air mawar',variationName:'Kecil',gtin:'8992796011501'},{name:'Viva Air Mawar SPF 50 PA++++ Niacinamide + Ceramide + Vitamin E',gtin:'08992796011501'}]){const m=c.shopeeMatchListing_(row,idx);assert.equal(m.proposed,true);assert.equal(m.method,'gtin');assert.equal(m.candidateSku,'PRD000011-001');assert.equal(m.score,99);}
});

test('GTIN tidak menimpa jenis paket, GTIN ganda/ukuran/variasi konflik atau barcode internal',()=>{
 const c=engine(),cat=catalog();cat['PRD000011-001'].gtin='8992796011501';let idx=c.shopeeMatchIndex_(cat);
 for(const name of ['10 PCS Viva Air Mawar 100 ml','2 Produk Viva Air Mawar + Pixy','Viva Air Mawar Boleh Campur'])assert.notEqual(c.shopeeMatchListing_({name,gtin:'8992796011501'},idx).method,'gtin');
 assert.equal(c.shopeeMatchListing_({name:'Viva Air Mawar 200 ml',gtin:'8992796011501'},idx).proposed,false);
 cat['PRD000075-001'].gtin='8992796011501';idx=c.shopeeMatchIndex_(cat);assert.equal(c.shopeeMatchListing_({name:'Viva Air Mawar',gtin:'8992796011501'},idx).proposed,false);
 delete cat['PRD000075-001'].gtin;delete cat['PRD000011-001'].gtin;cat['PRD000011-001'].internalBarcode='2000000000008';idx=c.shopeeMatchIndex_(cat);assert.equal(c.shopeeMatchListing_({name:'Viva',gtin:'2000000000008'},idx).proposed,false);
});

test('GTIN salah checksum hanya diusulkan untuk verifikasi, keputusan manual/disetujui tetap utuh',()=>{
 const c=engine(),cat=catalog();cat['PRD000011-001'].gtin='8992796011502';const idx=c.shopeeMatchIndex_(cat);assert.equal(c.shopeeMatchListing_({name:'Air mawar',gtin:'8992796011502'},idx).score,94);
 c.shopeeCatalog_=()=>cat;const rows=[{id:'new',name:'Air mawar',gtin:'8992796011502',status:'unmapped'},{id:'manual',name:'Air mawar',gtin:'8992796011502',status:'needs_review',reviewRequested:true,reviewedAt:'today'},{id:'approved',name:'Air mawar',gtin:'8992796011502',status:'approved'}];c.shopeeAnalyzeViews_(rows);assert.equal(rows[0].targetSku,'PRD000011-001');assert.equal(rows[1].targetSku,undefined);assert.equal(rows[2].targetSku,undefined);
});
