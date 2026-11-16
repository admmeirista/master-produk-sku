/** Arsipkan template awal tanpa mengimpor ulang listing atau mengubah persetujuan. */
function shopeeOriginalTemplateSeed_(user,sourceInput){
  const source=sourceInput||(typeof SHOPEE_ORIGINAL_TEMPLATE==='undefined'?null:SHOPEE_ORIGINAL_TEMPLATE);
  if(!source||!db_('SHOPEE_LISTINGS').rows().length)return {skipped:true};
  const name='Shopee_Template_Awal_20261112.xlsx';
  const existing=db_('SHOPEE_BATCHES').find(r=>r.Status==='ready'&&r.FileName===name&&r.StoreAccount===source.store&&Number(r.TotalRows)===source.rows.length);
  if(existing)return {id:existing.BatchID};
  const batch=shopeeBatchCreate_(user,Object.assign({},source,{fileName:name})),row=shopeeBatchRecord_(batch.id);
  db_('SHOPEE_BATCHES').update(row,{Status:'ready',ImportedRows:source.rows.length});
  return {id:batch.id,archived:true};
}
function shopeeSourceMatches_(source,row){
  const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
  return String(source.productId)===row.productId&&String(source.variationId||'')===row.variationId&&clean(source.name)===clean(row.name)&&clean(source.variationName)===clean(row.variationName)&&String(source.sellerSku||'').trim()===row.sellerSku&&String(source.parentSku||'').trim()===row.parentSku&&String(source.gtin||'').trim()===row.gtin;
}
function shopeeExportPrepare_(p){
  const selection=shopeeExportSelected_(p,15000);
  if(selection.rejected.length)throw new AppError(selection.rejected.length+' variasi tidak lagi disetujui, diabaikan, atau master berubah. Muat ulang daftar dan periksa pilihan.');
  if(p.localReference)return {rows:selection.rows,template:null};
  const batches=db_('SHOPEE_BATCHES').rows().filter(r=>r.Status==='ready').sort((a,b)=>(a.BatchID===p.batchId?-1:b.BatchID===p.batchId?1:String(b.CreatedAt).localeCompare(String(a.CreatedAt))));
  for(const batch of batches){
    if(selection.rows.some(r=>r.store!==batch.StoreAccount))continue;
    const source=shopeeBatchManifest_(batch),index={};source.rows.forEach(r=>index[JSON.stringify([String(r.productId),String(r.variationId||'')])]=r);
    if(!selection.rows.every(r=>{const s=index[JSON.stringify([r.productId,r.variationId])];return s&&shopeeSourceMatches_(s,r);}))continue;
    const template=batch.BatchID===p.loadedTemplateId?shopeeBatchView_(batch):shopeeBatchGet_({id:batch.BatchID});
    return {rows:selection.rows,template};
  }
  throw new AppError('Template asli yang sesuai belum tersedia. Pilih file asli Shopee di sini, lalu ulangi unduh.',[],'TEMPLATE_REQUIRED');
}
