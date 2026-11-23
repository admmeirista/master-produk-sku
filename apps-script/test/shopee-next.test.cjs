const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const flush=()=>new Promise(setImmediate);
test('sebelumnya/berikutnya melewati pagination tanpa API baru dan memulihkan pilihan sementara',async()=>{
 const nodes={},opened=[],rows=Array.from({length:35},(_,i)=>({id:'n'+i,name:'Produk '+i,status:i%2?'suggested':'approved',target:{active:true},version:1}));let buttons=[],navigation,requests=0,closed=0;
 const node=s=>nodes[s]||=({innerHTML:'',value:'',isConnected:true,classList:{toggle(){}}});
 const c={Pages:{},SHOPEE_SELECTED:{},App:{me:{user:{id:'navigation'}}},Store:{get:()=>null,set(){}},can:()=>true,fmtNum:String,esc:v=>String(v||''),icon:()=>'',pageHead:()=>'',loadingBox:()=>'',pager:()=>'',emptyBox:()=>'',errBox:String,debounce:f=>f,toast:()=>{},FastReadCache:{put(){},key:()=>''},$:s=>node(s),$$:(s,host)=>s==='[data-review]'?(buttons=[...host.innerHTML.matchAll(/data-review="([^"]+)"/g)].map(m=>({getAttribute:()=>m[1]}))):[],fastRead:(a,p,render)=>{requests++;render({rows,summary:{all:35,verify:17,approved:18}});return Promise.resolve();},api:()=>Promise.resolve([])};
 for(const name of ['ListViewState','Shopee','ShopeeWorkflow','ShopeeSelection','ShopeeBatch','ShopeeWorkspace'])vm.runInNewContext(fs.readFileSync('apps-script/src/'+name+'.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);
 c.shopeeReviewDialog=(r,done,nav)=>{opened.push(r);navigation=nav;};c.Pages.mapping({isConnected:true},{});await flush();buttons[0].onclick();assert.equal(navigation.canPrevious,false);assert.equal(navigation.total,35);
 navigation.move(1,{...opened.at(-1),saleType:'multipack',expectedComponents:[{sku:'PRD000011-001',quantity:3}]},()=>closed++);await flush();
 for(let i=2;i<=30;i++){navigation.move(1,opened.at(-1),()=>closed++);await flush();}
 assert.equal(opened.at(-1).id,'n30');assert.equal(navigation.position,31);assert.equal(c.App.shopeeState.page,2);
 for(let i=29;i>=0;i--){navigation.move(-1,opened.at(-1),()=>closed++);await flush();}
 assert.equal(opened.at(-1).id,'n0');assert.equal(opened.at(-1).expectedComponents[0].quantity,3);assert.equal(navigation.canPrevious,false);assert.equal(requests,1);assert.equal(closed,60);
 for(let i=1;i<=34;i++){navigation.move(1,opened.at(-1),()=>closed++);await flush();}assert.equal(navigation.canNext,false);assert.equal(navigation.position,35);
});
for(const pending of [false,true])for(const status of ['', 'verify'])test('Setujui & berikutnya melintasi halaman tanpa melewatkan baris; filter '+(status||'semua')+(pending?' dengan antrean latar belakang':''),async()=>{
 let fastRequests=0,listRequests=0;
 const nodes={},opened=[],notices=[],rows=Array.from({length:31},(_,i)=>({id:'r'+i,name:'Produk '+i,status:'suggested',target:{active:true},version:1}));
 const node=s=>nodes[s]||=( {innerHTML:'',isConnected:true});
 const list=f=>{const all=rows.filter(r=>!f.status||r.status!=='approved');return {rows:all.slice((f.page-1)*30,f.page*30).map(r=>({...r})),total:all.length,summary:{all:31,verify:rows.filter(r=>r.status!=='approved').length,approved:rows.filter(r=>r.status==='approved').length,unavailable:0}};};
 const c={Pages:{},SHOPEE_SELECTED:{},App:{me:{user:{email:'u'}}},Store:{get:()=>null,set(){}},can:()=>true,fmtNum:String,esc:v=>String(v||''),icon:()=>'',pageHead:()=>'',loadingBox:()=>'',pager:()=>'',emptyBox:()=>'',errBox:v=>v,debounce:f=>f,toast:t=>notices.push(t),FastReadCache:{put(){},key(){return 'k';}},$:(s)=>node(s),$$:(s,host)=>s==='[data-review]'?[...host.innerHTML.matchAll(/data-review="([^"]+)"/g)].map(m=>({getAttribute:()=>m[1]})):[],fastRead:(a,f,render)=>{fastRequests++;render({rows:rows.map(r=>({...r})),summary:list({page:1}).summary});return Promise.resolve();},api:(a,p)=>{if(a==='shopee.list'||a==='shopee.workspace')listRequests++;return Promise.resolve(a==='shopee.batchList'?[]:list(p));}};
 for(const name of ['ListViewState','Shopee','ShopeeWorkflow','ShopeeSelection','ShopeeBatch','ShopeeWorkspace'])vm.runInNewContext(fs.readFileSync('apps-script/src/'+name+'.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);
 let resolvers=[],writeRequests=0;
 if(pending){const code=fs.readFileSync('apps-script/src/ShopeePackage.html','utf8');vm.runInNewContext(code.slice(code.indexOf('var ShopeeReviewJobs='),code.indexOf('function shopeeSelectionKey')),c);const api=c.api;c.api=(action,p)=>action==='shopee.review'?(writeRequests++,new Promise(resolve=>resolvers.push(()=>resolve({...p.row,status:'approved',version:2})))):api(action,p);}
 let callback;c.shopeeReviewDialog=(r,done)=>{opened.push(r.id);callback=done;};
 c.Pages.mapping({isConnected:true},{status});await flush();
 // Trigger actual rendered row handler.
 let buttons=c.$$('[data-review]',node('#slRows'));
 // Render attaches handlers to a separate query result, so retain those objects for click simulation.
 c.$$=(s,host)=>s==='[data-review]'?(buttons=[...host.innerHTML.matchAll(/data-review="([^"]+)"/g)].map(m=>({getAttribute:()=>m[1]}))):[];
 node('#slStatus').onchange({target:{value:status}});await flush();buttons[0].onclick();
 let resolveStale,background;const stale={rows:rows.map(r=>({...r})),summary:{all:31,verify:31,approved:0,unavailable:0}};const originalApi=c.api;c.api=(action,p)=>action==='shopee.workspace'?new Promise(resolve=>resolveStale=resolve):originalApi(action,p);
 for(let i=0;i<31;i++){assert.equal(opened.at(-1),'r'+i);if(i===0)background=c.App.refreshData();if(pending){const row={...rows[i]};c.ShopeeReviewJobs.enqueue(row,{row,requestKey:'req'+i},row);callback(row,true,'pending');}else{rows[i].status='approved';callback({...rows[i]},true);}await flush();if(i===0){resolveStale(stale);await background;await flush();assert.match(node('#slSummary').innerHTML,pending?/shopee-stat-approved[^>]*>[\s\S]*?<strong>0<\/strong>/:/shopee-stat-approved[^>]*>[\s\S]*?<strong>1<\/strong>/,'respons background lama tidak boleh mengembalikan status sebelumnya');}}
 if(pending){assert.equal(writeRequests,1,'penulisan serial menghindari antrean lock server');assert.equal(opened.length,31,'produk berikutnya terbuka sebelum server menjawab');for(let i=0;i<31;i++){assert.equal(resolvers.length,i+1);resolvers[i]();await flush();}assert.match(node('#slSummary').innerHTML,/shopee-stat-approved[^>]*>[\s\S]*?<strong>31<\/strong>/);assert.equal(c.ShopeeReviewJobs.pending(),false);assert.equal(opened.length,31,'konfirmasi server tidak memindah popup lagi');}
 assert.equal(new Set(opened).size,31);assert.equal(opened.length,31);assert.ok(notices.some(t=>t.includes('selesai')));assert.equal(fastRequests,1,'snapshot hanya diambil sekali');assert.equal(listRequests,0,'filter dan halaman berikutnya tidak memanggil server');
});
