const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const flush=()=>new Promise(setImmediate);
for(const status of ['', 'verify'])test('Setujui & berikutnya melintasi halaman tanpa melewatkan baris; filter '+(status||'semua'),async()=>{
 const nodes={},opened=[],notices=[],rows=Array.from({length:31},(_,i)=>({id:'r'+i,name:'Produk '+i,status:'suggested',target:{active:true},version:1}));
 const node=s=>nodes[s]||=( {innerHTML:'',isConnected:true});
 const list=f=>{const all=rows.filter(r=>!f.status||r.status!=='approved');return {rows:all.slice((f.page-1)*30,f.page*30).map(r=>({...r})),total:all.length,summary:{all:31,verify:rows.filter(r=>r.status!=='approved').length,approved:rows.filter(r=>r.status==='approved').length,unavailable:0}};};
 const c={Pages:{},SHOPEE_SELECTED:{},App:{me:{user:{email:'u'}}},Store:{get:()=>null,set(){}},can:()=>true,fmtNum:String,esc:v=>String(v||''),icon:()=>'',pageHead:()=>'',loadingBox:()=>'',pager:()=>'',emptyBox:()=>'',errBox:v=>v,debounce:f=>f,toast:t=>notices.push(t),FastReadCache:{put(){},key(){return 'k';}},$:(s)=>node(s),$$:(s,host)=>s==='[data-review]'?[...host.innerHTML.matchAll(/data-review="([^"]+)"/g)].map(m=>({getAttribute:()=>m[1]})):[],fastRead:(a,f,render)=>{render(list(f));return Promise.resolve();},api:(a,p)=>Promise.resolve(a==='shopee.batchList'?[]:list(p))};
 for(const name of ['Shopee','ShopeeWorkflow','ShopeeSelection','ShopeeBatch'])vm.runInNewContext(fs.readFileSync('apps-script/src/'+name+'.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);
 let callback;c.shopeeReviewDialog=(r,done)=>{opened.push(r.id);callback=done;};
 c.Pages.mapping({isConnected:true},{status});await flush();
 // Trigger actual rendered row handler.
 let buttons=c.$$('[data-review]',node('#slRows'));
 // Render attaches handlers to a separate query result, so retain those objects for click simulation.
 c.$$=(s,host)=>s==='[data-review]'?(buttons=[...host.innerHTML.matchAll(/data-review="([^"]+)"/g)].map(m=>({getAttribute:()=>m[1]}))):[];
 node('#slStatus').onchange({target:{value:status}});buttons[0].onclick();
 for(let i=0;i<31;i++){assert.equal(opened.at(-1),'r'+i);rows[i].status='approved';callback({...rows[i]},true);await flush();}
 assert.equal(new Set(opened).size,31);assert.equal(opened.length,31);assert.ok(notices.some(t=>t.includes('selesai')));
});
