const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('halaman kualitas menampilkan ringkasan dahulu; tabel temuan baru dibuat saat bagian dibuka',async()=>{
 const body={dataset:{},innerHTML:''},box={innerHTML:''},button={},classes=new Set(),card={classList:{contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)},getAttribute:()=>0},header={parentNode:card,setAttribute(){}},main={isConnected:true};
 const q={summary:{error:1,warn:0,info:0},sections:[{label:'Parent ganda',severity:'error',count:1,recommendation:'Periksa',rows:[{sku:'SKU-TEST-ONLY'}]}],checkedAt:'2026-11-16'};
 const c={Pages:{},pageHead:()=>'',icon:()=>'',esc:String,fmtNum:String,fmtDate:String,masterTabs(){},loadingBox:()=>'',errBox:String,$:s=>s==='#qb'?box:s==='#rq'?button:body,$$:s=>s==='.vcard-h'?[header]:[],fastRead:(a,p,render)=>{render(q);return Promise.resolve();}};
 vm.runInNewContext(fs.readFileSync('apps-script/src/Ops.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);
 c.Pages.quality(main);await new Promise(setImmediate);assert.match(box.innerHTML,/Parent ganda/);assert.doesNotMatch(box.innerHTML,/SKU-TEST-ONLY|<table/);assert.equal(body.innerHTML,'');
 header.onclick();assert.match(body.innerHTML,/SKU-TEST-ONLY/);assert.equal(classes.has('open'),true);header.onclick();assert.equal(classes.has('open'),false);
});
