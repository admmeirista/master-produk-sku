function shopeeBatchShapes_(batch){
  const key='sbshape3:'+batch.BatchID,hit=cacheGetBig_(key);
  const manifest=shopeeBatchManifest_(batch),shapes=hit||ShopeePlacement.inspect(manifest.rows);if(!hit)cachePutBig_(key,shapes);
  const sources={};manifest.rows.forEach(r=>sources[shopeeKey_(batch.StoreAccount,r.productId,r.variationId)]=r);
  return {shapes,sources};
}
/** Seleksi dilakukan sesudah struktur produk dihitung dari seluruh manifest, bukan daftar terfilter. */
function shopeeAttachShapes_(views,batchId){
  const pending=new Set(views.map(r=>r.id)),batches=db_('SHOPEE_BATCHES').rows().filter(b=>b.Status==='ready'&&(!batchId||b.BatchID===batchId)).sort((a,b)=>String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
  views.forEach(r=>{r.listingShape={kind:'unknown',reason:'Template asli yang sesuai belum tersedia.'};});
  for(const batch of batches){
    if(!pending.size)break;
    const candidates=views.filter(r=>pending.has(r.id)&&r.store===batch.StoreAccount);if(!candidates.length)continue;
    const data=shopeeBatchShapes_(batch);
    candidates.forEach(r=>{const source=data.sources[shopeeKey_(r.store,r.productId,r.variationId)];if(source&&shopeeSourceMatches_(source,r)){r.listingShape=Object.assign({batchId:batch.BatchID},data.shapes[r.productId]);pending.delete(r.id);}});
  }
  views.forEach(r=>{r.effectiveSku=r.listingShape.kind==='single'?r.parentSku:r.listingShape.kind==='variants'?r.sellerSku:'';r.skuMatches=!!r.target&&!!r.effectiveSku&&r.effectiveSku===r.target.sku;});
  const keys=new Set(views.map(r=>JSON.stringify([r.store,r.productId]))),shown=new Set(views.map(r=>r.id));
  const siblings=db_('SHOPEE_LISTINGS').rows().filter(r=>r.ReviewStatus==='approved'&&!shown.has(r.ListingID)&&keys.has(JSON.stringify([r.StoreAccount,r.ExternalProductId]))),catalog=siblings.length?shopeeCatalog_(siblings.map(r=>r.TargetSku)):{};
  shopeeApplyParentGroups_(views,views.filter(r=>r.status==='approved').concat(siblings.map(r=>shopeeView_(r,catalog))));
  return views;
}
function shopeeApplyParentGroups_(views,related){
  const groups={};(related||views).forEach(r=>{if(!r.target||!r.target.parentSku)return;const k=JSON.stringify([r.store,r.productId]);(groups[k]=groups[k]||new Set()).add(r.target.parentSku);});
  views.forEach(r=>{r.listingShape=ShopeePlacement.withParents(r.listingShape,Array.from(groups[JSON.stringify([r.store,r.productId])]||[]));r.listingShape.siblingParentSkus=Array.from(new Set((related||views).filter(x=>x.id!==r.id&&x.store===r.store&&x.productId===r.productId&&x.target&&x.target.parentSku).map(x=>x.target.parentSku)));});return views;
}

/** Audit seluruh persetujuan, termasuk di luar filter penjualan dan halaman aktif. */
function shopeeApprovedPlacementAudit_(universe){
  const records=(universe||db_('SHOPEE_LISTINGS').rows()).filter(r=>r.ReviewStatus==='approved');
  const catalog=shopeeCatalog_(records.map(r=>r.TargetSku)),views=records.map(r=>shopeeView_(r,catalog));
  shopeeAttachShapes_(views);
  shopeeApplyParentGroups_(views);views.forEach(r=>{r.exportPreview=ShopeePlacement.preview(r.listingShape,r.target);});
  return {total:views.length,ready:views.filter(r=>r.status==='approved'&&r.exportPreview.ready).length,issues:views.filter(r=>r.status!=='approved'||!r.exportPreview.ready).map(r=>({id:r.id,productId:r.productId,name:r.name,variationName:r.variationName,reason:r.status!=='approved'?'Master berubah setelah persetujuan; periksa ulang.':r.exportPreview.reason})),rows:views};
}
