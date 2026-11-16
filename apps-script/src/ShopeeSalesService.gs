/** Profil penjualan privat tersimpan di Script Properties; tidak mengubah listing/master atau persetujuan. */
function shopeeSalesProfileInstall_(profile){
  if(!profile||!/^sales\d{4}_\d{8}$/.test(profile.id)||!profile.store||!Array.isArray(profile.soldVariations)||!Array.isArray(profile.soldProducts))throw new AppError('Profil penjualan tidak valid.');
  profile.soldVariations.forEach(p=>{if(!Array.isArray(p)||p.length!==2||!p.every(v=>/^\d{1,25}$/.test(v)))throw new AppError('ID variasi penjualan tidak valid.');});
  if(profile.soldProducts.some(p=>!/^\d{3,25}$/.test(p)))throw new AppError('ID produk penjualan tidak valid.');
  if(profile.productSales&&Object.keys(profile.productSales).some(id=>!/^\d{3,25}$/.test(id)||typeof profile.productSales[id]!=='number'||!Number.isFinite(profile.productSales[id])||profile.productSales[id]<0))throw new AppError('Penjualan produk harus berisi ID valid dan nilai rupiah nonnegatif.');
  const json=JSON.stringify(profile);if(json.length>300000)throw new AppError('Profil penjualan terlalu besar.');
  const props=PropertiesService.getScriptProperties(),size=7000,count=Math.ceil(json.length/size);
  for(let i=0;i<count;i++)props.setProperty(profile.id+':'+i,json.slice(i*size,(i+1)*size));
  props.setProperty('shopee_sales_profile',JSON.stringify({id:profile.id,count}));
  cachePutBig_('sales1:'+profile.id,profile);return {id:profile.id,source:profile.source};
}
function shopeeSalesSeed_(user){
  if(typeof SHOPEE_SALES_PROFILE_SEED==='undefined'||!db_('SHOPEE_LISTINGS').rows().length)return {skipped:true};
  const result=shopeeSalesProfileInstall_(SHOPEE_SALES_PROFILE_SEED);
  audit_(user.email,'shopee.salesProfile','shopee_sales',result.id,null,result);return result;
}
function shopeeSalesProfile_(){
  const props=PropertiesService.getScriptProperties(),meta=props.getProperty('shopee_sales_profile');if(!meta)return null;
  const m=JSON.parse(meta),hit=cacheGetBig_('sales1:'+m.id);if(hit)return hit;
  let json='';for(let i=0;i<m.count;i++){const part=props.getProperty(m.id+':'+i);if(part===null)throw new AppError('Profil penjualan belum lengkap. Hubungi admin.');json+=part;}
  const profile=JSON.parse(json);cachePutBig_('sales1:'+m.id,profile);return profile;
}
function shopeeSalesScope_(rows,universe){
  const profile=shopeeSalesProfile_();if(!profile)return {rows,profile:null,excluded:0};
  const variations=new Set(profile.soldVariations.map(p=>JSON.stringify(p))),products=new Set(profile.soldProducts),counts={};
  (universe||rows).forEach(r=>{if(r.StoreAccount===profile.store)counts[r.ExternalProductId]=(counts[r.ExternalProductId]||0)+1;});
  const selected=rows.filter(r=>r.StoreAccount!==profile.store||variations.has(JSON.stringify([String(r.ExternalProductId),String(r.ExternalVariationId||'')]))||(products.has(String(r.ExternalProductId))&&counts[r.ExternalProductId]===1&&!String(r.VariationName||'').trim()));
  return {rows:selected,excluded:rows.length-selected.length,profile:{id:profile.id,source:profile.source,year:profile.year,metric:profile.metric,store:profile.store}};
}
