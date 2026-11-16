/** Satu snapshot per versi/batch; filter/pagination berikutnya tidak membangun katalog lagi. */
function shopeeWorkspace_(f){
  f=f||{};const profile=shopeeSalesProfile_(),key='sw1:'+dataVersion_()+':'+(profile?profile.id:'all')+':'+shopeeSignature_({batchId:f.batchId||'',store:f.store||''});
  const hit=cacheGetBig_(key);if(hit)return hit;
  const universe=db_('SHOPEE_LISTINGS').rows(),stores=new Set();let batchKeys=null;
  if(f.batchId){const batch=shopeeBatchRecord_(f.batchId);batchKeys=new Set(shopeeBatchManifest_(batch).rows.map(r=>shopeeKey_(batch.StoreAccount,r.productId,r.variationId)));}
  const rows=universe.filter(r=>{stores.add(r.StoreAccount);return (!f.store||f.store===r.StoreAccount)&&(!batchKeys||batchKeys.has(shopeeKey_(r.StoreAccount,r.ExternalProductId,r.ExternalVariationId)));});
  const scoped=shopeeSalesScope_(rows,universe),catalog=shopeeCatalog_(Array.from(new Set(scoped.rows.map(r=>r.TargetSku).filter(Boolean)))),summary={all:scoped.rows.length,verify:0,approved:0,unavailable:0};
  const views=scoped.rows.map(r=>{const v=shopeeView_(r,catalog);summary[v.status==='approved'?'approved':v.target&&v.target.active?'verify':'unavailable']++;return v;});
  const result={rows:views,summary,salesProfile:scoped.profile,excludedNoSales:scoped.excluded,stores:Array.from(stores).sort(),version:dataVersion_()};cachePutBig_(key,result);return result;
}
