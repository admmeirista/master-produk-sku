function shopeeBatchShapes_(batch){
  const key='sbshape1:'+batch.BatchID,hit=cacheGetBig_(key);
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
  return views;
}
