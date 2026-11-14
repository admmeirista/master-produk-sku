/** Listing Shopee disimpan meskipun belum dipetakan. Persetujuan selalu memeriksa identitas SKU dan BOM. */
const SHOPEE_REVIEW_STATES = ['unmapped', 'suggested', 'needs_review', 'approved', 'ignored'];
function shopeeKey_(store, pid, vid) { return JSON.stringify([String(store || '').trim().toLowerCase(), String(pid), String(vid || '')]); }
function shopeeSignature_(value) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8)); }
function shopeeComponents_(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new AppError('Isi paket wajib ditentukan dari SKU barang dan jumlahnya.');
  const seen = {};
  return rows.map((r) => {
    const sku = String(r.sku || '').trim().toUpperCase(), quantity = Number(r.quantity);
    if (!/^PRD\d{6}-\d{3}$/.test(sku) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000 || seen[sku]) throw new AppError('Komponen harus SKU barang yang unik dengan jumlah bulat positif.');
    seen[sku] = 1; return { sku, quantity };
  }).sort((a, b) => a.sku.localeCompare(b.sku));
}
function shopeeCompositionKey_(rows) { return JSON.stringify(shopeeComponents_(rows)); }

/** Cache hanya pada objek Table per permintaan; tidak menyimpan GTIN/BOM lama antar permintaan. */
function shopeeCatalog_() {
  const V = db_('PRODUCT_VARIANTS');
  if (V._shopeeCatalog) return V._shopeeCatalog;
  const P = indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID'), B = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const bySku = {}, byId = {}, bundleCodes = {}, bundleInternal = {}, comps = {};
  db_('VARIANT_BARCODES').rows().filter((r) => r.Status === 'ACTIVE' && r.BundleID).forEach((r) => { if(r.BarcodeType === 'GTIN') bundleCodes[r.BundleID] = r.Code; else if(r.BarcodeType === 'INTERNAL') bundleInternal[r.BundleID] = r.Code; });
  V.rows().forEach((v) => {
    const p = P[v.ProductID]; if (!p || !v.SKU || v.Status === STATUS.DELETED || p.Status === STATUS.DELETED) return;
    const active = v.Status === STATUS.ACTIVE && p.Status === STATUS.ACTIVE;
    const t = { sku: v.SKU, kind: 'single', name: variantDisplayName_(v) || cleanText((B[p.BrandID] || {}).BrandName + ' ' + p.ProductName + ' ' + (v.IsDefault ? '' : v.VariantName)), parentSku: p.ProductCode, gtin: v.GTIN || '', internalBarcode: v.InternalBarcode || '', active, productId: p.ProductID, variantId: v.VariantID, bundleId: '', unit: v.BaseUnit || p.BaseUnit, components: [{ sku: v.SKU, quantity: 1, name: variantDisplayName_(v), gtin: v.GTIN || '' }] };
    t.productName = p.ProductName || t.name;
    t.variationName = v.IsDefault ? '' : v.VariantName || '';
    t.signature = shopeeSignature_([t.sku, t.name, t.gtin, t.active, t.components]); bySku[t.sku] = byId[v.VariantID] = t;
  });
  db_('BUNDLE_COMPONENTS').rows().filter((c) => c.Status === STATUS.ACTIVE).forEach((c) => { (comps[c.BundleID] = comps[c.BundleID] || []).push(c); });
  db_('BUNDLE_MASTERS').rows().forEach((b) => {
    if (b.Status === STATUS.DELETED) return;
    const raw = comps[b.BundleID] || [], cs = raw.map((c) => ({ sku: (byId[c.VariantID] || {}).sku || '', quantity: Number(c.Quantity), name: (byId[c.VariantID] || {}).name || 'SKU komponen tidak ditemukan', gtin: (byId[c.VariantID] || {}).gtin || '' }));
    const parents = Array.from(new Set(raw.map((c) => (byId[c.VariantID] || {}).parentSku).filter(Boolean)));
    const t = { sku: b.BundleSKU, kind: b.BundleType === 'MULTIPACK' ? 'multipack' : 'bundle', status: b.Status, name: b.BundleName, parentSku: parents.length === 1 ? parents[0] : '', gtin: bundleCodes[b.BundleID] || '', internalBarcode: bundleInternal[b.BundleID] || '', active: b.Status === STATUS.ACTIVE && raw.length > 0 && raw.every((c) => byId[c.VariantID] && byId[c.VariantID].active), productId: '', variantId: '', bundleId: b.BundleID, unit: 'PAKET', bundleType: b.BundleType, components: cs };
    t.productName = b.BundleName;
    t.variationName = Array.from(new Set(raw.map((c) => (byId[c.VariantID] || {}).variationName).filter(Boolean))).join(' + ');
    t.signature = shopeeSignature_([t.sku, t.name, t.gtin, t.active, b.BundleType, cs].concat(t.internalBarcode ? [t.internalBarcode] : [])); bySku[t.sku] = t;
  });
  V._shopeeCatalog = bySku; return bySku;
}
function shopeeTarget_(sku) {
  const t = shopeeCatalog_()[String(sku || '').trim().toUpperCase()];
  if (!t) throw new AppError('SKU barang / MP / BD tidak ditemukan di master.');
  return t;
}
function shopeeValidateTarget_(row, target) {
  const errs = [];
  if (!target || !target.active) return ['SKU atau komponen master tidak aktif / tidak ditemukan.'];
  if (!['single', 'multipack', 'bundle'].includes(row.SaleType) || row.SaleType !== target.kind) errs.push('Jenis penjualan tidak sesuai: satuan memakai SKU barang, paket sama memakai MP, kombinasi memakai BD.');
  if (target.bundleType === 'REQUEST_MIX') errs.push('Paket pilih sendiri belum memiliki komposisi tetap; gunakan BD dengan isi tetap untuk persetujuan ini.');
  const qty = Number(row.SaleQuantity), total = target.components.reduce((s, c) => s + c.quantity, 0);
  if (!Number.isSafeInteger(qty) || qty < 1 || qty !== total) errs.push('Jumlah barang dalam penjualan berbeda dari komposisi master.');
  if (target.kind === 'single' && qty !== 1) errs.push('SKU barang hanya untuk penjualan satuan.');
  if (target.kind === 'multipack' && (target.components.length !== 1 || total < 2)) errs.push('MP harus berisi satu SKU barang yang sama sebanyak minimal 2 pcs.');
  try { if (shopeeCompositionKey_(row.ExpectedComponents) !== shopeeCompositionKey_(target.components)) errs.push('Jenis/varian atau jumlah komponen tidak sama dengan master.'); }
  catch (e) { errs.push(e.message); }
  return errs;
}
function shopeeStatus_(r, catalog) {
  const target = catalog[r.TargetSku];
  if (r.ReviewStatus === 'ignored') return 'ignored';
  if (r.TargetSku && (!target || !target.active || (r.ReviewStatus === 'approved' && r.ReviewedTargetSignature !== target.signature) || shopeeValidateTarget_(r, target).length)) return 'mismatch';
  return SHOPEE_REVIEW_STATES.includes(r.ReviewStatus) ? r.ReviewStatus : 'unmapped';
}
function shopeeView_(r, catalog) {
  const t = catalog[r.TargetSku] || null, status = shopeeStatus_(r, catalog);
  return { id: r.ListingID, store: r.StoreAccount, productId: r.ExternalProductId, variationId: r.ExternalVariationId || '', name: r.ListingName, variationName: r.VariationName || '', parentSku: r.ExternalParentSku || '', sellerSku: r.ExternalSku || '', gtin: r.ExternalGTIN || '', price: r.Price || 0, stock: r.Stock || 0, saleType: r.SaleType || 'unclear', quantity: r.SaleQuantity || '', expectedComponents: r.ExpectedComponents || [], targetSku: r.TargetSku || '', target: t, status, note: r.ReviewNote || '', reviewer: r.ReviewedBy || '', reviewedAt: r.ReviewedAt || '', version: Number(r.Version) || 1, source: r.SourceFile || '', sourceRow: r.SourceRow || '', importedAt: r.ImportedAt || '', skuMatches: !!t && r.ExternalSku === t.sku, gtinMatches: !!t && !!t.gtin && r.ExternalGTIN === t.gtin, issues: r.TargetSku ? shopeeValidateTarget_(r, t).concat(status === 'mismatch' && r.ReviewStatus === 'approved' ? ['Master berubah setelah persetujuan; periksa kembali.'] : []) : [] };
}
function shopeeDisplayStatus_(r, catalog) {
  if (shopeeStatus_(r, catalog) === 'approved') return 'approved';
  return catalog[r.TargetSku] && catalog[r.TargetSku].active ? 'verify' : 'unavailable';
}
function shopeeList_(f) {
  const cacheKey = 'sl5:' + dataVersion_() + ':' + shopeeSignature_(f || {});
  const cached = cacheGetBig_(cacheKey); if (cached) return cached;
  f = f || {}; const catalog = shopeeCatalog_(), q = String(f.search || '').toLowerCase(), summary = { all: 0, unmapped: 0, suggested: 0, needs_review: 0, approved: 0, mismatch: 0, ignored: 0 }, stores = new Set();
  let all = db_('SHOPEE_LISTINGS').rows().filter((r) => { stores.add(r.StoreAccount); return !f.store || r.StoreAccount === f.store; });
  summary.verify = 0; summary.unavailable = 0;
  all.forEach((r) => { summary.all++; summary[shopeeStatus_(r, catalog)]++; const st = shopeeDisplayStatus_(r, catalog); if (st !== 'approved') summary[st]++; });
  if (['verify', 'unavailable'].includes(f.status)) { all = all.filter((r) => shopeeDisplayStatus_(r, catalog) === f.status); f = Object.assign({}, f, { status: '' }); }
  all = all.filter((r) => (!f.status || (f.status === 'pending' ? !['approved', 'suggested'].includes(shopeeStatus_(r, catalog)) : f.status === 'review' ? ['needs_review', 'mismatch'].includes(shopeeStatus_(r, catalog)) : shopeeStatus_(r, catalog) === f.status)) && (!f.kind || r.SaleType === f.kind) && (!f.withStock || Number(r.Stock) > 0) && (!q || [r.ListingName, r.VariationName, r.ExternalProductId, r.ExternalVariationId, r.ExternalSku, r.ExternalParentSku, r.ExternalGTIN, r.TargetSku, (catalog[r.TargetSku] || {}).name, (catalog[r.TargetSku] || {}).gtin].join(' ').toLowerCase().includes(q)));
  const page = paginate_(all, f.page, Math.min(Math.max(Number(f.pageSize) || 30, 1), 100));
  page.rows = page.rows.map((r) => shopeeView_(r, catalog)); page.summary = summary; page.stores = Array.from(stores).sort();
  cachePutBig_(cacheKey, page); return page;
}
function shopeeGet_(id) {
  const r = db_('SHOPEE_LISTINGS').byId(id); if (!r) throw new AppError('Listing Shopee tidak ditemukan.');
  return shopeeView_(r, shopeeCatalog_());
}
function shopeeInferSale_(name, variation) {
  const s = (String(name || '') + ' ' + String(variation || '')).toLowerCase();
  if (/\b(paket|bundl\w*|mix|campur|random|box|kotak|dus|lusin|gratis|bonus|extra|buy)\b|\+\s*\d/.test(s)) return { type: 'unclear', quantity: '' };
  const qty = Array.from(new Set(Array.from(s.matchAll(/\b(\d+)\s*(?:pcs?|buah|sachet|saset)\b/g), (m) => Number(m[1]))));
  if (qty.length > 1 || (qty.length && qty[0] < 1)) return { type: 'unclear', quantity: '' };
  return { type: qty.length && qty[0] > 1 ? 'multipack' : 'single', quantity: qty[0] || 1 };
}
function shopeeDisableMapping_(r) {
  db_('EXTERNAL_SKU_MAPPINGS').filter((m) => m.System === 'shopee' && m.IsActive && shopeeKey_(m.StoreAccount, m.ExternalProductId, m.ExternalVariationId) === shopeeKey_(r.StoreAccount, r.ExternalProductId, r.ExternalVariationId)).forEach((m) => db_('EXTERNAL_SKU_MAPPINGS').update(m, { IsActive: false, UpdatedAt: now_() }));
}
/** Upsert dibatasi 200 baris per transaksi; identitas tidak pernah memakai nomor baris Excel. */
function shopeeImport_(user, p) {
  const store = cleanText(p.store || 'Meirista');
  if (!store || store.length > 60 || !Array.isArray(p.rows) || !p.rows.length || p.rows.length > 200) throw new AppError('Toko wajib diisi dan kirim 1–200 baris per batch.');
  const T = db_('SHOPEE_LISTINGS'), index = {}, seen = {}, prepared = [], catalog = shopeeCatalog_();
  T.rows().forEach((r) => { index[shopeeKey_(r.StoreAccount, r.ExternalProductId, r.ExternalVariationId)] = r; });
  p.rows.forEach((x, i) => {
    if ((typeof x.productId === 'number' && !Number.isSafeInteger(x.productId)) || (typeof x.variationId === 'number' && !Number.isSafeInteger(x.variationId))) throw new AppError('ID produk/variasi harus dikirim sebagai teks agar tidak kehilangan digit.');
    const pid = String(x.productId || '').trim(), vid = String(x.variationId === 0 ? '0' : x.variationId || '').trim();
    if (!/^\d{3,25}$/.test(pid) || (vid && !/^\d{1,25}$/.test(vid)) || !cleanText(x.name)) throw new AppError('Baris ' + (i + 1) + ': ID produk, ID variasi, atau nama tidak valid.');
    const key = shopeeKey_(store, pid, vid); if (seen[key]) throw new AppError('Listing/variasi duplikat dalam batch: ' + pid + '/' + vid); seen[key] = true;
    const price = Number(x.price || 0), stock = Number(x.stock || 0);
    if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) throw new AppError('Harga/stok tidak valid pada baris ' + (i + 1));
    prepared.push({ key, values: { StoreAccount: store, ExternalProductId: pid, ExternalVariationId: vid, ListingName: cleanText(x.name).slice(0, 1500), VariationName: cleanText(x.variationName).slice(0, 500), ExternalParentSku: String(x.parentSku || '').trim().slice(0, 100), ExternalSku: String(x.sellerSku || '').trim().slice(0, 100), ExternalGTIN: String(x.gtin || '').trim().slice(0, 50), Price: price, Stock: stock, SourceFile: cleanText(p.fileName || 'Import Shopee').slice(0, 200), SourceRow: Number(x.sourceRow) || '', ImportedAt: now_(), UpdatedAt: now_() } });
  });
  const rep = { created: 0, updated: 0 };
  prepared.forEach((entry) => {
    const old = index[entry.key], v = entry.values;
    if (old) {
      const identityChanged = old.ListingName !== v.ListingName || (old.VariationName || '') !== v.VariationName || ((old.ExternalGTIN || '') !== v.ExternalGTIN && (!catalog[old.TargetSku] || v.ExternalGTIN !== catalog[old.TargetSku].gtin)) || ((old.ExternalSku || '') !== v.ExternalSku && v.ExternalSku !== old.TargetSku);
      if (identityChanged) { shopeeDisableMapping_(old); Object.assign(v, { ReviewStatus: 'needs_review', ReviewNote: 'Data Shopee berubah sejak pemeriksaan sebelumnya; periksa ulang nama, variasi, dan komposisi.', ReviewedBy: '', ReviewedAt: '', ReviewedTargetSignature: '' }); }
      else db_('EXTERNAL_SKU_MAPPINGS').filter((m) => m.System === 'shopee' && m.IsActive && shopeeKey_(m.StoreAccount, m.ExternalProductId, m.ExternalVariationId) === entry.key).forEach((m) => db_('EXTERNAL_SKU_MAPPINGS').update(m, { ExternalSku: v.ExternalSku, ExternalParentSku: v.ExternalParentSku, ListingName: v.ListingName, UpdatedAt: now_() }));
      T.update(old, Object.assign(v, { Version: Number(old.Version || 1) + 1 })); rep.updated++;
    } else {
      const sale = shopeeInferSale_(v.ListingName, v.VariationName), target = shopeeSuggest_(v, sale, catalog);
      // Hanya usulan; kesamaan kode saja tidak pernah menyetujui sebuah paket secara otomatis.
      const suggested = !!target;
      T.insert(Object.assign(v, { ListingID: uuid_(), Version: 1, SaleType: sale.type, SaleQuantity: sale.quantity, ExpectedComponents: suggested ? target.components.map((c) => ({ sku: c.sku, quantity: c.quantity })) : [], TargetSku: suggested ? target.sku : '', ReviewStatus: suggested ? 'suggested' : 'unmapped', ReviewNote: 'Snapshot impor Shopee; periksa nama, variasi, SKU, dan isi paket sebelum disetujui.' })); rep.created++;
    }
  });
  audit_(user.email, 'shopee.import', 'shopee_listing', '', null, rep, { fileName: p.fileName, store });
  rep.rows = prepared.map((entry) => shopeeView_(T.rows().find((r) => shopeeKey_(r.StoreAccount, r.ExternalProductId, r.ExternalVariationId) === entry.key), catalog));
  return rep;
}

