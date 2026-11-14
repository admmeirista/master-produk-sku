const test=require('node:test'),assert=require('node:assert/strict');const{createGas}=require('./harness.cjs');
test('cache daftar Shopee dan paket melewati pembacaan katalog ulang, lalu invalid setelah perubahan listing atau master',()=>{
 const G=createGas(),a=G.ctx.setup().admin;
 const call=(action,p={},token)=>JSON.parse(JSON.stringify(G.ctx.api(token||T,action,p))),ok=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;};
 const T=JSON.parse(JSON.stringify(G.ctx.api(null,'auth.login',{email:a.email,password:a.password}))).data.token;
 const row={productId:'987654321',variationId:'1',name:'Produk uji cache',stock:1,price:10};ok(call('shopee.import',{store:'A',rows:[row]}));
 let catalogs=0;const original=G.ctx.shopeeCatalog_;G.ctx.shopeeCatalog_=()=>{catalogs++;return original();};
 ok(call('shopee.list',{}));catalogs=0;ok(call('shopee.list',{}));assert.equal(catalogs,0,'cache hangat tidak membaca ulang katalog');
 ok(call('shopee.import',{store:'A',rows:[{...row,price:99}]}));catalogs=0;const fresh=ok(call('shopee.list',{}));assert.equal(fresh.rows[0].price,99);assert.ok(catalogs>0,'penulisan listing mengganti versi cache');
 assert.equal(ok(call('shopee.list',{store:'B'})).total,0,'filter toko tidak berbagi hasil');
 let lists=0;const base=G.ctx.bundleList_;G.ctx.bundleList_=p=>{lists++;return base(p);};
 ok(call('bundle.list',{}));lists=0;ok(call('bundle.list',{}));assert.equal(lists,0);
 ok(call('brand.create',{name:'Perubahan master'}));ok(call('bundle.list',{}));assert.equal(lists,1);
});
