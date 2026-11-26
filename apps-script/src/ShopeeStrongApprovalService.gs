/** Persetujuan massal hanya dijalankan lewat tindakan eksplisit, bukan saat daftar dibaca. */
function shopeeStrongCandidates_(p,selectedIds){
  p=p||{};const all=db_('SHOPEE_LISTINGS').rows(),catalog=shopeeCatalog_(undefined,true),index=shopeeMatchIndex_(catalog);
  let scoped=shopeeSalesScope_(all,all).rows.filter(r=>!p.store||r.StoreAccount===p.store);
  if(p.batchId){const b=shopeeBatchRecord_(p.batchId),keys=new Set(shopeeBatchManifest_(b).rows.map(r=>shopeeKey_(b.StoreAccount,r.productId,r.variationId)));scoped=scoped.filter(r=>keys.has(shopeeKey_(r.StoreAccount,r.ExternalProductId,r.ExternalVariationId)));}
  const pending=scoped.filter(r=>!['approved','ignored'].includes(r.ReviewStatus)),views=[];
  const sourceViews=pending.filter(r=>!selectedIds||selectedIds.has(r.ListingID)).map(r=>shopeeView_(r,catalog));shopeeAttachShapes_(sourceViews,p.batchId);
  const byId=indexBy_(sourceViews,'id'),history=p.roundtripOnly?shopeeRoundtripHistory_():{};
  pending.forEach(r=>{
    if((selectedIds&&!selectedIds.has(r.ListingID))||r.ReviewedAt)return; // Draf/keputusan pengguna tetap diperiksa manual.
    const v=byId[r.ListingID];if(p.roundtripOnly&&!shopeeRoundtripEligible_(r,v,index,history))return;
    const match=p.roundtripOnly?v.match:shopeeMatchListing_(v,index);
    if(!match||!match.proposed||match.score<97||match.needsPackage||(p.gtinOnly&&match.method!=='gtin'))return;
    const t=catalog[match.candidateSku];if(!t||!t.active||(!p.roundtripOnly&&(!['single','multipack'].includes(t.kind)||t.components.length!==1)))return;
    if(v.target&&v.target.active&&v.target.sku!==t.sku)return;
    const component=catalog[t.components[0].sku],codes=new Set([t.gtin,component&&component.gtin,component&&component.internalBarcode].filter(Boolean));
    const observed=[v.gtin].concat(Array.from((v.sellerSku+' '+v.parentSku).matchAll(/\b\d{13}\b/g),m=>m[0])).filter(Boolean);
    if(observed.some(code=>!Array.from(codes).some(c=>shopeeMatchGtinKey_(c)&&shopeeMatchGtinKey_(c)===shopeeMatchGtinKey_(code))))return;
    v.target=t;v.match=match;v.saleType=t.kind;v.quantity=t.components.reduce((n,c)=>n+c.quantity,0);v.expectedComponents=t.components.map(c=>({sku:c.sku,quantity:c.quantity}));views.push(v);
  });
  shopeeAttachShapes_(views,p.batchId);
  const parents={};function parent(store,pid,t){if(!t||!t.parentSku)return;const k=shopeeKey_(store,pid,'');(parents[k]=parents[k]||new Set()).add(t.parentSku);}
  all.filter(r=>r.ReviewStatus==='approved').forEach(r=>parent(r.StoreAccount,r.ExternalProductId,catalog[r.TargetSku]));
  views.forEach(v=>{if(v.listingShape.kind==='variants')parent(v.store,v.productId,v.target);});
  const ready=views.filter(v=>{const group=parents[shopeeKey_(v.store,v.productId,'')];v.listingShape=ShopeePlacement.withParents(v.listingShape,Array.from(group||[]));return ShopeePlacement.preview(v.listingShape,v.target).ready;});
  const targets=ready.length?shopeeCatalog_(Array.from(new Set(ready.map(v=>v.target.sku)))):{};
  return {total:scoped.length,pending:pending.length,threshold:97,items:ready.map(v=>({id:v.id,version:v.version,sku:v.target.sku,targetSignature:targets[v.target.sku].signature,score:v.match.score,name:v.name,variationName:v.variationName,saleType:v.saleType,quantity:v.quantity,components:v.expectedComponents,reason:v.match.reason}))};
}
function shopeeApproveStrong_(user,p){
  if(!Array.isArray(p.items)||!p.items.length||p.items.length>20||new Set(p.items.map(x=>x.id)).size!==p.items.length)throw new AppError('Pilih 1–20 kandidat unik per proses.');
  const plan=shopeeStrongCandidates_(p,new Set(p.items.map(x=>x.id))),valid={};plan.items.forEach(x=>valid[x.id]=x);
  const approved=[],skipped=[];
  p.items.forEach(input=>{
    const item=valid[input.id];
    if(!item||Number(input.version)!==item.version||input.sku!==item.sku||input.targetSignature!==item.targetSignature){skipped.push({id:input.id,reason:'Data berubah atau tidak memenuhi kriteria kuat saat diperiksa ulang.'});return;}
    const old=db_('SHOPEE_LISTINGS').byId(item.id),note=((old.ReviewNote||'')+'\nDisetujui dari analisis kecocokan kuat atas instruksi pengguna: '+item.score+'% · '+item.reason).slice(-4000);
    const saved=shopeeReview_(user,{id:item.id,version:item.version,action:'approve',sku:item.sku,targetSignature:item.targetSignature,saleType:item.saleType,quantity:item.quantity,components:item.components,note});
    approved.push({id:saved.id,sku:saved.targetSku});
  });
  audit_(user.email,'shopee.approveStrong','shopee_listing','',null,{approved:approved.length,skipped:skipped.length},{threshold:97,batchId:p.batchId||''});
  return {approved,skipped};
}
