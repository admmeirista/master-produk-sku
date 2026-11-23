const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createGas}=require('./harness.cjs');
function browser(){const c={Pages:{},esc:v=>String(v??''),fmtNum:String};for(const name of ['ShopeePlacement','Shopee','ShopeeWorkflow','ShopeeSelection'])vm.runInNewContext(fs.readFileSync('apps-script/src/'+name+'.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);return c;}
const header=['Kode Produk','Nama Produk','Kode Variasi','Nama Variasi','SKU Induk','SKU','GTIN','Harga','Stok'];
const source=(id,vid,name='',parent='')=>({productId:id,variationId:vid,variationName:name,name:'Produk '+id,parentSku:parent,sellerSku:'lama',gtin:'',price:123,stock:4,sourceRow:7});

test('aturan browser identik dengan sumber server; single model ID bukan bukti variasi',()=>{
 const c=browser(),core=fs.readFileSync('apps-script/src/ShopeePlacementCore.gs','utf8').replace(/\r\n/g,'\n');assert.equal(fs.readFileSync('apps-script/src/ShopeePlacement.html','utf8').replace(/\r\n/g,'\n'),'<script>\n'+core+'\n</script>\n');
 assert.equal(c.ShopeePlacement.inspect([source('58060952164','277637168941')])['58060952164'].kind,'single');
 assert.equal(c.ShopeePlacement.inspect([source('1','2','Merah')])['1'].kind,'variants','satu pilihan bernama tetap produk bervariasi');
 assert.equal(c.ShopeePlacement.inspect([source('1','2','—')])['1'].kind,'single');
});

test('tanpa variasi: SKU satuan, MP, BD masuk SKU Induk dan SKU dikosongkan, GTIN tetap milik target',()=>{
 const c=browser();for(const sku of ['PRD000003-001','MP000333','BD000001']){
  const raw=source('58060952164','277637168941'),file={rows:[raw],aoa:[header]};
  const plan=c.shopeeExportChanges(file,[{...raw,eligible:true,sku,parentSku:'PRD000582',gtin:'0123456789012'}]);
  assert.equal(plan.changes.find(x=>x.col===4).value,sku);assert.equal(plan.changes.find(x=>x.col===5).value,'');assert.equal(plan.changes.find(x=>x.col===6).value,'0123456789012');
  assert.ok(plan.changes.every(x=>[4,5,6].includes(x.col)));assert.equal(raw.sellerSku,'lama','snapshot sumber tidak ditimpa');
  const html=c.shopeePlacementPreview({listingShape:c.ShopeePlacement.inspect(file.rows)[raw.productId]},{sku,active:true});assert.match(html,/Tanpa variasi/);assert.match(html,new RegExp(sku));assert.match(html,/Kosong/);
 }
});

test('variasi satuan, MP, BD tetap satu grup sumber; ekspor subset memakai semua saudara termasuk yang tidak disetujui',()=>{
 const c=browser(),rows=[source('123','1','Satuan','GRUP-TOKO'),{...source('123','2','3 pcs','GRUP-TOKO'),sourceRow:8},{...source('123','3','Kombinasi','GRUP-TOKO'),sourceRow:9}];
 for(const [index,sku] of ['PRD000003-001','MP000001','BD000001'].entries()){
  const raw=rows[index],file={store:'Toko',rows,aoa:[header]},target={sku,parentSku:'PRD000003',active:true};
  const plan=c.shopeeSelectedPlan(file,[{...raw,store:'Toko',status:'approved',target}]);assert.equal(plan.eligible,1);assert.ok(plan.changes.every(x=>x.row===raw.sourceRow));assert.equal(plan.changes.find(x=>x.col===4).value,'PRD000003');assert.equal(plan.changes.find(x=>x.col===5).value,sku);assert.equal(plan.previews[0].kind,'variants');
 }
 const unnamed=rows.map(r=>({...r,variationName:'',parentSku:''}));const shapes=c.ShopeePlacement.inspect(unnamed);assert.equal(shapes['123'].kind,'variants');assert.equal(shapes['123'].parentSku,'');
});

test('template tidak lengkap atau SKU Induk bertentangan ditandai dan tidak diekspor',()=>{
 const c=browser(),r=source('1','2');delete r.variationName;assert.throws(()=>c.shopeeExportChanges({rows:[r],aoa:[header]},[{...r,eligible:true,sku:'MP000333'}]),/belum pasti/);
 const rows=[source('1','1','A','PARENT-A'),source('1','2','B','PARENT-B')];assert.equal(c.ShopeePlacement.inspect(rows)['1'].kind,'variants');assert.equal(c.ShopeePlacement.preview(c.ShopeePlacement.inspect(rows)['1'],{sku:'BD000001',active:true}).ready,false);
});

test('Excel hasil patch mempertahankan template dan ID, menempatkan BD/MP pada induk tanpa variasi dan SKU pada variasi terpilih',async()=>{
 const c=browser(),XLSX=require('xlsx'),JSZip=require('jszip'),{DOMParser,XMLSerializer}=require('@xmldom/xmldom');Object.assign(c,{XLSX,JSZip,DOMParser,XMLSerializer});
 const aoa=[['Template Shopee'],['Petunjuk asli'],header,['58060952164','Paket BD','277637168941','','lama-bd','lama','','100','2'],['58156935950','Paket MP','430620037513','','lama-mp','lama','','200','3'],['1234567','Produk variasi','11','Satuan','GRUP-A','lama','','300','4'],['1234567','Produk variasi','12','3 pcs','GRUP-A','lama','','400','5']];
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Produk');const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx',bookSST:true});
 const file=c.shopeeReadTemplate(bytes,'asli.xlsx');file.store='Toko';
 const selected=file.rows.slice(0,3).map((r,i)=>({...r,store:'Toko',status:'approved',target:{sku:['BD000001','MP000333','PRD000003-001'][i],active:true,gtin:'',parentSku:'PRD000003'}}));
 const plan=c.shopeeSelectedPlan(file,selected),blob=await c.shopeePatchWorkbook(file,plan.changes,plan.selectedRows),output=c.shopeeReadTemplate(Buffer.from(await blob.arrayBuffer()),'hasil.xlsx');
 assert.equal(output.rows.length,3);assert.deepEqual(Array.from(output.rows,r=>r.parentSku),['BD000001','MP000333','PRD000003']);assert.deepEqual(Array.from(output.rows,r=>r.sellerSku),['','','PRD000003-001']);
 for(let i=0;i<3;i++){assert.equal(output.rows[i].productId,file.rows[i].productId);assert.equal(output.rows[i].variationId,file.rows[i].variationId);assert.equal(output.rows[i].name,file.rows[i].name);assert.equal(output.rows[i].price,file.rows[i].price);assert.equal(output.rows[i].stock,file.rows[i].stock);}
 assert.equal(JSON.stringify(output.aoa.slice(0,3)),JSON.stringify(file.aoa.slice(0,3)));
});

test('workspace dan ekspor server mengambil bentuk listing dari template privat lengkap sebelum filter penjualan',()=>{
 const {ctx:c}=createGas(),a=c.setup().admin,T=c.api(null,'auth.login',{email:a.email,password:a.password}).data.token,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;},call=(action,p={})=>c.api(T,action,p);
 c.withLock_(()=>{c.db_('MASTER_PRODUCTS').insert({ProductID:'p',ProductCode:'PRD000001',ProductName:'Produk',Status:'ACTIVE'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'v',ProductID:'p',SKU:'PRD000001-001',ProductSKUName:'Produk',Status:'ACTIVE'});});
 const rows=[source('1234567','1'),{...source('1234567','2'),sourceRow:8},source('2345678','7')];
 const imported=ok(call('shopee.import',{store:'Toko',rows})).rows;
 c.withLock_(()=>c.shopeeOriginalTemplateSeed_({email:a.email},{store:'Toko',fileName:'1.xlsx',base64:Buffer.from('PK-original').toString('base64'),rows}));
 c.shopeeSalesProfileInstall_({id:'sales2026_20261118',store:'Toko',source:'Profil',year:2026,soldVariations:[['1234567','1'],['2345678','7']],soldProducts:[],productSales:{}});
 const data=ok(call('shopee.workspace'));assert.equal(data.rows.length,2);assert.equal(data.rows.find(r=>r.productId==='1234567').listingShape.kind,'variants');assert.equal(data.rows.find(r=>r.productId==='1234567').listingShape.count,2);assert.equal(ok(call('shopee.get',{id:imported[2].id})).listingShape.kind,'single');
 const target=ok(call('shopee.target',{sku:'PRD000001-001'}));for(const r of [imported[0],imported[2]])ok(call('shopee.review',{id:r.id,version:r.version,action:'approve',sku:target.sku,targetSignature:target.signature,saleType:'single',quantity:1,components:[{sku:target.sku,quantity:1}]}));
 const prepared=ok(call('shopee.exportPrepare',{ids:[imported[0].id,imported[2].id]}));assert.equal(prepared.rows[0].exportPreview.parentSku,'PRD000001');assert.equal(prepared.rows[0].exportPreview.sku,target.sku);assert.equal(prepared.rows[1].exportPreview.parentSku,target.sku);assert.equal(prepared.rows[1].exportPreview.sku,'');
 const followup=ok(call('shopee.batchCreate',{store:'Toko',fileName:'tarikan-baru.xlsx',base64:Buffer.from('PK-new').toString('base64'),rows:[{...rows[2],parentSku:target.sku,sellerSku:''}]}));
 ok(call('shopee.import',{batchId:followup.id,offset:0}));const after=ok(call('shopee.get',{id:imported[2].id}));assert.equal(after.status,'approved','tarikan baru dengan kode pada SKU Induk mempertahankan persetujuan');assert.equal(after.skuMatches,true);assert.equal(after.effectiveSku,target.sku);
 c.withLock_(()=>{c.db_('MASTER_PRODUCTS').insert({ProductID:'p2',ProductCode:'PRD000002',ProductName:'Lain',Status:'ACTIVE'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'v2',ProductID:'p2',SKU:'PRD000002-001',ProductSKUName:'Lain',Status:'ACTIVE'});});
 const other=ok(call('shopee.target',{sku:'PRD000002-001'}));ok(call('shopee.review',{id:imported[1].id,version:imported[1].version,action:'approve',sku:other.sku,targetSignature:other.signature,saleType:'single',quantity:1,components:[{sku:other.sku,quantity:1}]}));
 const audit=ok(call('shopee.workspace')).placementAudit;assert.equal(audit.total,3);assert.equal(audit.issues.length,2,'audit mencakup saudara yang tidak masuk filter sales');
 assert.equal(call('shopee.exportPrepare',{ids:[imported[0].id]}).ok,false,'konflik parent terhalang meski hanya satu variasi dipilih');

});

