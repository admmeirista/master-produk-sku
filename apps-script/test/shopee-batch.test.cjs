const test=require('node:test'),assert=require('node:assert/strict');
const {createGas}=require('./harness.cjs');
function fixture(){const G=createGas(),a=G.ctx.setup().admin;const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data;};const T=ok(G.ctx.api(null,'auth.login',{email:a.email,password:a.password})).token;const call=(action,p={},token=T)=>G.ctx.api(token,action,p);return {G,call,ok};}
const row=n=>({productId:'123456789',variationId:String(n),name:'Produk '+n,price:100,stock:1});
test('batch menyimpan template privat, melanjutkan progres setelah reset cache, dan memfilter lingkup listing',()=>{
 const {G,call,ok}=fixture(),base64=Buffer.from('PK-template-asli').toString('base64');
 const b=ok(call('shopee.batchCreate',{store:'Meirista',fileName:'asli.xlsx',base64,rows:Array.from({length:151},(_,i)=>row(i+1))}));
 assert.equal(b.imported,0);assert.equal(G.ctx.DriveApp._files.length,2);assert.ok(G.ctx.DriveApp._files.every(f=>f.sharing==='PRIVATE:VIEW'));
 const first=ok(call('shopee.import',{batchId:b.id,offset:0,rows:[row(999)]}));assert.equal(first.rows.length,150);assert.equal(first.batch.imported,150);
 assert.equal(call('shopee.import',{batchId:b.id,offset:0}).ok,false,'offset lama ditolak');
 for(const key of G.cache.keys())if(!key.startsWith('sess_'))G.cache.delete(key);G.ctx.resetDbCache_();
 const restored=ok(call('shopee.batchGet',{id:b.id}));assert.equal(restored.base64,base64);assert.equal(restored.imported,150);
 const last=ok(call('shopee.import',{batchId:b.id,offset:150}));assert.equal(last.rows.length,1);assert.equal(last.batch.status,'ready');
 ok(call('shopee.import',{store:'Lain',rows:[row(999)]}));
 assert.equal(ok(call('shopee.list',{batchId:b.id})).summary.all,151);assert.equal(ok(call('shopee.list',{})).summary.all,152);
 assert.equal(ok(call('shopee.batchList'))[0].status,'ready');assert.equal(call('shopee.batchGet',{id:'missing'}).ok,false);
});
test('batch menolak template invalid dan menjaga progres tetap konsisten jika transaksi gagal',()=>{
 const {G,call,ok}=fixture(),p={store:'Meirista',fileName:'asli.xlsx',base64:Buffer.from('PK-original').toString('base64'),rows:[row(1)]};
 assert.equal(call('shopee.batchCreate',{...p,base64:'YWJj'}).ok,false);assert.equal(call('shopee.batchCreate',{...p,rows:[row(1),row(1)]}).ok,false);
 const b=ok(call('shopee.batchCreate',p));G.failWrites('SHOPEE_LISTINGS',0);
 assert.equal(call('shopee.import',{batchId:b.id,offset:0}).ok,false);G.failWrites('SHOPEE_LISTINGS',null);
 assert.equal(ok(call('shopee.batchGet',{id:b.id})).imported,0);
 assert.equal(ok(call('shopee.import',{batchId:b.id,offset:0})).batch.status,'ready');
 assert.equal(call('shopee.batchGet',{id:b.id},null).ok,false);
});
