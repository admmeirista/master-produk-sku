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
 const audit=ok(call('shopee.workspace')).placementAudit;assert.equal(audit.total,3);assert.equal(audit.issues.length,0,'listing gabungan mempertahankan induk asli, termasuk saudara di luar filter sales');
 const mixed=ok(call('shopee.exportPrepare',{ids:[imported[0].id]}));assert.equal(mixed.rows[0].exportPreview.parentSku,'');assert.equal(mixed.rows[0].exportPreview.sku,'PRD000001-001');assert.equal(mixed.rows[0].exportPreview.parentPolicy,'preserve_original');

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

test('listing gabungan mempertahankan induk asli yang konsisten, kosong maupun berisi; tidak memilih parent sembarang',()=>{
 const c=browser();for(const original of ['','GRUP-PURBASARI']){
  const rows=[source('41064813055','1','WHITE GLOW',original),source('41064813055','2','GLUTA HYA',original)],shape=c.ShopeePlacement.withParents(c.ShopeePlacement.inspect(rows)['41064813055'],['PRD000004','PRD000003']);
  for(const sku of ['PRD000004-001','PRD000003-001']){const preview=c.ShopeePlacement.preview(shape,{sku,parentSku:sku.split('-')[0],active:true});assert.equal(preview.ready,true);assert.equal(preview.parentSku,original);assert.equal(preview.sku,sku);assert.equal(preview.parentPolicy,'preserve_original');assert.equal(preview.generatedParent,false);}
  assert.equal(c.ShopeePlacement.preview({...shape,originalParentConflict:true},{sku:'PRD000004-001',parentSku:'PRD000004'}).ready,false);
  assert.equal(c.ShopeePlacement.preview({...shape,originalParentKnown:false},{sku:'PRD000004-001',parentSku:'PRD000004'}).ready,false);
 }
 const shape={kind:'variants',masterParentSkus:['PRD000004','PRD000003'],siblingParentSkus:['PRD000003'],parentConflict:true,originalParentKnown:true,originalParentSku:''};assert.equal(c.ShopeePlacement.preview(shape,{sku:'PRD000003-001',parentSku:'PRD000003'}).parentSku,'PRD000003','preview ikut SKU baru, bukan parent pilihan sebelumnya');
});

test('15 variasi Purbasari/Lavojoy lintas parent dapat diekspor; subset memakai saudara disetujui di luar pilihan',()=>{
 const {ctx:c}=createGas(),admin=c.setup().admin,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;},token=ok(c.api(null,'auth.login',{email:admin.email,password:admin.password})).token,call=(a,p={})=>c.api(token,a,p);
 const groups=[['41064813055',['CYBRIGHT WHITENING','SKIN FIRMING','WHITE GLOW','CERAMIDE BARRIER','GLUTA HYA','PYTO CELL-C']],['29384126515',['Solve It Now','Keep It Chill','00 Silk White','Orange Blossom','01 Cream Beige','Black Opium','02 Warm Sand','SPF 50PA++++ (biru)','Summertrain']]],rows=[];let n=0;
 c.withLock_(()=>{for(const[id,variations]of groups)for(const variation of variations){n++;const parent='PRD'+String(n).padStart(6,'0');c.db_('MASTER_PRODUCTS').insert({ProductID:'p'+n,ProductCode:parent,ProductName:variation,Status:'ACTIVE'});c.db_('PRODUCT_VARIANTS').insert({VariantID:'v'+n,ProductID:'p'+n,SKU:parent+'-001',ProductSKUName:variation,Status:'ACTIVE'});rows.push({...source(id,String(n),variation,''),sourceRow:n+6});}});
 const batch=ok(call('shopee.batchCreate',{store:'Toko',fileName:'mixed.xlsx',base64:Buffer.from('PK-original').toString('base64'),rows})),imported=ok(call('shopee.import',{batchId:batch.id,offset:0})).rows;
 imported.forEach((r,i)=>{const target=ok(call('shopee.target',{sku:'PRD'+String(i+1).padStart(6,'0')+'-001'}));ok(call('shopee.review',{id:r.id,version:r.version,action:'approve',sku:target.sku,targetSignature:target.signature,saleType:'single',quantity:1,components:[{sku:target.sku,quantity:1}]}));});
 const all=ok(call('shopee.exportPrepare',{ids:imported.map(r=>r.id),batchId:batch.id}));assert.equal(all.rows.length,15);assert.ok(all.rows.every(r=>r.exportPreview.ready&&r.exportPreview.parentSku===''&&r.exportPreview.sku===r.targetSku));
 const selected=ok(call('shopee.exportPrepare',{ids:[imported[0].id],localReference:true}));assert.equal(selected.rows[0].listingShape.masterParentSkus.length,6);assert.equal(selected.rows[0].exportPreview.parentSku,'');
 const get=ok(call('shopee.get',{id:imported[0].id}));assert.equal(c.ShopeePlacement.preview(get.listingShape,get.target).parentSku,'');assert.equal(ok(call('shopee.workspace')).placementAudit.issues.length,0);
 const b=browser(),file={store:'Toko',rows,aoa:[header]},plan=b.shopeeSelectedPlan(file,selected.rows);assert.equal(plan.changes.find(x=>x.col===4).value,'');assert.equal(plan.changes.find(x=>x.col===5).value,'PRD000001-001');
});

test('patch Excel listing gabungan menjaga induk asli dan SKU tiap variasi pada ekspor subset',async()=>{
 const c=browser(),XLSX=require('xlsx'),JSZip=require('jszip'),{DOMParser,XMLSerializer}=require('@xmldom/xmldom');Object.assign(c,{XLSX,JSZip,DOMParser,XMLSerializer});
 const aoa=[['Template Shopee'],header,['41064813055','Purbasari','11','WHITE GLOW','','lama-a','','100','2'],['41064813055','Purbasari','12','GLUTA HYA','','lama-b','','200','3']];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Produk');const file=c.shopeeReadTemplate(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'asli.xlsx');file.store='Toko';
 const raw=file.rows[0],r={...raw,store:'Toko',status:'approved',target:{sku:'PRD000004-001',parentSku:'PRD000004',active:true,gtin:'8999225911258'},listingShape:{masterParentSkus:['PRD000004','PRD000003']}};const plan=c.shopeeSelectedPlan(file,[r]),blob=await c.shopeePatchWorkbook(file,plan.changes,plan.selectedRows),out=c.shopeeReadTemplate(Buffer.from(await blob.arrayBuffer()),'hasil.xlsx');assert.equal(out.rows.length,1);assert.equal(out.rows[0].parentSku,'');assert.equal(out.rows[0].sellerSku,'PRD000004-001');assert.equal(out.rows[0].gtin,'8999225911258');for(const field of ['productId','variationId','name','variationName','price','stock'])assert.equal(out.rows[0][field],raw[field]);
});
