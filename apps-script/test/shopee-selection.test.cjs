const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {createGas}=require('./harness.cjs');
function browser(){const c={Pages:{},esc:v=>String(v??''),fmtNum:v=>String(v)};for(const name of ['Shopee','ShopeeWorkflow','ShopeeSelection'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/'+name+'.html'),'utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);return c;}
test('kartu jumlah dan persentase status: total nol tidak menghasilkan NaN; pencarian tetap memakai denominator total',()=>{
 const c=browser();let html=c.shopeeStatusCards({all:10,verify:3,approved:6,unavailable:1},'approved');
 assert.match(html,/30% dari total/);assert.match(html,/60% dari total/);assert.match(html,/10% dari total/);assert.match(html,/shopee-stat-approved on/);
 html=c.shopeeStatusCards({all:0,verify:0,approved:0,unavailable:0},'');assert.ok(!/NaN|Infinity/.test(html));assert.equal((html.match(/0% dari total/g)||[]).length,4);
});
test('rencana ekspor terpilih hanya menerapkan baris pilihan yang disetujui dan cocok dengan file sumber',()=>{
 const c=browser(),header=['Kode Produk','Nama Produk','Kode Variasi','Nama Variasi','SKU Induk','SKU','Harga','GTIN','Stok'];
 const raw={productId:'123',variationId:'1',name:'Produk satu',variationName:'30 gr',sellerSku:'lama',gtin:'',parentSku:'',sourceRow:7};
 const file={store:'Meirista',aoa:[header],rows:[raw,{...raw,variationId:'2',sourceRow:8}]};
 const current={...raw,id:'a',store:'Meirista',status:'approved',target:{active:true,sku:'MP000243',parentSku:'PRD000168',gtin:''}};
 const plan=c.shopeeSelectedPlan(file,[current]);assert.equal(plan.eligible,1);assert.deepEqual([...plan.selectedRows],[7]);assert.ok(plan.changes.every(x=>x.row===7));assert.ok(!plan.changes.some(x=>x.col===4),'SKU induk tidak diubah jika variasi lain tidak ikut disetujui');
 assert.throws(()=>c.shopeeSelectedPlan(file,[{...current,status:'suggested'}]),/belum disetujui/);
 assert.throws(()=>c.shopeeSelectedPlan(file,[{...current,variationId:'missing'}]),/tidak ada/);
 assert.throws(()=>c.shopeeSelectedPlan(file,[{...current,name:'Produk lain'}]),/berbeda/);
 assert.throws(()=>c.shopeeSelectedPlan(file,[{...current,store:'Toko lain'}]),/tidak ada/);
});
test('API ekspor terpilih memeriksa status/master saat ini dan tidak mengikutkan variasi lain',()=>{
 const G=createGas(),a=G.ctx.setup().admin;
 const call=(token,action,p={})=>JSON.parse(JSON.stringify(G.ctx.api(token,action,p))),ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;},T=ok(call(null,'auth.login',{email:a.email,password:a.password})).token;
 const brand=ok(call(T,'brand.create',{name:'Ekspor Uji'})),category=ok(call(T,'category.list')).find(c=>c.name==='Toner');
 const product=ok(call(T,'product.save',{input:{brandId:brand.id,categoryId:category.id,name:'Produk ekspor',baseUnit:'PCS',hasVariants:false,variants:[{barcode:{mode:'none'}}]}}));
 const sku=product.variants[0].sku,target=ok(call(T,'shopee.target',{sku}));
 const imported=ok(call(T,'shopee.import',{store:'Meirista',rows:[{productId:'123456789',variationId:'1',name:'Satu',price:100,stock:2},{productId:'123456789',variationId:'2',name:'Dua',price:200,stock:3}]})).rows;
 let result=ok(call(T,'shopee.exportSelected',{ids:[imported[0].id]}));assert.equal(result.rows.length,0);assert.equal(result.rejected.length,1);
 ok(call(T,'shopee.review',{id:imported[0].id,version:imported[0].version,action:'approve',sku,targetSignature:target.signature,saleType:'single',quantity:1,components:[{sku,quantity:1}]}));
 result=ok(call(T,'shopee.exportSelected',{ids:[imported[0].id]}));assert.equal(result.rows.length,1);assert.equal(result.rows[0].variationId,'1');assert.equal(result.rejected.length,0);assert.equal(result.rows[0].target.sku,sku);
 result=ok(call(T,'shopee.exportSelected',{ids:[imported[0].id,imported[1].id,'missing']}));assert.equal(result.rows.length,1);assert.equal(result.rejected.length,2);
 assert.equal(call(T,'shopee.exportSelected',{ids:[imported[0].id,imported[0].id]}).ok,false);
 assert.equal(call(T,'shopee.exportSelected',{ids:[]}).ok,false);
 G.ctx.withLock_(()=>G.ctx.db_('PRODUCT_VARIANTS').update(G.ctx.db_('PRODUCT_VARIANTS').byId(product.variants[0].id),{GTIN:'8992796011501'}));
 result=ok(call(T,'shopee.exportSelected',{ids:[imported[0].id]}));assert.equal(result.rows.length,0);assert.equal(result.rejected.length,1,'master berubah setelah persetujuan dikecualikan');
 ok(call(T,'user.create',{email:'photo@local.test',fullName:'Foto',role:'photo_staff',password:'Password#2026'}));const photo=ok(call(null,'auth.login',{email:'photo@local.test',password:'Password#2026'})).token;assert.equal(call(photo,'shopee.exportSelected',{ids:[imported[0].id]}).error.code,'FORBIDDEN');
});
test('pengguna mapping dapat mengunggah Shopee di Import & Export tanpa akses form impor master',()=>{
 const c=browser(),nodes={'#iob':{innerHTML:''},'#ioShopeeImport':{}},main={innerHTML:''};
 Object.assign(c,{can:p=>p==='mapping.write'||p==='export.run',pageHead:()=>'',icon:()=>'',emptyBox:()=>'',App:{go(){}},$:s=>nodes[s]||null,$$:()=>[]});
 const source=fs.readFileSync(path.join(__dirname,'../src/Pages.html'),'utf8');
 vm.runInNewContext(source.slice(source.indexOf('Pages.io ='),source.indexOf('Pages.export =')),c);
 vm.runInNewContext(source.slice(source.indexOf('Pages.import ='),source.indexOf('Pages.users =')),c);
 c.Pages.io(main);assert.match(main.innerHTML,/data-t="import"/);assert.match(nodes['#iob'].innerHTML,/ioShopeeImport/);assert.ok(!nodes['#iob'].innerHTML.includes('id="fi"'));assert.equal(c.can('import.run'),false);
});
