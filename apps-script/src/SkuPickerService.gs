/** Indeks ringan khusus SKU barang: tanpa BOM, konversi, dimensi atau mapping kanal. */
function skuPickerIndex_(){
  const version=dataVersion_(),key='sp1:'+version,hit=cacheGetBig_(key);if(hit)return hit;
  const P=indexBy_(db_('MASTER_PRODUCTS').rows(),'ProductID'),B=indexBy_(db_('MASTER_BRANDS').rows(),'BrandID');
  const rows=db_('PRODUCT_VARIANTS').rows().filter(v=>v.Status===STATUS.ACTIVE&&v.SKU&&P[v.ProductID]&&P[v.ProductID].Status===STATUS.ACTIVE).map(v=>{
    const p=P[v.ProductID],b=B[p.BrandID]||{};
    return {sku:v.SKU,kind:'variant',displayName:variantDisplayName_(v)||cleanText((b.BrandName||'')+' '+p.ProductName+' '+(v.IsDefault?'':v.VariantName)),barcode:v.GTIN||v.InternalBarcode||'',gtin:v.GTIN||'',internalBarcode:v.InternalBarcode||'',variantId:v.VariantID,productId:p.ProductID,brandId:p.BrandID,brandName:b.BrandName||'',baseUnit:v.BaseUnit||p.BaseUnit};
  }).sort((a,b)=>String(a.brandName+' '+a.displayName).localeCompare(String(b.brandName+' '+b.displayName),'id'));
  const result={version,rows};cachePutBig_(key,result);return result;
}
