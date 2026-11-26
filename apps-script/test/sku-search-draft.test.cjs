const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('SKU search survives blur, tab switching and rebind without silently changing the selected SKU',async()=>{
 const src=fs.readFileSync('apps-script/src/Scripts.html','utf8'),code=src.slice(src.indexOf('function combo('),src.indexOf('/** Saring daftar lokal',src.indexOf('function combo('))),timers=new Map();let timer=0,selected=[],draft='';
 const classes=()=>({toggle(){},add(){},remove(){}}),host={classList:classes()},input={value:'',select(){},focus(){this.onfocus();},blur(){this.onblur();}},list={classList:classes()},clear={classList:classes()},els={'input':input,'.cb-list':list,'.cb-clear':clear};
 const c={Promise,esc:String,icon:()=>'',debounce:f=>f,$:s=>els[s],$$:()=>[],setTimeout:f=>{timers.set(++timer,f);return timer;},clearTimeout:t=>timers.delete(t)};vm.runInNewContext(code,c);
 const existing={sku:'OLD'},item={sku:'NEW'},options=()=>({preserveQuery:true,query:draft,onQuery:q=>draft=q,value:existing,label:r=>r.sku,load:()=>[item],onChange:r=>selected.push(r)});
 c.combo(host,options());input.onfocus();await Promise.resolve();input.value='air mawar';input.oninput();input.onblur();for(const f of timers.values())f();timers.clear();assert.equal(input.value,'air mawar');assert.equal(draft,'air mawar');assert.equal(selected.length,0);
 c.combo(host,options());assert.equal(input.value,'air mawar','async brand/picker rebind preserves draft');input.onblur();input.onfocus();assert.equal(timers.size,0,'refocus cancels pending close');await Promise.resolve();input.onkeydown({key:'Enter',preventDefault(){}});assert.equal(input.value,'NEW');assert.equal(draft,'');assert.equal(selected[0].sku,'NEW');
 input.value='lotion';input.oninput();clear.onmousedown({preventDefault(){}});assert.equal(input.value,'');assert.equal(draft,'');assert.equal(selected.at(-1),null);
});
