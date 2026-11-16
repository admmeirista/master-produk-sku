const test=require('node:test'),assert=require('node:assert/strict'),{createGas}=require('./harness.cjs');
const profile={id:'sales2026_20261116',store:'Meirista',source:'Profiling uji.xlsx',year:2026,metric:'Pesanan siap dikirim > 0',soldVariations:[['123456','1']],soldProducts:['234567','345678']};
test('profil memakai pasangan ID variasi, bukan nama/SKU; total parent tidak mengikutkan semua varian',()=>{
 const {ctx:c}=createGas();c.shopeeSalesProfileInstall_(profile);
 const row=(p,v,name='')=>({ExternalProductId:p,ExternalVariationId:v,VariationName:name,StoreAccount:'Meirista'});
 const rows=[row('123456','1','Merah'),row('123456','2','Biru'),row('234567','99'),row('345678','1'),row('345678','2'),{...row('123456','2'),StoreAccount:'Toko lain'}];
 const result=c.shopeeSalesScope_(rows);assert.equal(result.rows.length,3);assert.equal(result.excluded,3);assert.equal(result.profile.year,2026);
 assert.equal(c.shopeeSalesScope_([rows[3]],rows).rows.length,0,'filter batch tidak membuat produk multivariasi terlihat seperti produk tunggal');
});
test('profil bertahan setelah cache dikosongkan dan data yang diabaikan tidak dihapus',()=>{
 const G=createGas(),c=G.ctx;c.shopeeSalesProfileInstall_(profile);G.cache.clear();assert.equal(c.shopeeSalesProfile_().soldVariations[0][1],'1');
 const a=c.setup().admin,token=c.api(null,'auth.login',{email:a.email,password:a.password}).data.token,call=(act,p)=>c.api(token,act,p),ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
 const imported=ok(call('shopee.import',{store:'Meirista',rows:[{productId:'123456',variationId:'1',name:'Sama',price:1,stock:1},{productId:'123456',variationId:'2',name:'Sama',price:1,stock:1}]}));
 const listed=ok(call('shopee.list',{}));assert.equal(listed.total,1);assert.equal(listed.summary.all,1);assert.equal(listed.excludedNoSales,1);assert.equal(listed.rows[0].variationId,'1');
 assert.equal(ok(call('shopee.get',{id:imported.rows[1].id})).variationId,'2','riwayat listing tetap dapat dibaca');
 const exp=ok(call('shopee.exportSelected',{ids:[imported.rows[1].id]}));assert.equal(exp.rows.length,0);assert.match(exp.rejected[0].reason,/profil penjualan/);
});
