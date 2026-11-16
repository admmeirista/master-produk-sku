/** Nama kategori harus dibandingkan dalam konteks seluruh jalurnya. */
function qualityCategoryDuplicates_(rows) {
  const all=indexBy_(rows,'CategoryID'),groups={},paths={},seenGroups=new Set(),out=[];
  function path(r,seen){
    if(paths[r.CategoryID])return paths[r.CategoryID];
    if(seen.has(r.CategoryID))return '[siklus:'+r.CategoryID+']';
    const next=new Set(seen);next.add(r.CategoryID);
    const parent=r.ParentID?(all[r.ParentID]?path(all[r.ParentID],next):'[induk:'+r.ParentID+']'):'';
    return paths[r.CategoryID]=parent?parent+' > '+r.CategoryName:(r.FullPath||r.CategoryName||'');
  }
  rows.filter(r=>![STATUS.DELETED,STATUS.ARCHIVED].includes(r.Status)).forEach(r=>{
    const label=path(r,new Set()),key=label.split('>').map(masterNameKey).join('>');
    if(masterNameKey(r.CategoryName))(groups['path:'+key]=groups['path:'+key]||[]).push(r);
    if(r.ExternalSource&&r.ExternalID){const id='external:'+String(r.ExternalSource).toLowerCase()+':'+r.ExternalID;(groups[id]=groups[id]||[]).push(r);}
  });
  Object.keys(groups).forEach(key=>{const items=groups[key];if(items.length<2)return;const identity=items.map(r=>r.CategoryID).sort().join('|');if(seenGroups.has(identity))return;seenGroups.add(identity);out.push({name:items.map(r=>r.CategoryName).join(' | '),path:items.map(r=>paths[r.CategoryID]).join(' | '),categoryIds:items.map(r=>r.CategoryID).join(' | '),reason:key.startsWith('external:')?'ID kanal sama':'Jalur kategori sama'});});
  return out;
}
/** Persiapan nama sekali per parent; batas panjang menghindari edit distance yang pasti di bawah 90%. */
function qualityParentPairs_(products,brands) {
  const pairs=[],prepared={};
  products.forEach(p=>prepared[p.ProductID]={key:masterNameKey(p.ProductName),name:prepareNameSimilarity_(p.ProductName)});
  Object.values(groupBy_(products,'BrandID')).forEach(list=>{
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      const a=list[i],b=list[j],pa=prepared[a.ProductID],pb=prepared[b.ProductID];
      if(!pa.key||!pb.key)continue;
      let score;
      if(pa.key===pb.key)score=1;
      else {
        const x=pa.name,y=pb.name;
        if(x.sizes&&y.sizes&&x.sizes!==y.sizes)continue;
        let common=0;x.tokens.forEach(t=>{if(y.tokens.has(t))common++;});
        const bound=(x,y)=>Math.min(x.length,y.length)/Math.max(x.length,y.length);
        if(Math.max(common/(x.tokens.size+y.tokens.size-common),bound(x.normalized,y.normalized),bound(x.sorted,y.sorted))<0.8995)continue;
        score=nameSimilarityPrepared_(x,y);
      }
      if(score>=0.9)pairs.push({brand:(brands[a.BrandID]||{}).BrandName,a:a.ProductName+' ('+a.ProductCode+')',b:b.ProductName+' ('+b.ProductCode+')',score:(Math.round(score*1000)/10)+'%',productId:a.ProductID,productId2:b.ProductID,_score:score});
    }
  });
  pairs.sort((a,b)=>b._score-a._score||String(a.productId).localeCompare(String(b.productId))||String(a.productId2).localeCompare(String(b.productId2)));
  return pairs.map(p=>{delete p._score;return p;});
}
