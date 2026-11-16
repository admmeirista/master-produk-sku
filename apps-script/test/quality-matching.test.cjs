const test=require('node:test'),assert=require('node:assert/strict');
const {createGas}=require('./harness.cjs');
test('kategori nama sama beda cabang bukan duplikat; jalur dan ID kanal yang benar-benar sama tetap terdeteksi',()=>{
 const {ctx:c}=createGas(),r=(id,name,parent='',extra={})=>({CategoryID:id,CategoryName:name,ParentID:parent,Status:'ACTIVE',...extra});
 const rows=[r('t','Tangan'),r('k','Kaki'),r('a','Lotion','t'),r('b','Lotion','k'),r('c','Lotion','t'),r('d','Lotion','k',{Status:'DELETED'})];
 let groups=c.qualityCategoryDuplicates_(rows);assert.equal(groups.length,1);assert.match(groups[0].categoryIds,/a \| c/);assert.doesNotMatch(groups[0].categoryIds,/b|d/);assert.match(groups[0].path,/Tangan > Lotion/);
 groups=c.qualityCategoryDuplicates_([r('e','Nama lama','',{ExternalSource:'SHOPEE',ExternalID:'123'}),r('f','Nama baru','',{ExternalSource:'SHOPEE',ExternalID:'123'})]);assert.equal(groups.length,1);assert.equal(groups[0].reason,'ID kanal sama');
 assert.equal(c.qualityCategoryDuplicates_([r('e','Lotion','missing1'),r('f','Lotion','missing2')]).length,0,'induk hilang berbeda tidak dianggap root sama');
});
test('parent minimal 90% ditandai sama, urut skor; kunci lama/brand berbeda/ukuran berbeda tidak memicu salah cocok',()=>{
 const {ctx:c}=createGas(),r=(id,name,brand='b')=>({ProductID:id,ProductCode:id,ProductName:name,NameKey:'stale-key',BrandID:brand});
 const rows=[r('1','abcdefghij'),r('2','abcdefghiz'),r('3','abcdefghij'),r('4','beda total'),r('5','abcdefghij','lain'),r('6','Body Lotion 100ml'),r('7','Body Lotion 200ml')];
 const pairs=c.qualityParentPairs_(rows,{b:{BrandName:'Brand'}});assert.equal(pairs.length,3);assert.equal(pairs[0].score,'100%');assert.ok(pairs.slice(1).every(r=>r.score==='90%'));assert.ok(pairs.every(r=>![r.productId,r.productId2].some(id=>['4','5','6','7'].includes(id))));
});
test('optimasi kemiripan tetap menghasilkan seluruh pasangan yang memenuhi skor asli',()=>{
 const {ctx:c}=createGas(),names=['Gatsby Clay','Gatsby Clai','Gatsby Nature Styling Balm Clay','Gatsby Nature Styling Balm Clai','Body Lotion 100ml','Body Lotion 200ml','Body Lotion 100 ml','Lotion Body 100ml','abcdefghij','abcdefghiz','abcdefghi','abc def','abcdef'];
 const rows=names.map((ProductName,i)=>({ProductName,ProductID:String(i),ProductCode:String(i),BrandID:'b'})),expected=[];
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(c.masterNameKey(a.ProductName)===c.masterNameKey(b.ProductName)||c.nameSimilarity(a.ProductName,b.ProductName)>=.9)expected.push(i+':'+j);}
 const actual=c.qualityParentPairs_(rows,{}).map(r=>r.productId+':'+r.productId2);assert.deepEqual([...actual].sort(),expected.sort());
});
test('cache daftar menghindari hitung ulang dan otomatis berganti setelah perubahan data',()=>{
 const G=createGas(),a=G.ctx.setup().admin,c=G.ctx,token=c.api(null,'auth.login',{email:a.email,password:a.password}).data.token,ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
 for(const [action,fn] of [['product.list','productList_'],['category.list','masterList_']]){
   ok(c.api(token,action,{}));const original=c[fn];c[fn]=()=>{throw Error('seharusnya memakai cache');};ok(c.api(token,action,{}));c[fn]=original;
 }
 const before=ok(c.api(token,'brand.list',{}));ok(c.api(token,'brand.create',{name:'Brand Cache Baru'}));const after=ok(c.api(token,'brand.list',{}));assert.equal(after.length,before.length+1);
});