test('parent master menggantikan SHP maupun kode induk lama; parent kosong menahan variasi',()=>{
 const c=browser(),rows=[source('23189951931','1','Woody','SHP23189951931'),source('23189951931','2','Bouquet','KODE-LAMA')],shape=c.ShopeePlacement.inspect(rows)['23189951931'];
 assert.equal(shape.kind,'variants');
 for(const sku of ['PRD000075-001','MP000208']){const p=c.ShopeePlacement.preview(shape,{sku,parentSku:'PRD000075',active:true});assert.equal(p.ready,true);assert.equal(p.parentSku,'PRD000075');assert.equal(p.sku,sku);assert.equal(p.generatedParent,false);}
 assert.equal(c.ShopeePlacement.preview(shape,{sku:'BD000001',active:true}).ready,false);
 assert.equal(c.ShopeePlacement.preview({...shape,parentConflict:true},{sku:'MP000208',parentSku:'PRD000075',active:true}).ready,false);
});

test('tabel perbandingan menjaga nama Shopee dan menampilkan MP di induk tanpa variasi, bukan parent master',()=>{
 const c=browser(),r={name:'Viva Air Mawar 10 pcs',variationName:'',parentSku:'LAMA',sellerSku:'LAMA',gtin:'lama'},target={sku:'MP000033',parentSku:'PRD000011',name:'Paket 10 PCS Viva',variationName:'100 ml',gtin:'',active:true};
 const shape=c.ShopeePlacement.inspect([source('42207958860','290673827209')])['42207958860'],preview=c.ShopeePlacement.preview(shape,target),html=c.shopeeComparisonRows(r,target,preview);
 const {DOMParser}=require('@xmldom/xmldom'),doc=new DOMParser().parseFromString('<table><tbody>'+html+'</tbody></table>','text/xml'),rows=[...doc.getElementsByTagName('tr')].map(tr=>[...tr.childNodes].filter(n=>n.nodeType===1).map(n=>n.textContent));
 assert.equal(rows.length,6);assert.ok(rows.every(r=>r.length===4));assert.deepEqual(rows[0],['Nama Produk',r.name,target.name,r.name]);assert.deepEqual(rows[2],['SKU Induk / Parent','LAMA','Parent ProdukPRD000011','MP000033']);assert.deepEqual(rows[3],['SKU','LAMA','SKU PaketMP000033','Kosong (tanpa variasi)']);assert.deepEqual(rows[4],['GTIN','lama','—','—']);
 target.sku='MP000034';assert.match(c.shopeeComparisonRows(r,target,c.ShopeePlacement.preview(shape,target)),/MP000034/);
});
