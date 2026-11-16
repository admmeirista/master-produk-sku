const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createGas}=require('./harness.cjs');
function read(name,c){vm.runInNewContext(fs.readFileSync('apps-script/src/'+name+'.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);}
test('pilih semua disetujui mencakup semua halaman dan tidak dibatasi pencarian; sales tetap terurut setelah review',()=>{
 const c={};read('ShopeeWorkspace',c);const rows=Array.from({length:75},(_,i)=>({id:String(i),productId:String(i),name:'Produk '+i,status:i%3?'approved':'needs_review',productSales:i*100,target:{active:true}})),data={rows,summary:{all:75}};
 assert.equal(c.ShopeeWorkspace.approvedIds(data).length,50);assert.equal(c.ShopeeWorkspace.page(data,{page:1,pageSize:30,search:'Produk 1'}).rows.length,11);assert.equal(c.ShopeeWorkspace.approvedIds(data).length,50);
 const page=c.ShopeeWorkspace.page(data,{page:1,pageSize:30});assert.equal(page.rows[0].productSales,7400);c.ShopeeWorkspace.update(data,{id:'74',status:'approved',target:{active:true}});assert.equal(data.rows.find(r=>r.id==='74').productSales,7400);
});
test('penjualan Sheet3 dipetakan per produk untuk seluruh variasi, nol dibedakan dari tidak ada data',()=>{
 const G=createGas(),c=G.ctx,a=c.setup().admin,token=c.api(null,'auth.login',{email:a.email,password:a.password}).data.token,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
 ok(c.api(token,'shopee.import',{store:'Meirista',rows:[{productId:'1234567',variationId:'1',name:'Satu',price:1,stock:1},{productId:'1234567',variationId:'2',name:'Dua',price:1,stock:1},{productId:'2345678',variationId:'3',name:'Tiga',price:1,stock:1}]}));
 c.shopeeSalesProfileInstall_({id:'sales2026_20261117',store:'Meirista',source:'Profiling',year:2026,soldVariations:[['1234567','1'],['1234567','2'],['2345678','3']],soldProducts:[],productSales:{'1234567':1000,'2345678':0}});
 const data=ok(c.api(token,'shopee.workspace',{}));assert.deepEqual([...data.rows.map(r=>r.productSales)],[1000,1000,0]);
});
test('pembaruan menunggu form selesai, lalu memulihkan pilihan SKU dan posisi halaman',()=>{
 const store=new Map();let modal=true,destination;const c={Date,URL,App:{me:{user:{id:'u'}},page:'mapping',shopeeState:null},Net:{pending:0},SHOPEE_EXPORTING:false,SHOPEE_SELECTED:{a:true,b:true},SHOPEE_SALES_ID:'profile',document:{querySelector:()=>modal?{}:null},window:{RPM_BUILD_VERSION:'old',location:{href:'https://example.test/app/',replace:url=>destination=url}},sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
 c.App.shopeeState={page:3,status:'approved',search:'Viva'};read('AppUpdate',c);c.AppUpdate.pendingUi='new';c.AppUpdate.apply();assert.equal(destination,undefined);modal=false;c.AppUpdate.apply();assert.match(destination,/_app=new/);c.SHOPEE_SELECTED={};const resumed=c.AppUpdate.restore();assert.equal(resumed.arg.page,3);assert.equal(Object.keys(c.SHOPEE_SELECTED).length,2);
});

test('pemeriksaan versi mendeteksi rilis baru tanpa menerapkannya selama form terbuka',async()=>{
 let reloads=0;const c={Date,URL,App:{me:{user:{id:'u'}},page:'mapping'},Net:{pending:0},document:{visibilityState:'visible',querySelector:()=>({})},window:{RPM_BUILD_VERSION:'old',location:{href:'https://example.test/app/',replace:()=>reloads++}},fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve({version:'new'})}),api:()=>Promise.resolve({data:'v2'})};read('AppUpdate',c);c.AppUpdate.dataVersion='v1';await c.AppUpdate.check();assert.equal(c.AppUpdate.pendingUi,'new');assert.equal(c.AppUpdate.pendingData,true);assert.equal(reloads,0);
});
test('fingerprint aplikasi native stabil dan berubah ketika kode UI berubah',()=>{
 const {ctx:c}=createGas();c.include=n=>n+'v1';const first=c.appUiVersion_();assert.equal(c.appUiVersion_(),first);c.include=n=>n+(n==='ShopeeWorkflow'?'v2':'v1');assert.notEqual(c.appUiVersion_(),first);
});