/** Usulan baru hanya dari nama persis/GTIN unik dengan jenis dan jumlah yang sesuai. Tetap perlu persetujuan. */
function shopeeSuggest_(v, sale, catalog) {
  if (sale.type === 'unclear') return null;
  const name = masterNameKey(v.ListingName + ' ' + (v.VariationName || ''));
  const candidates = Object.keys(catalog).map((sku) => catalog[sku]).filter((t) => t.active && t.bundleType !== 'REQUEST_MIX' && t.kind === sale.type && t.components.reduce((n, c) => n + c.quantity, 0) === sale.quantity && (masterNameKey(t.name) === name || (sale.type === 'single' && v.ExternalGTIN && t.gtin === v.ExternalGTIN)));
  // Kode lama yang kebetulan sama tidak cukup untuk mengalahkan nama/variasi yang berbeda.
  return candidates.length === 1 ? candidates[0] : null;
}

/** Verifikasi ulang saat unduh; pasangan usulan/stale tidak pernah ikut menimpa template. */
function shopeeExport_(p) {
  if (!Array.isArray(p.rows) || !p.rows.length || p.rows.length > 200) throw new AppError('Kirim 1–200 baris untuk pemeriksaan unduhan.');
  const catalog = shopeeCatalog_(), store = p.store || 'Meirista', index = {};
  db_('SHOPEE_LISTINGS').rows().forEach((r) => { index[shopeeKey_(r.StoreAccount, r.ExternalProductId, r.ExternalVariationId)] = r; });
  return p.rows.map((x) => {
    const r = index[shopeeKey_(store, x.productId, x.variationId)];
    const same = r && r.ListingName === cleanText(x.name) && (r.VariationName || '') === cleanText(x.variationName) && (r.ExternalSku || '') === String(x.sellerSku || '').trim() && (r.ExternalGTIN || '') === String(x.gtin || '').trim() && (r.ExternalParentSku || '') === String(x.parentSku || '').trim();
    if (!same) return { productId: x.productId, variationId: x.variationId, eligible: false, reason: 'Data listing berbeda dari file. Unggah ulang dan periksa kembali.' };
    const status = shopeeStatus_(r, catalog), t = catalog[r.TargetSku];
    return { productId: x.productId, variationId: x.variationId, eligible: status === 'approved', reason: status === 'approved' ? '' : SHOPEE_REVIEW_STATES.includes(status) ? 'Belum disetujui' : 'Master berubah; periksa kembali', sku: status === 'approved' ? t.sku : '', parentSku: status === 'approved' ? t.parentSku : '', gtin: status === 'approved' ? t.gtin : '' };
  });
}
function shopeeExportSelected_(p) {
  if(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>200||p.ids.some((id)=>typeof id!=='string'||!id)||new Set(p.ids).size!==p.ids.length)throw new AppError('Pilih 1–200 identitas listing yang unik.');
  const T=db_('SHOPEE_LISTINGS'),catalog=shopeeCatalog_(),rows=[],rejected=[];
  p.ids.forEach((id)=>{const r=T.byId(id);if(!r||shopeeStatus_(r,catalog)!=='approved'){rejected.push({id,reason:r?'Status bukan Disetujui atau master telah berubah.':'Listing tidak ditemukan.'});return;}rows.push(shopeeView_(r,catalog));});
  return {rows,rejected};
}
function shopeeReview_(user, p) {
  const T = db_('SHOPEE_LISTINGS'), r = T.byId(p.id);
  if (!r) throw new AppError('Listing tidak ditemukan.');
  if (Number(p.version) !== Number(r.Version || 1)) throw new AppError('Listing sudah diubah pengguna lain. Muat ulang sebelum menyimpan.', [], 'CONFLICT');
  const action = p.action || 'approve', note = cleanText(p.note).slice(0, 4000);
  if (!['approve', 'needs_review', 'ignored'].includes(action)) throw new AppError('Tindakan pemeriksaan tidak dikenal.');
  const patch = { ReviewNote: note, ReviewedBy: user.email, ReviewedAt: now_(), UpdatedAt: now_(), Version: Number(r.Version || 1) + 1 };
  let packageCreated = false;
  if (action === 'approve') {
    if (p.selection) {
      const resolved = shopeePackageResolve_(p.selection);
      if (p.selection.signature !== resolved.signature) throw new AppError('Data SKU barang berubah. Periksa kembali pilihan paket.', [], 'CONFLICT');
      if (resolved.blocked) throw new AppError(resolved.blocked);
      let target = resolved.target;
      if (!target) {
        if (p.createPackage !== true) throw new AppError('Paket belum ada. Gunakan tombol Buat paket baru & setujui.');
        assertPerm_(user, 'product.write');
        const catalog = shopeeCatalog_();
        const nameBase = resolved.name.slice(0, 120); let name = nameBase, suffix = 1;
        while (db_('BUNDLE_MASTERS').find((b) => b.Status !== STATUS.ARCHIVED && b.NameKey === masterNameKey(name))) name = nameBase.slice(0, 108) + ' (' + (++suffix) + ')';
        const saved = bundleSave_(user, { type: resolved.saleType === 'multipack' ? 'MULTIPACK' : 'MIXED', name, stockMode: 'VIRTUAL', components: resolved.components.map((c) => ({ variantId: catalog[c.sku].variantId, quantity: c.quantity })), barcode:p.barcode, description: 'Dibuat saat pemetaan listing Shopee ' + r.ExternalProductId });
        delete db_('PRODUCT_VARIANTS')._shopeeCatalog;
        target = shopeeTarget_(saved.sku); packageCreated = true;
      } else if (p.sku && (p.sku !== target.sku || p.targetSignature !== target.signature)) throw new AppError('Master paket berubah. Periksa kembali pilihan paket.', [], 'CONFLICT');
      else if (!p.sku && p.barcode) { if(p.barcode.mode!=='none' && !shopeeBarcodeSame_(target,p.barcode))throw new AppError('Paket baru dibuat pengguna lain. Periksa kembali barcode paket.',[],'CONFLICT'); p=Object.assign({},p,{barcode:null}); }
      p = Object.assign({}, p, { sku: target.sku, targetSignature: target.signature, saleType: resolved.saleType, quantity: resolved.quantity, components: resolved.components });
    }
    let target = shopeeTarget_(p.sku);
    if (p.targetSignature !== target.signature) throw new AppError('Master berubah sejak pratinjau. Pilih ulang SKU dan periksa GTIN/komposisi terbaru.', [], 'CONFLICT');
    Object.assign(patch, { SaleType: p.saleType, SaleQuantity: Number(p.quantity), ExpectedComponents: shopeeComponents_(p.components), TargetSku: target.sku });
    const errors = shopeeValidateTarget_(Object.assign({}, r, patch), target);
    if (errors.length) throw new AppError(errors.join(' '), [], 'VALIDATION_FAILED');
    if (p.barcode && target.kind !== 'single' && !shopeeBarcodeSame_(target,p.barcode)) {
      assertPerm_(user,'product.write');
      const b=db_('BUNDLE_MASTERS').byId(target.bundleId);
      bundleSave_(user,{id:b.BundleID,version:b.Version,name:b.BundleName,stockMode:b.StockMode,components:target.components.map((c)=>({variantId:shopeeCatalog_()[c.sku].variantId,quantity:c.quantity})),barcode:p.barcode,barcodeChangeReason:note||'Diperbarui melalui pemetaan Shopee'});
      delete db_('PRODUCT_VARIANTS')._shopeeCatalog;target=shopeeTarget_(target.sku);
    }
    Object.assign(patch, { ReviewStatus: 'approved', ReviewedTargetSignature: target.signature });
    shopeeUpsertMapping_(user, r, target, note);
  } else {
    if (note.length < 3) throw new AppError('Alasan pemeriksaan wajib diisi.');
    Object.assign(patch, { ReviewStatus: action, ReviewedTargetSignature: '' }); shopeeDisableMapping_(r);
  }
  const before = { targetSku: r.TargetSku, status: r.ReviewStatus };
  T.update(r, patch); audit_(user.email, 'shopee.' + action, 'shopee_listing', r.ListingID, before, { targetSku: r.TargetSku, status: r.ReviewStatus }, { note });
  return Object.assign(shopeeView_(r, shopeeCatalog_()), { packageCreated });
}
function shopeeBarcodeSame_(target,input){const mode=target.gtin?'gtin':target.internalBarcode?'internal':'none';return input.mode===mode&&(mode==='none'||(mode==='internal'&&!input.code)||cleanBarcode(input.code)===(target.gtin||target.internalBarcode||''));}

