/** Template dan manifest privat; tidak pernah dibagikan melalui link publik. */
function shopeeBatchFolder_() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty('shopee_batch_folder');
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.getRootFolder().createFolder('Template Shopee (Master SKU - Privat)');
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  props.setProperty('shopee_batch_folder', folder.getId());
  return folder;
}
function shopeeBatchRecord_(id) {
  const row = db_('SHOPEE_BATCHES').byId(id);
  if (!row) throw new AppError('Batch unggahan tidak ditemukan.');
  return row;
}
function shopeeBatchManifest_(row) {
  const key = 'sb1:' + row.BatchID, hit = cacheGetBig_(key);
  if (hit) return hit;
  const data = JSON.parse(DriveApp.getFileById(row.ManifestID).getBlob().getDataAsString());
  cachePutBig_(key, data); return data;
}
function shopeeBatchView_(r) {
  return {id:r.BatchID,name:r.FileName,store:r.StoreAccount,total:Number(r.TotalRows),imported:Number(r.ImportedRows),status:r.Status,createdAt:r.CreatedAt};
}
function shopeeBatchList_() {
  return db_('SHOPEE_BATCHES').rows().slice().sort((a,b)=>String(b.CreatedAt).localeCompare(String(a.CreatedAt))).map(shopeeBatchView_);
}
function shopeeBatchCreate_(user,p) {
  const store=cleanText(p.store), name=cleanText(p.fileName);
  if(!store||store.length>60||!name||! /\.xlsx$/i.test(name)||!Array.isArray(p.rows)||!p.rows.length||p.rows.length>15000) throw new AppError('Template, toko, dan baris sumber wajib valid (maksimal 15.000 variasi).');
  if(typeof p.base64!=='string'||p.base64.length>14*1024*1024||! /^[A-Za-z0-9+/]+={0,2}$/.test(p.base64))throw new AppError('Template maksimal 10 MB.');
  const bytes=Utilities.base64Decode(p.base64);
  if(bytes.length>10*1024*1024||bytes[0]!==80||bytes[1]!==75)throw new AppError('Gunakan file XLSX asli, maksimal 10 MB.');
  const seen={};
  p.rows.forEach(r=>{const key=shopeeKey_(store,r.productId,r.variationId);if(!/^\d{3,25}$/.test(String(r.productId))||!/^\d{0,25}$/.test(String(r.variationId||''))||!r.name||seen[key])throw new AppError('Identitas baris template tidak valid / duplikat.');seen[key]=true;});
  const folder=shopeeBatchFolder_(), id=uuid_();let original,manifest;
  try {
    original=folder.createFile(Utilities.newBlob(bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',id+'.xlsx'));
    original.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.VIEW);
    manifest=folder.createFile(Utilities.newBlob(JSON.stringify({rows:p.rows}),'application/json',id+'.json'));
    manifest.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.VIEW);
    const row=db_('SHOPEE_BATCHES').insert({BatchID:id,FileName:name.slice(0,200),StoreAccount:store,FileID:original.getId(),ManifestID:manifest.getId(),TotalRows:p.rows.length,ImportedRows:0,Status:'importing',CreatedBy:user.email,CreatedAt:now_()});
    audit_(user.email,'shopee.batchCreate','shopee_batch',id,null,{name,store,total:p.rows.length});
    return shopeeBatchView_(row);
  } catch(e) {if(original)original.setTrashed(true);if(manifest)manifest.setTrashed(true);throw e;}
}
function shopeeBatchGet_(p) {
  const r=shopeeBatchRecord_(p.id);
  return Object.assign(shopeeBatchView_(r),{base64:Utilities.base64Encode(DriveApp.getFileById(r.FileID).getBlob().getBytes())});
}
