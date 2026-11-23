/** Satu snapshot per versi/batch; filter/pagination berikutnya tidak membangun katalog lagi. */
function shopeeWorkspace_(f){
  f=f||{};const profile=shopeeSalesProfile_(),key='sw6:'+dataVersion_()+':'+(profile?profile.id:'all')+':'+shopeeSignature_({batchId:f.batchId||'',store:f.store||''});
  const hit=cacheGetBig_(key);if(hit)return hit;
  const universe=db_('SHOPEE_LISTINGS').rows(),stores=new Set();let batchKeys=null;
  if(f.batchId){const batch=shopeeBatchRecord_(f.batchId);batchKeys=new Set(shopeeBatchManifest_(batch).rows.map(r=>shopeeKey_(batch.StoreAccount,r.productId,r.variationId)));}
  const rows=universe.filter(r=>{stores.add(r.StoreAccount);return (!f.store||f.store===r.StoreAccount)&&(!batchKeys||batchKeys.has(shopeeKey_(r.StoreAccount,r.ExternalProductId,r.ExternalVariationId)));});
  const scoped=shopeeSalesScope_(rows,universe),catalog=shopeeCatalog_(Array.from(new Set(scoped.rows.map(r=>r.TargetSku).filter(Boolean)))),summary={all:scoped.rows.length,verify:0,approved:0,unavailable:0};
  const views=scoped.rows.map(r=>{const v=shopeeView_(r,catalog);v.productSales=profile&&r.StoreAccount===profile.store&&profile.productSales&&Object.prototype.hasOwnProperty.call(profile.productSales,v.productId)?profile.productSales[v.productId]:null;summary[v.status==='approved'?'approved':(v.reviewRequested||v.target&&v.target.active)?'verify':'unavailable']++;return v;});
  const matching=shopeeAnalyzeViews_(views);summary.all=views.length;summary.verify=0;summary.approved=0;summary.unavailable=0;views.forEach(v=>summary[v.status==='approved'?'approved':(v.reviewRequested||v.target&&v.target.active)?'verify':'unavailable']++);
  shopeeAttachShapes_(views,f.batchId);
  const audit=shopeeApprovedPlacementAudit_(universe);const audited={};audit.rows.forEach(r=>audited[r.id]=r);views.forEach(r=>{if(audited[r.id])r.listingShape=audited[r.id].listingShape;});
  views.sort((a,b)=>(b.productSales===null?-1:b.productSales)-(a.productSales===null?-1:a.productSales)||String(a.productId).localeCompare(String(b.productId))||String(a.variationId).localeCompare(String(b.variationId)));
  const result={matching,placementAudit:{total:audit.total,ready:audit.ready,issues:audit.issues},rows:views,summary,salesProfile:scoped.profile,excludedNoSales:scoped.excluded,stores:Array.from(stores).sort(),version:dataVersion_()};cachePutBig_(key,result);return result;
}
