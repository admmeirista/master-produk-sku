/** Skor heuristik untuk usulan, bukan probabilitas dan tidak pernah merupakan persetujuan. */
function shopeeMatchText_(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function shopeeMatchUnits_(value){
  const found=[];String(value||'').toLowerCase().replace(/(\d+(?:[.,]\d+)?)\s*(ml|liter|litre|kg|mg|gram|gr|g|l)\b/g,(_,n,u)=>{let num=Number(n.replace(',','.')),unit=/^(ml|liter|litre|l)$/.test(u)?'ml':'g';if(/^(liter|litre|l|kg)$/.test(u))num*=1000;if(u==='mg')num/=1000;found.push(String(num)+unit);return '';});return Array.from(new Set(found)).sort();
}
function shopeeMatchTokens_(value,brands){
  let s=String(value||'').toLowerCase().replace(/\d+(?:[.,]\d+)?\s*(ml|liter|litre|kg|mg|gram|gr|g|l)\b/g,' ').replace(/\b\d+\s*(pcs?|buah|sachet|saset|produk|pack)\b/g,' ');
  s=shopeeMatchText_(s);(brands||[]).forEach(b=>{s=(' '+s+' ').split(' '+shopeeMatchText_(b)+' ').join(' ').trim();});
  const stop=new Set('paket pack pcs pc buah produk product usaha satuan ecer eceran original ori asli promo hemat jual dijual dan dengan untuk perawatan kecil besar mini size ukuran terbaru new the a an'.split(' '));
  return Array.from(new Set(s.split(/\s+/).filter(w=>(w.length>1||/^\d+$/.test(w))&&!stop.has(w))));
}
function shopeeMatchSale_(row){
  const s=String(row.name||'')+' '+String(row.variationName||''),extract=v=>Array.from(new Set(Array.from(String(v||'').toLowerCase().matchAll(/\b(\d+)\s*(?:pcs?|buah|sachet|saset|pack|botol|tube|pot|biji|unit|lembar)\b/g),m=>Number(m[1])))),variantQty=/\b(satuan|ecer|eceran)\b/i.test(row.variationName||'')?[1]:extract(row.variationName),qty=variantQty.length?variantQty:extract(row.name);
  const mixed=/\b(campur|random|mix|pilih sendiri|boleh pilih|bebas pilih|bonus|gratis|extra|buy)\b/i.test(s)||/\+/.test(s);
  const bundle=/\b\d+\s*produk\b|\bbundl\w*\b/i.test(s);
  return {type:bundle?'bundle':qty.length===1&&qty[0]>1?'multipack':'single',quantity:qty.length===1?qty[0]:1,unclear:mixed||qty.length>1||qty.some(n=>n<1||n>1000)||(!qty.length&&/\b(paket|box|dus|lusin|kotak)\b/i.test(s)),mixed};
}
/** GTIN exact: hanya kode GTIN master, bukan barcode internal atau angka dari nama/SKU lama. */
function shopeeMatchGtinKey_(value){const s=String(value||'').trim().replace(/^'/,'').replace(/\s/g,'');return /^(?:\d{8}|\d{12,14})$/.test(s)?s.padStart(14,'0'):'';}
function shopeeMatchGtinValid_(key){if(!key)return false;let sum=0;for(let i=0;i<13;i++)sum+=Number(key[i])*(i%2===0?3:1);return (10-sum%10)%10===Number(key[13]);}
function shopeeMatchGtin_(row,index){
  const key=shopeeMatchGtinKey_(row.gtin);if(!key)return null;
  // SPF/PA dan daftar bahan dengan tanda plus tidak mengubah satu barang menjadi paket.
  const clean=value=>String(value||'').replace(/\b(?:spf\s*\d+\s*(?:pa)?|pa)\s*\++/gi,' ').replace(/\b(?:niacinamide|ceramide|hyaluronic acid|vitamin\s*[a-e])(?:\s*\+\s*(?:niacinamide|ceramide|hyaluronic acid|vitamin\s*[a-e]))+/gi,' ');
  const sale=shopeeMatchSale_({name:clean(row.name),variationName:clean(row.variationName)});
  if(sale.type!=='single'||sale.quantity!==1||sale.unclear)return null;
  const found=(index.byGtin||{})[key]||[];
  if(found.length!==1||found[0].target.kind!=='single')return {score:found.length?59:0,proposed:false,method:'gtin',reason:found.length?'GTIN terdaftar pada beberapa SKU atau bukan SKU satuan.':'GTIN Shopee belum ditemukan pada SKU aktif master.'};
  const doc=found[0],t=doc.target,text=' '+shopeeMatchText_(row.name+' '+(row.variationName||''))+' ',brands=Object.keys(index.brands).filter(id=>text.includes(' '+shopeeMatchText_(index.brands[id])+' '));
  const units=shopeeMatchUnits_(row.variationName),sizes=units.length?units:shopeeMatchUnits_(row.name),reasons=['GTIN Shopee sama persis dan unik di master'],conflicts=[];
  if(brands.length&&doc.brands.length&&!brands.some(id=>doc.brands.includes(id)))conflicts.push('Brand berbeda');
  if(sizes.length&&doc.units.length&&!doc.units.every(u=>sizes.includes(u)))conflicts.push('Ukuran berbeda');
  // Alias variasi boleh berbeda (Romantic/Rose); konflik terhadap varian lain yang eksplisit tetap manual.
  const vt=shopeeMatchTokens_(row.variationName,[]),own=doc.variants.filter(w=>vt.includes(w)).length;
  if(vt.length&&index.docs.some(d=>d.target.kind==='single'&&d.target.sku!==t.sku&&d.target.parentSku===t.parentSku&&d.variants.length&&d.variants.every(w=>vt.includes(w))&&d.variants.length>own))conflicts.push('Variasi mengarah ke SKU master lain');
  const valid=shopeeMatchGtinValid_(key);if(!valid)reasons.push('Digit pemeriksa GTIN perlu diverifikasi');
  return {score:conflicts.length?59:valid?99:94,proposed:!conflicts.length,method:'gtin',gtin:key,candidateSku:t.sku,candidateName:t.name,reason:reasons.concat(conflicts).join(' · '),brand:doc.brands.map(id=>index.brands[id]).join(' + ')};
}
function shopeeMatchIndex_(catalog){
  const brands={},docs=[],groups={},bySku={},byGtin={};
  Object.keys(catalog).forEach(s=>{const t=catalog[s];if(t.brandId&&t.brandName)brands[t.brandId]=t.brandName;});
  Object.keys(catalog).forEach(s=>{
    const t=catalog[s];if(!t.active||t.bundleType==='REQUEST_MIX')return;
    const cs=(t.components||[]),members=cs.map(c=>catalog[c.sku]).filter(Boolean),ids=Array.from(new Set((t.brandId?[t.brandId]:members.map(m=>m.brandId)).filter(Boolean))),names=ids.map(id=>brands[id]).filter(Boolean);
    const text=[t.name,t.productName].concat(cs.map(c=>c.name)).join(' '),doc={target:t,brands:ids,tokens:shopeeMatchTokens_(text,names),units:shopeeMatchUnits_(cs.map(c=>c.name).join(' ')||text),variants:shopeeMatchTokens_(t.variationName,names),quantity:cs.reduce((n,c)=>n+Number(c.quantity),0)};
    docs.push(doc);bySku[t.sku]=doc;const gtin=shopeeMatchGtinKey_(t.gtin);if(gtin)(byGtin[gtin]=byGtin[gtin]||[]).push(doc);ids.forEach(id=>{(groups[id]=groups[id]||[]).push(doc);});
  });return {brands,docs,groups,bySku,byGtin};
}
function shopeeMatchListing_(row,index,existing,semanticOnly){
  const exact=semanticOnly?null:(shopeeMatchCode_(row,index)||shopeeMatchGtin_(row,index));if(exact){if(existing&&exact.candidateSku!==existing.sku)return Object.assign({},exact,{proposed:false,score:Math.min(exact.score,59),reason:exact.reason+' · Target tersimpan berbeda; periksa kembali.'});return exact;}
  const text=String(row.name||'')+' '+String(row.variationName||''),normal=' '+shopeeMatchText_(text)+' ',brandIds=Object.keys(index.brands).filter(id=>{
    const words=shopeeMatchText_(index.brands[id]).split(/\s+/);return new RegExp('(?:^|\\s)'+words.join('\\s*')+'(?=\\s|$)').test(normal);
  });
  const brands=brandIds.map(id=>index.brands[id]),tokens=new Set(shopeeMatchTokens_(text,brands)),variantTokens=shopeeMatchTokens_(row.variationName,brands),variantUnits=shopeeMatchUnits_(row.variationName),units=variantUnits.length?variantUnits:shopeeMatchUnits_(text),sale=shopeeMatchSale_(row);
  function evaluate(doc,componentOnly){
    const t=doc.target,reasons=[],brand=brandIds.length===1&&doc.brands.length===1&&doc.brands[0]===brandIds[0],coverage=doc.tokens.length?doc.tokens.filter(w=>tokens.has(w)).length/doc.tokens.length:0;
    const unitMatch=units.length>0&&doc.units.length>0&&JSON.stringify(units)===JSON.stringify(doc.units),unitConflict=units.length>0&&doc.units.length>0&&!unitMatch;
    const matchedVariant=variantTokens.filter(w=>doc.tokens.includes(w)),colors=new Set('orange biru ungu pink marun warna pilihan hijau putih merah kuning blue purple violet'.split(' '));
    const rawVariant=shopeeMatchText_(row.variationName),explicitVariant=/^[a-z]$/.test(rawVariant)?shopeeMatchText_(t.variationName)===rawVariant:!variantTokens.length||matchedVariant.length===variantTokens.length||(matchedVariant.length/variantTokens.length>=.5&&matchedVariant.some(w=>!colors.has(w)));
    const variantMatch=explicitVariant&&(!doc.variants.length||doc.variants.every(w=>tokens.has(w))),quantity=componentOnly||t.kind===sale.type&&doc.quantity===sale.quantity;
    let score=Math.round((brand?18:0)+coverage*45+(unitMatch?12:!units.length&&!doc.units.length?6:0)+(variantMatch?15:0)+(quantity?10:0));
    if(brand)reasons.push('Brand '+brands[0]);else{score=Math.min(score,59);reasons.push(brandIds.length>1?'Terdapat beberapa brand':'Brand belum cocok');}
    reasons.push('Nama '+Math.round(coverage*100)+'%');
    if(unitMatch)reasons.push('Ukuran sesuai');if(unitConflict){score=Math.min(score,39);reasons.push('Ukuran berbeda');}
    if(!variantMatch){score=Math.min(score,59);reasons.push('Varian belum sesuai');}
    if(quantity)reasons.push('Jenis dan qty sesuai');else{score=Math.min(score,39);reasons.push('Jenis atau qty berbeda');}
    if(coverage<.65)score=Math.min(score,55);
    if(sale.unclear||t.kind==='bundle'){score=Math.min(score,59);reasons.push('Komposisi paket perlu diperiksa');}
    return {doc,score:Math.min(99,Math.max(0,score)),safe:brand&&coverage>=.8&&!unitConflict&&variantMatch&&quantity&&!sale.unclear&&t.kind!=='bundle',reasons};
  }
  if(existing){const doc=index.bySku[existing.sku];if(!doc)return null;const match=evaluate(doc);return {score:match.score,proposed:false,candidateSku:existing.sku,reason:match.reasons.join(' · '),brand:brands.join(' + ')};}
  const pool=brandIds.length?Array.from(new Set(brandIds.flatMap(id=>index.groups[id]||[]))):[];
  const ranked=pool.map(d=>evaluate(d,false)).sort((a,b)=>b.score-a.score||a.doc.target.sku.localeCompare(b.doc.target.sku));
  if(sale.type==='multipack'&&!sale.unclear&&!ranked.some(m=>m.safe&&m.score>=82)){
    const units=pool.filter(d=>d.target.kind==='single').map(d=>evaluate(d,true)).sort((a,b)=>b.score-a.score||a.doc.target.sku.localeCompare(b.doc.target.sku));
    const first=units[0],unique=first&&(!units[1]||first.score-units[1].score>=8);
    if(first&&first.safe&&first.score>=82&&unique){
      const sku=first.doc.target.sku,exists=index.docs.some(d=>d.target.kind==='multipack'&&d.quantity===sale.quantity&&d.target.components.length===1&&d.target.components[0].sku===sku);
      if(!exists)return {score:first.score,proposed:true,needsPackage:true,componentSku:sku,quantity:sale.quantity,candidateSku:sku,candidateName:first.doc.target.name,reason:first.reasons.join(' · ')+' · Paket '+sale.quantity+' pcs belum ada; perlu dibuat saat pemeriksaan.',brand:brands.join(' + ')};
    }
  }
  if(!ranked.length)return {score:0,proposed:false,reason:'Brand atau SKU aktif belum ditemukan di master.',brand:brands.join(' + ')};
  const best=ranked[0],ambiguous=ranked.length>1&&best.score-ranked[1].score<8;
  if(ambiguous){best.score=Math.min(best.score,74);best.reasons.push('Beberapa SKU memiliki kecocokan serupa');}
  return {score:best.score,proposed:best.safe&&best.score>=82&&!ambiguous,candidateSku:best.doc.target.sku,candidateName:best.doc.target.name,reason:best.reasons.join(' · '),brand:brands.join(' + '),alternatives:ranked.slice(1,3).map(m=>({sku:m.doc.target.sku,name:m.doc.target.name,score:Math.min(m.score,ambiguous?74:99)}))};
}
/** Usulan hanya pada snapshot UI; tidak mengubah keputusan/komposisi yang tersimpan. */
function shopeeAnalyzeViews_(views){
  if(!views.length)return {analyzed:0,proposed:0};
  const catalog=shopeeCatalog_(undefined,true),index=shopeeMatchIndex_(catalog),pending=[];let analyzed=0,proposed=0;
  views.forEach(r=>{
    if(r.status==='ignored')return;
    const unavailable=!(r.target&&r.target.active)&&!r.reviewRequested&&!r.reviewedAt&&r.status!=='approved';
    const editable=!['approved','ignored'].includes(r.status)&&!r.reviewedAt&&!r.reviewRequested;
    const exact=editable?(shopeeMatchCode_(r,index)||shopeeMatchGtin_(r,index)):null;
    r.match=exact||shopeeMatchListing_(r,index,unavailable?null:r.target);
    if(exact&&exact.proposed){analyzed++;pending.push(r);return;}
    if(!unavailable)return;analyzed++;
    if(!r.match||!r.match.proposed)return;
    if(r.match.needsPackage){r.previousTargetSku=r.targetSku;r.target=null;r.targetSku='';r.status='needs_review';r.reviewRequested=true;r.saleType='multipack';r.quantity=r.match.quantity;r.expectedComponents=[{sku:r.match.componentSku,quantity:r.match.quantity}];proposed++;return;}
    pending.push(r);
  });
  // Hitung signature hanya untuk kandidat yang benar-benar ditampilkan, bukan seluruh master.
  const targets=pending.length?shopeeCatalog_(Array.from(new Set(pending.map(r=>r.match.candidateSku)))):{};
  pending.forEach(r=>{const t=targets[r.match.candidateSku];if(!t||!t.active)return;r.previousTargetSku=r.targetSku;r.target=t;r.targetSku=t.sku;r.status='suggested';r.saleType=t.kind;r.quantity=t.components.reduce((n,c)=>n+c.quantity,0);r.expectedComponents=t.components.map(c=>({sku:c.sku,quantity:c.quantity}));proposed++;});
  return {analyzed,proposed};
}
