/** Kode pada kolom jual didahulukan; parent komponen PRD bukan kode jual sebuah MP/BD. */
function shopeeMatchCode_(row,index){
  const kind=(row.listingShape||{}).kind;
  if(!['single','variants'].includes(kind))return null;
  const code=String(kind==='single'?row.parentSku:row.sellerSku||'').trim();
  if(!/^(?:PRD\d{6}-\d{3}|(?:MP|BD)\d{6})$/.test(code))return null;
  const doc=index.bySku[code],t=doc&&doc.target;
  if(!t)return {method:'system_sku',score:0,proposed:false,candidateSku:code,reason:'Kode SKU Shopee tidak ditemukan pada master aktif.'};
  const semantic=shopeeMatchListing_(row,index,t,true),reasons=['Kode SKU Shopee sama persis dengan SKU jual master'],qty=shopeeMatchSale_(row);
  let safe=!!semantic&&semantic.score>=82&&!qty.unclear&&qty.type===t.kind&&qty.quantity===doc.quantity;
  if(kind==='single'&&row.sellerSku)safe=false;
  if(row.gtin&&(!shopeeMatchGtinKey_(row.gtin)||shopeeMatchGtinKey_(row.gtin)!==shopeeMatchGtinKey_(t.gtin))){safe=false;reasons.push('GTIN Shopee berbeda dari GTIN SKU jual master');}
  if(!safe)reasons.push(semantic&&semantic.reason||'Nama, variasi, jenis atau jumlah perlu diperiksa');
  return {method:'system_sku',score:safe?99:Math.min(semantic&&semantic.score||0,59),proposed:safe,candidateSku:t.sku,candidateName:t.name,reason:reasons.join(' · ')};
}
function shopeeRoundtripHistory_(){
  const latest={};db_('AUDIT_LOGS').rows().filter(r=>['shopee.approve','shopee.needs_review','shopee.ignored'].includes(r.Action)).sort((a,b)=>String(a.CreatedAt).localeCompare(String(b.CreatedAt))).forEach(r=>latest[r.EntityID]=r);
  return latest;
}
/** Hanya memulihkan persetujuan yang dibatalkan importer, bukan keputusan manual pengguna. */
function shopeeRoundtripEligible_(record,view,index,history){
  if(record.ReviewStatus!=='needs_review'||record.ReviewedAt||!String(record.ReviewNote||'').startsWith('Data Shopee berubah sejak pemeriksaan sebelumnya;'))return false;
  const log=history[record.ListingID];let after={};try{after=log&&typeof log.AfterJson==='object'?log.AfterJson:JSON.parse(log&&log.AfterJson||'{}');}catch(e){return false;}
  if(!log||log.Action!=='shopee.approve'||after.targetSku!==record.TargetSku)return false;
  const match=shopeeMatchCode_(view,index),target=index.bySku[record.TargetSku];
  if(!match||!match.proposed||match.candidateSku!==record.TargetSku||!target||shopeeValidateTarget_(record,target.target).length)return false;
  view.match=match;return true;
}
function shopeeImportKeepsApproval_(old,values,shape,catalog,index){
  const target=catalog[old.TargetSku];
  if(old.ReviewStatus!=='approved'||!target||!target.active||old.ReviewedTargetSignature!==target.signature||shopeeValidateTarget_(old,target).length)return false;
  const row=shopeeView_(Object.assign({},old,values),catalog);row.listingShape=shape;
  const match=shopeeMatchCode_(row,index);
  if(!match||!match.proposed||match.candidateSku!==target.sku)return false;
  const preview=ShopeePlacement.preview(shape,target);
  return preview.ready&&preview.parentSku===values.ExternalParentSku&&preview.sku===values.ExternalSku&&preview.gtin===values.ExternalGTIN;
}