/** Definisi penjualan hanya satu sumber: jenis + baris Child SKU dan jumlah. */
function shopeePackageResolve_(p) {
  const saleType = p.saleType;
  if (!['single', 'multipack', 'bundle'].includes(saleType)) throw new AppError('Pilih Satuan, MP, atau BD.');
  const components = shopeeComponents_(p.components), catalog = shopeeCatalog_();
  if (components.some((c) => !catalog[c.sku] || catalog[c.sku].kind !== 'single' || !catalog[c.sku].active)) throw new AppError('Pilih SKU barang aktif untuk seluruh baris.');
  if (components.some((c) => c.quantity > 1000)) throw new AppError('Jumlah per SKU maksimal 1.000.');
  if (saleType === 'single' && (components.length !== 1 || components[0].quantity !== 1)) throw new AppError('Satuan memakai satu SKU barang dengan jumlah 1.');
  if (saleType === 'multipack' && (components.length !== 1 || components[0].quantity < 2)) throw new AppError('MP memakai satu SKU barang dengan jumlah minimal 2.');
  if (saleType === 'bundle' && components.length < 2) throw new AppError('BD memakai minimal dua SKU barang berbeda.');
  const quantity = components.reduce((n, c) => n + c.quantity, 0);
  const signature = shopeeSignature_([saleType, components.map((c) => [c.sku, c.quantity, catalog[c.sku].signature])]);
  if (saleType === 'single') return { saleType, components, quantity, signature, target: catalog[components[0].sku], name: catalog[components[0].sku].name, blocked: '' };
  const key = shopeeCompositionKey_(components);
  const matches = Object.keys(catalog).map((sku) => catalog[sku]).filter((t) => { if (t.kind !== saleType || t.status === STATUS.ARCHIVED || t.bundleType === 'REQUEST_MIX' || !t.components.length) return false; try { return shopeeCompositionKey_(t.components) === key; } catch (e) { return false; } }).sort((a, b) => a.sku.localeCompare(b.sku));
  const active = matches.filter((t) => t.active), target = active.find((t) => t.sku === p.preferredSku) || active[0] || null;
  // MP nonaktif/draf dengan komposisi sama tidak boleh digandakan (aturan master paket).
  const blocked = !target && matches.length ? 'Paket yang sama sudah ada tetapi belum aktif: ' + matches[0].sku + '. Aktifkan paket tersebut sebelum digunakan.' : '';
  return { saleType, components, quantity, signature, target, blocked, name: saleType === 'multipack' ? 'Paket ' + quantity + ' × ' + catalog[components[0].sku].name : 'Paket Kombinasi ' + components.map((c) => c.quantity + ' × ' + catalog[c.sku].name).join(' + ') };
}
/** Target sudah divalidasi pada transaksi yang sama; hindari membangun sellables seluruh katalog sekali lagi. */
function shopeeUpsertMapping_(user, r, target, note) {
  const M = db_('EXTERNAL_SKU_MAPPINGS'), key = shopeeKey_(r.StoreAccount, r.ExternalProductId, r.ExternalVariationId);
  const matches = M.filter((m) => m.System === 'shopee' && m.IsActive && shopeeKey_(m.StoreAccount, m.ExternalProductId, m.ExternalVariationId) === key);
  const old = matches[0], before = old ? { sku: old.InternalSku, active: old.IsActive } : null;
  matches.slice(1).forEach((m) => M.update(m, { IsActive: false, UpdatedAt: now_() }));
  const values = { System: 'shopee', StoreAccount: r.StoreAccount, ExternalProductId: r.ExternalProductId, ExternalVariationId: r.ExternalVariationId || '', ExternalParentSku: r.ExternalParentSku || '', ExternalSku: r.ExternalSku || '', ListingName: r.ListingName, ProductID: target.productId || '', VariantID: target.variantId || '', ConversionID: '', BundleID: target.bundleId || '', InternalSku: target.sku, MappingStatus: 'mapped', IsActive: true, Notes: note, UpdatedAt: now_() };
  const saved = old ? M.update(old, values) : M.insert(Object.assign(values, { MappingID: uuid_(), CreatedBy: user.email, CreatedAt: now_() }));
  audit_(user.email, 'mapping.' + (old ? 'update' : 'create'), 'mapping', old ? old.MappingID : saved.MappingID, before, { sku: target.sku, system: 'shopee' }, {});
}
/** Snapshot audit 12 November: tidak menimpa listing yang sudah ada atau menyetujui atas nama pengguna. */
function shopeeSeed_(user, rows) {
  const seed = rows || (typeof SHOPEE_REVIEW_SEED === 'undefined' ? [] : SHOPEE_REVIEW_SEED);
  const T = db_('SHOPEE_LISTINGS'), have = new Set(T.rows().map((r) => shopeeKey_(r.StoreAccount, r.ExternalProductId, r.ExternalVariationId))), catalog = shopeeCatalog_();
  let created = 0, suggested = 0;
  seed.forEach((a) => {
    const key = shopeeKey_('Meirista', a[0], a[1]); if (have.has(key)) return;
    const t = catalog[a[11]], expected = a[14] || [];
    const valid = t && t.active && masterNameKey(t.name) === masterNameKey(a[12]) && t.gtin === a[13] && !shopeeValidateTarget_({ SaleType: a[9], SaleQuantity: a[10], ExpectedComponents: expected }, t).length;
    T.insert({ ListingID: uuid_(), StoreAccount: 'Meirista', ExternalProductId: a[0], ExternalVariationId: a[1], ListingName: a[2], VariationName: a[3], ExternalParentSku: a[4], ExternalSku: a[5], ExternalGTIN: a[6], Price: a[7], Stock: a[8], SaleType: a[9], SaleQuantity: a[10], ExpectedComponents: expected, TargetSku: valid ? a[11] : '', ReviewStatus: valid ? 'suggested' : 'needs_review', ReviewNote: a[15] + (a[11] && !valid ? ' Usulan audit tidak cocok dengan master saat ini; pilih ulang SKU.' : ''), Version: 1, SourceFile: '1.xlsx — tarikan Shopee 12 November 2026', SourceRow: a[16], ImportedAt: now_(), UpdatedAt: now_() });
    have.add(key); created++; if (valid) suggested++;
  });
  audit_(user.email, 'shopee.seed', 'shopee_listing', '', null, { created, suggested }, {}); return { created, suggested };
}
