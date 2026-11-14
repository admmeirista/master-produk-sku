const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('cache browser menampilkan snapshot langsung, menyegarkan data, terpisah per akun dan tidak menerima respons lama setelah invalidasi',async()=>{
 const data=new Map(),pending=[];let now=1000;
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i],get length(){return data.size;}};
 const c={App:{me:{email:'a@local',role:'data_entry'}},Date:{now:()=>now},sessionStorage:storage,api:()=>new Promise(resolve=>pending.push(resolve))};
 const s=fs.readFileSync(path.join(__dirname,'../src/Scripts.html'),'utf8');vm.runInNewContext(s.slice(s.indexOf('var FastReadCache='),s.indexOf('function api(')),c);
 const seen=[];let p=c.fastRead('shopee.list',{},(d,m)=>seen.push([d.rows[0],m.cached]));assert.equal(seen.length,0);pending.shift()({rows:['old']});await p;
 p=c.fastRead('shopee.list',{},(d,m)=>{seen.push([d.rows[0],m.cached]);d.rows[0]='modified view';});assert.deepEqual(seen.at(-1),['old',true]);
 pending.shift()({rows:['fresh']});await p;assert.deepEqual(seen.at(-1),['fresh',false]);
 const key=c.FastReadCache.key('shopee.list',{});assert.equal(c.FastReadCache.get(key).rows[0],'fresh','renderer tidak mengubah snapshot cache');
 c.App.me.email='b@local';let rendered=0;p=c.fastRead('shopee.list',{},()=>rendered++);assert.equal(rendered,0,'akun lain tidak melihat cache akun sebelumnya');
 c.FastReadCache.clear();pending.shift()({rows:['late']});await p;assert.equal(rendered,0);assert.equal(data.size,0);
 c.App.me.email='a@local';c.FastReadCache.put(key,{rows:['expired']});now+=121000;assert.equal(c.FastReadCache.get(key),null);
});
test('permintaan daftar bersamaan digabungkan menjadi satu permintaan server',async()=>{
 let calls=0,resolveRequest;const c={App:{me:{id:'one',role:'viewer'}},sessionStorage:{getItem(){return null;},setItem(){}},api:()=>{calls++;return new Promise(resolve=>resolveRequest=resolve);}};
 const s=fs.readFileSync(path.join(__dirname,'../src/Scripts.html'),'utf8');vm.runInNewContext(s.slice(s.indexOf('var FastReadCache='),s.indexOf('function api(')),c);
 let renders=0;const a=c.fastRead('bundle.list',{},()=>renders++),b=c.fastRead('bundle.list',{},()=>renders++);assert.equal(calls,1);resolveRequest({rows:[]});await Promise.all([a,b]);assert.equal(renders,2);
});
