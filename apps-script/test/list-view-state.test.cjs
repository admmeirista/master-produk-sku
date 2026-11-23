const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=n=>fs.readFileSync('apps-script/src/'+n+'.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,'');
function session(){
 const data={},c={App:{me:{user:{id:'a'}}},sessionStorage:{getItem:k=>data[k]||null,setItem:(k,v)=>data[k]=v}};
 vm.runInNewContext(source('ListViewState'),c);return {c,data};
}
test('filter disalin per akun/halaman dan dipulihkan setelah refresh; argumen eksplisit menang',()=>{
 const {c}=session(),s=c.ListViewState,defaults={search:'',status:'',page:1,sort:'name'};
 const f=s.restore('products',defaults);f.search='Viva';f.page=4;f.status='ACTIVE';s.save('products',f);f.search='berubah';
 assert.equal(s.restore('products',defaults).search,'Viva');assert.equal(s.restore('mapping',defaults).search,'');
 s.memory={};assert.equal(s.restore('products',defaults).page,4);
 assert.equal(s.restore('products',defaults,{search:'',page:1}).search,'');
 c.App.me.user.id='b';assert.equal(s.restore('products',defaults).search,'');c.App.me.user.id='a';assert.equal(s.restore('products',defaults).search,'Viva');
});
test('pindah menu sebelum debounce menyimpan teks terbaru dan mengembalikan halaman pertama',()=>{
 const {c}=session(),f={search:'lama',page:6,status:'approved'};c.ListViewState.capture('mapping',f,{value:'Air Mawar'});
 const restored=c.ListViewState.restore('mapping',{search:'',page:1,status:''});assert.equal(restored.search,'Air Mawar');assert.equal(restored.page,1);assert.equal(restored.status,'approved');
 c.sessionStorage.setItem=()=>{throw Error('disabled');};c.ListViewState.save('bundles',{search:'MP000033'});assert.equal(c.ListViewState.restore('bundles',{search:''}).search,'MP000033');
});
function listPage(name){
 const {c}=session(),nodes={},requests=[];
 Object.assign(c,{Pages:{},window:{},can:()=>false,icon:()=>'',esc:String,pageHead:()=>'',masterTabs:()=>{},camBtn:()=>'',isPhone:()=>false,loadingBox:()=>'',errBox:String,enhanceFilters:()=>{},refCombo:()=>{},debounce:fn=>fn,$:s=>nodes[s]||=( {value:'',innerHTML:'',isConnected:true,classList:{toggle(){}}} ),$$:()=>[],ProductCache:{get:()=>null},FastReadCache:{generation:0},fastRead:(action,f)=>{requests.push({action,filters:{...f}});return Promise.resolve();}});
 let text=source(name==='products'?'Pages':'Ops');
 if(name==='products')text=text.slice(text.indexOf('Pages.products ='),text.indexOf('/** Laci detail'));
 vm.runInNewContext(text,c);return {c,nodes,requests};
}
for(const page of ['products','bundles'])test(page+': pencarian/filter pulih setelah keluar lalu membuka daftar kembali',()=>{
 const {c,nodes,requests}=listPage(page),q=page==='products'?'#fq':'#bq',status=page==='products'?'#fs':'#bs';
 c.Pages[page]({isConnected:true},{});nodes[q].value='Viva';nodes[q].oninput({target:nodes[q]});nodes[status].value='INACTIVE';nodes[status].onchange({target:nodes[status]});
 c.App.onLeave();c.Pages[page]({isConnected:true},{});
 assert.equal(nodes[q].value,'Viva');assert.equal(nodes[status].value,'INACTIVE');assert.equal(requests.at(-1).filters.search,'Viva');assert.equal(requests.at(-1).filters.status,'INACTIVE');
 // Capture even if input's delayed callback has not run yet.
 nodes[q].value='MP000033';c.App.onLeave();c.Pages[page]({isConnected:true},{});assert.equal(requests.at(-1).filters.search,'MP000033');
});
test('Shopee: hasil pencarian dan status tetap terfilter setelah pindah menu',async()=>{
 const {c}=session(),nodes={},node=s=>nodes[s]||=({value:'',innerHTML:'',isConnected:true,classList:{toggle(){}}}),rows=[{id:'v',name:'Viva Air Mawar',status:'approved',target:{sku:'MP000033',active:true}},{id:'p',name:'Pixy',status:'approved',target:{sku:'MP000208',active:true}}];
 Object.assign(c,{Pages:{},Store:{get:()=>null,set(){}},can:()=>true,fmtNum:String,esc:v=>String(v||''),icon:()=>'',pageHead:()=>'',loadingBox:()=>'',pager:()=>'',emptyBox:()=>'',errBox:String,debounce:f=>f,toast:()=>{},FastReadCache:{put(){},key:()=>''},$:s=>node(s),$$:()=>[],fastRead:(a,f,render)=>{render({rows,summary:{all:2,approved:2}});return Promise.resolve();},api:()=>Promise.resolve([])});
 for(const n of ['Shopee','ShopeeWorkflow','ShopeeSelection','ShopeeBatch','ShopeeWorkspace'])vm.runInNewContext(source(n),c);
 const flush=()=>new Promise(setImmediate);c.Pages.mapping({isConnected:true},{});await flush();
 nodes['#slSearch'].value='Viva';nodes['#slSearch'].oninput({target:nodes['#slSearch']});nodes['#slStatus'].value='approved';nodes['#slStatus'].onchange({target:nodes['#slStatus']});await flush();
 c.App.onLeave();c.App.page='products';c.App.page='mapping';c.Pages.mapping({isConnected:true},{});await flush();
 assert.equal(nodes['#slSearch'].value,'Viva');assert.equal(nodes['#slStatus'].value,'approved');assert.match(nodes['#slRows'].innerHTML,/Viva Air Mawar/);assert.doesNotMatch(nodes['#slRows'].innerHTML,/Pixy/);
});
