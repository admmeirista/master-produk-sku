/** Aturan murni, tanpa akses database. Versi browser dihasilkan dari file ini oleh build-pages.cjs. */
var ShopeePlacement={
  inspect:function(rows){
    var grouped={},out={};
    rows.forEach(function(r){var id=String(r.productId);(grouped[id]=grouped[id]||[]).push(r);});
    Object.keys(grouped).forEach(function(id){
      var group=grouped[id],ids=new Set(),named=false,missing=false;
      group.forEach(function(r){ids.add(String(r.variationId||''));var name=String(r.variationName||'').trim();if(name&&!/^[-–—]+$/.test(name))named=true;if(!Object.prototype.hasOwnProperty.call(r,'variationName'))missing=true;});
      var kind=ids.size>1||named?'variants':missing?'unknown':'single';
      var reason=kind==='single'?'Satu baris dan nama variasi kosong pada template asli.':kind==='variants'?'Terdapat pilihan variasi pada template asli.':'Informasi nama variasi pada template belum tersedia.';
      out[id]={kind:kind,parentSku:'',count:ids.size,reason:reason,generatedParent:false};
    });return out;
  },
  preview:function(shape,target){
    shape=shape||{kind:'unknown',reason:'Template asli yang sesuai belum tersedia.'};
    var parent=String(target&&target.parentSku||'').trim();
    var reason=shape.reason;if(shape.kind==='variants'&&!parent)reason='SKU Parent master belum tersedia atau komponen paket memiliki beberapa parent. Periksa master sebelum ekspor.';
    if(shape.parentConflict)reason='Variasi dalam listing ini dipetakan ke parent master yang berbeda. Periksa pasangan SKU sebelum ekspor.';
    var ready=!!target&&!!target.sku&&!target.preview&&target.active!==false&&shape.kind!=='unknown'&&(shape.kind!=='variants'||!!parent)&&!shape.parentConflict;
    return {kind:shape.kind,ready:ready,parentSku:shape.kind==='single'?(target&&!target.preview&&target.sku||''):shape.kind==='variants'?parent:'',sku:shape.kind==='variants'?(target&&!target.preview&&target.sku||''):'',gtin:target&&target.gtin||'',reason:reason,generatedParent:false};
  }
};
