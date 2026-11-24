/** Aturan murni; dipakai bersama oleh server, pratinjau dan patch Excel. */
var ShopeePlacement={
  inspect:function(rows){
    var grouped={},out={};
    rows.forEach(function(r){var id=String(r.productId);(grouped[id]=grouped[id]||[]).push(r);});
    Object.keys(grouped).forEach(function(id){
      var group=grouped[id],ids=new Set(),named=false,missing=false,parents=new Set(),known=true;
      group.forEach(function(r){ids.add(String(r.variationId||''));var name=String(r.variationName||'').trim();if(name&&!/^[-–—]+$/.test(name))named=true;if(!Object.prototype.hasOwnProperty.call(r,'variationName'))missing=true;if(!Object.prototype.hasOwnProperty.call(r,'parentSku'))known=false;parents.add(String(r.parentSku||'').trim());});
      var kind=ids.size>1||named?'variants':missing?'unknown':'single';
      var reason=kind==='single'?'Satu baris dan nama variasi kosong pada template asli.':kind==='variants'?'Terdapat pilihan variasi pada template asli.':'Informasi nama variasi pada template belum tersedia.';
      out[id]={kind:kind,parentSku:'',count:ids.size,reason:reason,generatedParent:false,originalParentKnown:known,originalParentSku:parents.size===1?Array.from(parents)[0]:'',originalParentConflict:parents.size>1};
    });return out;
  },
  withParents:function(shape,parents){var unique=Array.from(new Set((parents||[]).map(function(p){return String(p||'').trim();}).filter(Boolean)));var next=Object.assign({},shape,{masterParentSkus:unique,parentConflict:unique.length>1});delete next.siblingParentSkus;return next;},
  preview:function(shape,target){
    shape=shape||{kind:'unknown',reason:'Template asli yang sesuai belum tersedia.'};
    var parent=String(target&&target.parentSku||'').trim(),parents=Array.from(new Set((shape.siblingParentSkus||shape.masterParentSkus||[]).concat(parent?[parent]:[]))),mixed=shape.kind==='variants'&&((shape.parentConflict&&!Array.isArray(shape.masterParentSkus))||parents.length>1);
    var preserve=mixed&&shape.originalParentKnown&&!shape.originalParentConflict,reason=shape.reason;
    if(shape.kind==='variants'&&!parent)reason='SKU Parent master belum tersedia. Periksa master sebelum ekspor.';
    if(mixed&&parent)reason=preserve?'Listing menggabungkan beberapa parent master. SKU Induk mengikuti template asli; SKU setiap variasi mengikuti master.':shape.originalParentConflict?'SKU Induk pada template asli berbeda dalam satu listing. Periksa template sebelum ekspor.':'SKU Induk asli untuk listing gabungan belum diketahui. Pilih template asli terbaru.';
    var ready=!!target&&!!target.sku&&!target.preview&&target.active!==false&&shape.kind!=='unknown'&&(shape.kind!=='variants'||!!parent)&&(!mixed||preserve);
    return {kind:shape.kind,ready:ready,parentSku:shape.kind==='single'?(target&&!target.preview&&target.sku||''):shape.kind==='variants'?(preserve?shape.originalParentSku:parent):'',sku:shape.kind==='variants'?(target&&!target.preview&&target.sku||''):'',gtin:target&&target.gtin||'',reason:reason,generatedParent:false,parentPolicy:preserve?'preserve_original':'master'};
  }
};
