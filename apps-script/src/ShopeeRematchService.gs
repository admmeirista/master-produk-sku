/** Barcode di SKU lama adalah bukti usulan; tidak pernah persetujuan otomatis. */
function shopeeLegacyGtinMatch_(row,index){
  // Pada MP, GTIN Shopee dapat mengenali barang komponen tanpa menjadi GTIN paket.
  if(row.gtin&&shopeeMatchSale_(row).type!=='multipack')return null;
  const shape=row.listingShape||{},text=shape.kind==='variants'?row.sellerSku:row.parentSku+' '+row.sellerSku;
  const codes=row.gtin?[String(row.gtin).trim()]:Array.from(new Set(Array.from(String(text||'').matchAll(/(?:^|[^0-9])(\d{13})(?=$|[^0-9])/g),m=>m[1])));
  if(!codes.length)return null;
  if(codes.length!==1)return {method:'legacy_gtin',score:0,proposed:false,reason:'SKU lama memuat beberapa GTIN berbeda; perlu diperiksa.'};
  const sale=shopeeMatchSale_(row);if(sale.unclear||!['single','multipack'].includes(sale.type))return null;
  const suffix=String(text||'').match(new RegExp(codes[0]+'[-_](\\d{1,3})(?:$|\\s)'));if(suffix&&Number(suffix[1])!==sale.quantity)return {method:'legacy_gtin',score:39,proposed:false,reason:'Qty pada SKU lama berbeda dari jumlah penjualan Shopee.'};
  // GTIN satuan boleh mengenali isi MP; GTIN paket tetap memakai barcode paket sendiri.
  const clean=s=>shopeeSaleText_(s).replace(/\b\d+\s*(?:pcs?|buah|sachet|saset|pack|botol|tube|pot|biji|unit|lembar)\b/gi,' ').replace(/\b(?:paket|box|dus|lusin|kotak)\b/gi,' ');
  const unit=shopeeMatchGtin_({name:clean(row.name),variationName:clean(row.variationName),gtin:codes[0]},index);
  if(!unit)return null;
  if(!unit.proposed)return Object.assign({},unit,{method:'legacy_gtin',reason:'GTIN pada SKU lama perlu diperiksa · '+unit.reason});
  const t=index.bySku[unit.candidateSku].target;
  if(t.kind!=='single')return null;
  const base={method:'legacy_gtin',score:Math.min(unit.score,95),proposed:true,reason:(row.gtin?'GTIN barang Shopee mengenali komponen paket':'GTIN pada SKU lama cocok unik dengan master')+' · '+unit.reason};
  if(sale.type==='single')return Object.assign({},unit,base);
  const packs=index.docs.filter(d=>d.target.kind==='multipack'&&d.target.components.length===1&&d.target.components[0].sku===t.sku&&d.quantity===sale.quantity);
  if(packs.length>1)return {method:'legacy_gtin',score:74,proposed:false,candidateSku:packs[0].target.sku,reason:'GTIN barang cocok, tetapi ada beberapa MP dengan komposisi sama.'};
  return Object.assign({},base,{candidateSku:packs.length?packs[0].target.sku:t.sku,candidateName:packs.length?packs[0].target.name:t.name,needsPackage:!packs.length,componentSku:t.sku,quantity:sale.quantity,reason:base.reason+' · '+sale.quantity+' unit'+(!packs.length?' · MP belum ada; buat paket saat persetujuan.':' · MP sudah ada dengan komposisi sama.')});
}
function shopeeRematchPlan_(p,selectedIds){
  p=p||{};const all=db_('SHOPEE_LISTINGS').rows(),catalog=shopeeCatalog_(),index=shopeeMatchIndex_(catalog);let rows=shopeeSalesScope_(all,all).rows;
  if(p.batchId){const batch=shopeeBatchRecord_(p.batchId),keys=new Set(shopeeBatchManifest_(batch).rows.map(r=>shopeeKey_(batch.StoreAccount,r.productId,r.variationId)));rows=rows.filter(r=>keys.has(shopeeKey_(r.StoreAccount,r.ExternalProductId,r.ExternalVariationId)));}
  const unavailable=rows.filter(r=>!r.ReviewedAt&&!['approved','ignored'].includes(r.ReviewStatus)&&shopeeDisplayStatus_(r,catalog)==='unavailable'),views=unavailable.filter(r=>!selectedIds||selectedIds.has(r.ListingID)).map(r=>shopeeView_(r,catalog));shopeeAttachShapes_(views,p.batchId);
  const items=[];views.forEach(v=>{
    if(!['single','variants'].includes(v.listingShape.kind))return;
    const match=shopeeMatchCode_(v,index)||shopeeMatchGtin_(v,index)||shopeeLegacyGtinMatch_(v,index)||shopeeMatchListing_(v,index,null,false,true);
    if(!match||!match.proposed||match.score<80)return;
    const t=catalog[match.candidateSku];if(!t||!t.active)return;
    const components=match.needsPackage?[{sku:match.componentSku,quantity:match.quantity}]:t.components.map(c=>({sku:c.sku,quantity:c.quantity}));
    const item={id:v.id,version:v.version,sku:match.needsPackage?'':t.sku,saleType:match.needsPackage?'multipack':t.kind,quantity:components.reduce((n,c)=>n+c.quantity,0),components,score:match.score,reason:match.reason,needsPackage:!!match.needsPackage,name:v.name,variationName:v.variationName};
    item.signature=shopeeSignature_([item,t.signature,v.productId,v.variationId,v.parentSku,v.sellerSku,v.gtin]);items.push(item);
  });return {total:rows.length,unavailable:unavailable.length,items};
}
function shopeeRematchApply_(user,p){
  if(!Array.isArray(p.items)||!p.items.length||p.items.length>30||new Set(p.items.map(i=>i.id)).size!==p.items.length)throw new AppError('Kirim 1–30 usulan unik per proses.');
  const plan=shopeeRematchPlan_(p,new Set(p.items.map(i=>i.id))),valid=indexBy_(plan.items,'id'),saved=[],skipped=[];
  p.items.forEach(input=>{const item=valid[input.id];if(!item||item.version!==Number(input.version)||item.signature!==input.signature){skipped.push(input.id);return;}
    const old=db_('SHOPEE_LISTINGS').byId(item.id);
    db_('SHOPEE_LISTINGS').update(old,{TargetSku:item.sku,SaleType:item.saleType,SaleQuantity:item.quantity,ExpectedComponents:item.components,ReviewStatus:'suggested',ReviewedBy:'',ReviewedAt:'',ReviewedTargetSignature:'',ReviewNote:('Usulan analisis ulang '+item.score+'% · '+item.reason).slice(0,4000),Version:Number(old.Version||1)+1,UpdatedAt:now_()});saved.push(item.id);
  });audit_(user.email,'shopee.proposeUnavailable','shopee_listing','',null,{proposed:saved.length,skipped:skipped.length},{batchId:p.batchId||'',ids:saved});return {saved,skipped};
}
