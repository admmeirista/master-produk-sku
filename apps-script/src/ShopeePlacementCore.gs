/** Aturan murni, tanpa akses database. Versi browser dihasilkan dari file ini oleh build-pages.cjs. */
var ShopeePlacement={
  inspect:function(rows){
    var grouped={},out={};
    rows.forEach(function(r){var id=String(r.productId);(grouped[id]=grouped[id]||[]).push(r);});
    Object.keys(grouped).forEach(function(id){
      var group=grouped[id],ids=new Set(),parents=new Set(),named=false,missing=false;
      group.forEach(function(r){ids.add(String(r.variationId||''));var name=String(r.variationName||'').trim();if(name&&!/^[-–—]+$/.test(name))named=true;if(!Object.prototype.hasOwnProperty.call(r,'variationName'))missing=true;var parent=String(r.parentSku||'').trim();if(parent)parents.add(parent);});
      var kind=ids.size>1||named?'variants':missing?'unknown':'single';
      var reason=kind==='single'?'Satu baris dan nama variasi kosong pada template asli.':kind==='variants'?'Terdapat pilihan variasi pada template asli.':'Informasi nama variasi pada template belum tersedia.';
      if(parents.size>1){kind='unknown';reason='SKU Induk sumber berbeda dalam satu Kode Produk. Periksa template asli.';}
      out[id]={kind:kind,parentSku:kind==='variants'?(Array.from(parents)[0]||'SHP'+id):'',count:ids.size,reason:reason,generatedParent:kind==='variants'&&!parents.size};
    });return out;
  },
  preview:function(shape,target){
    shape=shape||{kind:'unknown',reason:'Template asli yang sesuai belum tersedia.'};
    var ready=!!target&&!!target.sku&&!target.preview&&target.active!==false&&shape.kind!=='unknown';
    return {kind:shape.kind,ready:ready,parentSku:shape.kind==='single'?(target&&!target.preview&&target.sku||''):shape.kind==='variants'?shape.parentSku:'',sku:shape.kind==='variants'?(target&&!target.preview&&target.sku||''):'',gtin:target&&target.gtin||'',reason:shape.reason,generatedParent:!!shape.generatedParent};
  }
};
