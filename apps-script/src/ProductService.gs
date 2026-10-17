/**
 * Product Master — registrasi Quick Entry (1 varian) & Advanced (multi-varian), edit, direktori.
 *
 * Satu kali "Simpan Produk" menyimpan Product Master, seluruh varian + atribut, barcode, dan konversi kemasan dalam
 * SATU transaksi (withLock_ + staging + jurnal): tidak pernah tersimpan setengah. Tanpa approval — produk langsung aktif.
 * User tidak mengisi kode apa pun: Product Code (PRD000123) dan SKU (SKU000456) dialokasikan otomatis di dalam lock.
 * Identitas permanen: ProductID, ProductCode, VariantID, SKU. Nama, brand, kategori, atribut boleh dikoreksi (tercatat di audit).
 */

function productRefs_(p) {
  const b = db_('MASTER_BRANDS').byId(p.BrandID) || {};
  const c = db_('MASTER_CATEGORIES').byId(p.CategoryID) || {};
  return { brand: { id: b.BrandID, code: b.BrandCode, name: b.BrandName, status: b.Status }, category: { id: c.CategoryID, code: c.CategoryCode, name: c.CategoryName, status: c.Status } };
}

function productDetail_(id) {
  const p = db_('MASTER_PRODUCTS').byId(id);
  if (!p) throw new AppError('Produk tidak ditemukan', [], 'NOT_FOUND');
  const convs = groupBy_(
    db_('UNIT_CONVERSIONS')
      .filter((c) => c.ProductID === id && c.Status !== STATUS.DELETED)
      .sort((a, b) => (b.IsBaseUnit ? 1 : 0) - (a.IsBaseUnit ? 1 : 0) || a.SortOrder - b.SortOrder),
    'VariantID',
  );
  const attrs = attributesByVariant_(id);
  const ext = {};
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.ProductID === id && m.IsActive)
    .forEach((m) => {
      const vid = m.VariantID || (db_('UNIT_CONVERSIONS').byId(m.ConversionID) || {}).VariantID;
      (ext[vid] = ext[vid] || []).push({ system: m.System, sku: m.ExternalSku, conversionId: m.ConversionID || '', status: m.MappingStatus });
    });
  const variants = db_('PRODUCT_VARIANTS')
    .filter((v) => v.ProductID === id)
    .sort((a, b) => a.SortOrder - b.SortOrder)
    .map((v) => variantView_(v, convs[v.VariantID], attrs[v.VariantID] || [], ext[v.VariantID]));
  const refs = productRefs_(p);
  return {
    id: p.ProductID,
    productCode: p.ProductCode,
    productNo: p.ProductCode,
    legacyCode: p.LegacyCode || '',
    name: p.ProductName,
    baseUnit: p.BaseUnit,
    hasVariants: p.HasVariants,
    status: p.Status,
    version: p.Version,
    createdBy: p.CreatedBy,
    createdAt: p.CreatedAt,
    updatedBy: p.UpdatedBy,
    updatedAt: p.UpdatedAt,
    brand: refs.brand,
    category: refs.category,
    variants,
  };
}

/** Ringkasan untuk audit log (sebelum/sesudah). */
function productAuditSummary_(d) {
  return {
    name: d.name,
    productCode: d.productCode,
    brand: d.brand.name,
    category: d.category.name,
    baseUnit: d.baseUnit,
    status: d.status,
    variants: d.variants.map((v) => ({
      sku: v.sku,
      name: v.name,
      attributes: v.attributes.map((a) => a.name + '=' + a.value).join(', '),
      status: v.status,
      gtin: v.gtin,
      internal: v.internalBarcode,
      units: v.conversions.filter((c) => !c.isBaseUnit).map((c) => `${c.unitName}=${c.factor} ${c.containsUnit} (${c.baseUnitEquivalent})${c.sku ? ' ' + c.sku : ''}${c.status !== STATUS.ACTIVE ? ' ' + c.status : ''}`),
    })),
  };
}

/**
 * Indeks direktori (satu baris per produk + teks pencarian). Dibangun dari batch read seluruh tabel terkait,
 * lalu disimpan di CacheService per versi data — halaman Direktori tidak membaca ulang semua sheet setiap kali dibuka.
 */
function productIndex_() {
  const key = 'dir:' + dataVersion_();
  const cached = cacheGetBig_(key);
  if (cached) return cached;
  const brands = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const cats = indexBy_(db_('MASTER_CATEGORIES').rows(), 'CategoryID');
  const stats = {};
  const st = (pid) => (stats[pid] = stats[pid] || { variants: 0, active: 0, withBarcode: 0, skus: 0, packs: 0, text: '' });
  db_('PRODUCT_VARIANTS')
    .rows()
    .forEach((v) => {
      const s = st(v.ProductID);
      s.variants++;
      if (v.Status === STATUS.ACTIVE) s.active++;
      if (v.Status === STATUS.ACTIVE && (v.GTIN || v.InternalBarcode)) s.withBarcode++;
      if (v.SKU) s.skus++;
      s.text += ' ' + [v.SKU, v.GTIN, v.InternalBarcode, v.VariantName].join(' ');
    });
  db_('UNIT_CONVERSIONS')
    .rows()
    .forEach((c) => {
      if (c.IsBaseUnit || c.Status === STATUS.DELETED) return;
      const s = st(c.ProductID);
      if (c.Status === STATUS.ACTIVE) s.packs++;
      if (c.SKU) s.skus++;
      s.text += ' ' + [c.SKU, c.GTIN, c.InternalBarcode].join(' ');
    });
  db_('VARIANT_BARCODES')
    .rows()
    .forEach((b) => b.ProductID && (st(b.ProductID).text += ' ' + b.Code));
  db_('EXTERNAL_SKU_MAPPINGS')
    .rows()
    .forEach((m) => m.ProductID && m.IsActive && (st(m.ProductID).text += ' ' + m.ExternalSku));
  const rows = db_('MASTER_PRODUCTS')
    .rows()
    .map((p) => {
      const s = stats[p.ProductID] || { variants: 0, active: 0, withBarcode: 0, skus: 0, packs: 0, text: '' };
      const b = brands[p.BrandID] || {};
      const c = cats[p.CategoryID] || {};
      return {
        id: p.ProductID,
        productCode: p.ProductCode,
        legacyCode: p.LegacyCode || '',
        productNoNum: p.ProductNo,
        name: p.ProductName,
        baseUnit: p.BaseUnit,
        hasVariants: p.HasVariants,
        status: p.Status,
        updatedAt: p.UpdatedAt,
        brandId: p.BrandID,
        brandName: b.BrandName,
        brandCode: b.BrandCode,
        categoryId: p.CategoryID,
        categoryName: c.CategoryName,
        categoryCode: c.CategoryCode,
        variantCount: s.variants,
        activeVariants: s.active,
        withBarcode: s.withBarcode,
        skuCount: s.skus,
        packCount: s.packs,
        complete: s.active > 0 && s.withBarcode === s.active,
        q: ((p.NameKey || '') + ' ' + (p.ProductCode || '') + ' ' + (p.LegacyCode || '') + ' ' + s.text).toUpperCase(),
      };
    });
  cachePutBig_(key, rows);
  return rows;
}

function productList_(f) {
  f = f || {};
  const q = cleanText(f.search);
  const qn = normalizeName(q).toUpperCase();
  const qu = q.toUpperCase();
  let rows = productIndex_()
    .filter((r) => (f.status === 'all' || !f.status ? true : r.status === f.status))
    .filter((r) => (!f.brandId || r.brandId === f.brandId) && (!f.categoryId || r.categoryId === f.categoryId))
    .filter((r) => (f.completeness === 'incomplete' ? !r.complete : f.completeness === 'complete' ? r.complete : true))
    .filter((r) => !q || r.q.indexOf(qn) >= 0 || r.q.indexOf(qu) >= 0);
  const key = { name: 'name', brand: 'brandName', category: 'categoryName', productNo: 'productNoNum', skus: 'skuCount' }[f.sort] || 'updatedAt';
  const dir = f.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
  const page = paginate_(rows, f.page, Math.min(Number(f.pageSize) || 25, 200));
  page.rows = page.rows.map((r) => {
    const o = Object.assign({}, r);
    delete o.q;
    return o;
  });
  return page;
}

/** Pencarian ringkas untuk searchable dropdown produk. */
function productSearch_(q) {
  return productList_({ search: q, status: 'all', pageSize: 20, sort: 'name', dir: 'asc' }).rows.map((r) => ({ id: r.id, name: r.name, code: r.productCode, brandName: r.brandName, status: r.status }));
}

/** Nama produk identik / mirip pada brand yang sama — PERINGATAN, tidak pernah digabung otomatis. */
function similarProducts_(name, brandId, exceptId) {
  if (!cleanText(name) || cleanText(name).length < 3) return [];
  const threshold = Number(getSettings_().fuzzy_threshold) || 0.82;
  const key = normalizeName(name);
  return db_('MASTER_PRODUCTS')
    .filter((p) => p.ProductID !== exceptId && (!brandId || p.BrandID === brandId))
    .map((p) => {
      const exact = p.NameKey === key;
      return { p, exact, score: exact ? 1 : nameSimilarity(name, p.ProductName) };
    })
    .filter((x) => x.exact || x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => ({
      id: x.p.ProductID,
      productCode: x.p.ProductCode,
      name: x.p.ProductName,
      status: x.p.Status,
      score: x.score,
      message: x.exact ? `Kemungkinan duplikat: nama sama dengan "${x.p.ProductName}" (${x.p.ProductCode})` : `Kemungkinan duplikat: nama mirip ${Math.round(x.score * 100)}% dengan "${x.p.ProductName}" (${x.p.ProductCode})`,
    }));
}

function productCheck_(p) {
  return { similar: similarProducts_(p.name, p.brandId, p.productId) };
}

/**
 * Simpan produk baru / perubahan produk. opts.dryRun = validasi penuh tanpa menulis (pratinjau ringkasan).
 * input: { productId?, version?, brandId, categoryId, name, baseUnit, hasVariants, acknowledgeSimilar,
 *          variants: [{ id?, name, attributes:[{name,value}], status, barcode:{mode,code}, barcodeChangeReason,
 *                       conversions: [{ id?, unitName, factor, containsUnit, isTradeItem, status, barcode, barcodeChangeReason }] }] }
 */
function productSave_(user, input, opts) {
  opts = opts || {};
  input = input || {};
  const S = getSettings_();
  const errs = [];
  const err = (path, message, code) => errs.push({ path, message, code: code || 'INVALID' });
  const P = db_('MASTER_PRODUCTS');
  const V = db_('PRODUCT_VARIANTS');
  const C = db_('UNIT_CONVERSIONS');
  const existing = input.productId ? P.byId(input.productId) : null;
  if (input.productId && !existing) throw new AppError('Produk tidak ditemukan', [], 'NOT_FOUND');
  if (existing && input.version !== undefined && input.version !== null && Number(input.version) !== existing.Version)
    throw new AppError('Produk ini baru saja diubah oleh pengguna lain. Muat ulang lalu ulangi perubahan Anda.', [], 'STALE_VERSION');
  const collect = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      (e.details.length ? e.details : [{ path: '', message: e.message }]).forEach((d) => err(d.path, d.message, d.code));
      return null;
    }
  };

  // ---------------- Tahap 1: identifikasi produk
  const name = cleanText(input.name);
  if (name.length < 3) err('name', 'Nama produk minimal 3 karakter');
  if (name.length > 120) err('name', 'Nama produk maksimal 120 karakter');
  const brandId = input.brandId || (existing && existing.BrandID);
  const categoryId = input.categoryId || (existing && existing.CategoryID);
  const brand = existing && brandId === existing.BrandID ? db_('MASTER_BRANDS').byId(brandId) : collect(() => activeBrand_(brandId));
  const cat = existing && categoryId === existing.CategoryID ? db_('MASTER_CATEGORIES').byId(categoryId) : collect(() => activeCategory_(categoryId));
  const dbVariants = existing ? V.filter((v) => v.ProductID === existing.ProductID) : [];
  let baseUnit = normalizeUnit(input.baseUnit) || (existing && existing.BaseUnit);
  if (!baseUnit) err('baseUnit', 'Pilih satuan dasar');
  else if (!existing || baseUnit !== existing.BaseUnit) {
    if ((S.base_units || []).indexOf(baseUnit) < 0) err('baseUnit', `Satuan dasar ${baseUnit} tidak ada di daftar (tambahkan di Pengaturan)`);
    if (existing && C.filter((c) => c.ProductID === existing.ProductID && !c.IsBaseUnit && c.Status !== STATUS.DELETED).length)
      err('baseUnit', 'Satuan dasar tidak dapat diganti selama masih ada satuan kemasan. Hapus kemasan dulu.');
  }

  // ---------------- Tahap 2: varian & barcode
  const newCount = (input.variants || []).filter((v) => !v.id).length;
  const hasVariants = !!input.hasVariants || (existing ? existing.HasVariants && input.hasVariants === undefined : false);
  if (!dbVariants.length && !newCount) err('variants', 'Minimal satu varian');
  if (!hasVariants && dbVariants.length + newCount !== 1) err('variants', 'Quick Entry hanya untuk produk dengan tepat satu varian. Gunakan mode Advanced untuk banyak varian.');
  if (newCount + dbVariants.length > MAX_VARIANTS) err('variants', `Maksimal ${MAX_VARIANTS} varian per produk`);
  const ctx = { err, hasVariants, dbVariants, baseUnit };
  const vplans = planVariants_(input, ctx).filter(Boolean);
  if (hasVariants)
    dbVariants
      .filter((v) => !vplans.some((x) => x.dbv === v) && v.Status === STATUS.ACTIVE && !v.AttributeKey)
      .forEach((v) => err('variants', `Varian "${v.VariantName}" belum punya atribut. Lengkapi atributnya di tabel varian.`));

  // ---------------- Pengaturan tambahan: kemasan & konversi (opsional)
  vplans.forEach((vp) => (vp.convs = planConversions_(vp, ctx)));
  if (existing) {
    const activeLeft =
      dbVariants.filter((v) => {
        const vp = vplans.find((x) => x.dbv && x.dbv.VariantID === v.VariantID);
        return (vp ? vp.status : v.Status) === STATUS.ACTIVE;
      }).length + vplans.filter((x) => !x.dbv && x.status === STATUS.ACTIVE).length;
    if (!activeLeft) err('variants', 'Minimal satu varian harus aktif. Untuk menghentikan produk, nonaktifkan produknya.');
  }

  // barcode yang sama dipakai dua kali di formulir
  const formCodes = {};
  vplans.forEach((vp) => {
    const vl = 'varian ' + (vp.i + 1) + ' (' + vp.name + ')';
    const list = [{ b: vp.iv.barcode, path: vp.path + '.barcode', label: vl }].concat((vp.convs || []).filter((x) => x.isTradeItem && !x.kept && x.status === STATUS.ACTIVE).map((x) => ({ b: x.ic.barcode, path: x.path + '.barcode', label: 'kemasan ' + x.unitName + ' ' + vl })));
    list.forEach((x) => {
      const code = x.b && x.b.mode !== 'none' ? cleanBarcode(x.b.code) : '';
      if (!code) return;
      if (formCodes[code]) err(x.path, `Barcode ${code} juga dipakai ${formCodes[code]}. Setiap varian/kemasan wajib punya barcode sendiri.`, 'DUPLICATE');
      else formCodes[code] = x.label;
    });
  });

  if (errs.length) throw new AppError('Periksa kembali isian (' + errs.length + ' masalah)', errs, 'VALIDATION_FAILED');

  const similar = similarProducts_(name, brand.BrandID, existing ? existing.ProductID : null);
  const nameChanged = !existing || normalizeName(name) !== existing.NameKey || brand.BrandID !== existing.BrandID;
  if (nameChanged && similar.length && !input.acknowledgeSimilar && !opts.dryRun)
    throw new AppError('Kemungkinan produk duplikat pada brand ini. Lihat produk yang ada, atau lanjutkan bila memang berbeda.', similar.map((s) => ({ path: 'name', message: s.message, code: 'SIMILAR', data: s })), 'SIMILAR_EXISTS');

  // ---------------- Terapkan (di memori; ditulis sekaligus oleh commitAll_)
  const ts = now_();
  const before = existing ? productAuditSummary_(productDetail_(existing.ProductID)) : null;
  const skuOwner = skuOwnerMap_();
  let p;
  if (existing) {
    p = existing;
    const patch = { ProductName: name, NameKey: normalizeName(name), BrandID: brand.BrandID, CategoryID: cat.CategoryID, BaseUnit: baseUnit, HasVariants: hasVariants, UpdatedBy: user.email, UpdatedAt: ts, Version: (p.Version || 1) + 1 };
    P.update(p, patch);
    if (baseUnit !== before.baseUnit) C.filter((c) => c.ProductID === p.ProductID && c.IsBaseUnit).forEach((c) => C.update(c, { UnitName: baseUnit, ContainsUnit: baseUnit, UpdatedAt: ts }));
  } else {
    const pc = allocateProductCode_();
    p = P.insert({
      ProductID: uuid_(),
      ProductNo: pc.no,
      BrandID: brand.BrandID,
      CategoryID: cat.CategoryID,
      ProductName: name,
      NameKey: normalizeName(name),
      ProductCode: pc.code,
      BaseUnit: baseUnit,
      HasVariants: hasVariants,
      Status: STATUS.ACTIVE,
      CreatedBy: user.email,
      CreatedAt: ts,
      UpdatedBy: user.email,
      UpdatedAt: ts,
      Version: 1,
      LegacyCode: '',
    });
  }
  const bcErrs = [];
  let order = dbVariants.reduce((m, v) => Math.max(m, v.SortOrder || 0), 0);
  vplans.forEach((vp) => {
    let v = vp.dbv;
    if (!v) {
      const sku = allocateSku_(skuOwner);
      skuOwner[sku] = p.ProductName;
      v = V.insert({
        VariantID: uuid_(),
        ProductID: p.ProductID,
        VariantCode: '',
        VariantName: vp.name,
        VariantAttributes: vp.attrs,
        AttributeKey: vp.key,
        SKU: sku,
        GTIN: '',
        InternalBarcode: '',
        IsDefault: !vp.attrs.length,
        Status: vp.status,
        SortOrder: ++order,
        CreatedBy: user.email,
        CreatedAt: ts,
        UpdatedAt: ts,
      });
      writeAttributes_(v, vp.attrs);
      C.insert({ ConversionID: uuid_(), VariantID: v.VariantID, ProductID: p.ProductID, UnitName: baseUnit, ConversionFactor: 1, ContainsUnit: baseUnit, BaseUnitEquivalent: 1, IsBaseUnit: true, IsTradeItem: false, SKU: '', GTIN: '', InternalBarcode: '', Status: STATUS.ACTIVE, SortOrder: 0, CreatedAt: ts, UpdatedAt: ts });
    } else {
      const patch = {};
      if (v.VariantName !== vp.name) patch.VariantName = vp.name;
      if (v.Status !== vp.status) patch.Status = vp.status;
      if ((v.AttributeKey || '') !== vp.key) Object.assign(patch, { VariantAttributes: vp.attrs, AttributeKey: vp.key, IsDefault: !vp.attrs.length });
      if (Object.keys(patch).length) V.update(v, Object.assign(patch, { UpdatedAt: ts }));
      if (patch.AttributeKey !== undefined) writeAttributes_(v, vp.attrs);
    }
    const vb = applyBarcode_(user, vp.iv.barcode, { productId: p.ProductID, variantId: v.VariantID }, v, vp.iv.barcodeChangeReason, vp.path + '.barcode', 'Varian ' + name + ' ' + vp.name, bcErrs);
    if (vb) V.update(v, { GTIN: vb.gtin, InternalBarcode: vb.internal, UpdatedAt: ts });

    let corder = 0;
    (vp.convs || []).forEach((x) => {
      let c = x.dbc;
      let sku = x.sku || '';
      if (x.needsSku) {
        sku = allocateSku_(skuOwner);
        skuOwner[sku] = p.ProductName + ' (kemasan ' + x.unitName + ')';
      }
      const fields = { UnitName: x.unitName, ConversionFactor: x.factor, ContainsUnit: x.containsUnit, BaseUnitEquivalent: x.baseUnitEquivalent, IsTradeItem: x.isTradeItem, SKU: sku, Status: x.status, SortOrder: ++corder };
      if (!c) {
        if (x.status !== STATUS.ACTIVE) return; // baris baru yang langsung dihapus di formulir
        c = C.insert(Object.assign({ ConversionID: uuid_(), VariantID: v.VariantID, ProductID: p.ProductID, IsBaseUnit: false, GTIN: '', InternalBarcode: '', CreatedAt: ts, UpdatedAt: ts }, fields));
      } else if (!x.kept) {
        const changed = Object.keys(fields).some((k) => fields[k] !== c[k]);
        if (changed) C.update(c, Object.assign(fields, { UpdatedAt: ts }));
      }
      if (x.kept) return;
      if (x.isTradeItem && x.status === STATUS.ACTIVE) {
        const cb = applyBarcode_(user, x.ic.barcode, { productId: p.ProductID, variantId: v.VariantID, conversionId: c.ConversionID }, c, x.ic.barcodeChangeReason, x.path + '.barcode', 'Kemasan ' + x.unitName + ' ' + name, bcErrs);
        if (cb) C.update(c, { GTIN: cb.gtin, InternalBarcode: cb.internal, UpdatedAt: ts });
      }
    });
  });
  if (bcErrs.length) throw new AppError('Periksa kembali barcode (' + bcErrs.length + ' masalah)', bcErrs, 'VALIDATION_FAILED');

  const after = productDetail_(p.ProductID);
  if (opts.dryRun) return Object.assign(after, { dryRun: true, similar });
  audit_(user.email, existing ? 'product.update' : 'product.create', 'product', p.ProductID, before, productAuditSummary_(after));
  return after;
}

/**
 * Terapkan pilihan barcode ke target (varian / kemasan). Mengembalikan {gtin, internal} baru, atau null bila
 * tidak berubah. Error dikumpulkan ke errs (bukan dilempar) agar semua masalah tampil sekaligus.
 */
function applyBarcode_(user, input, target, rec, reason, path, notes, errs) {
  input = input || { mode: 'none' };
  const cur = rec.GTIN || rec.InternalBarcode || '';
  const curType = rec.GTIN ? 'gtin' : rec.InternalBarcode ? 'internal' : 'none';
  const code = cleanBarcode(input.code);
  const mode = input.mode || 'none';
  if (cur && ((mode === curType && code === cur) || (mode === 'internal' && curType === 'internal' && !code))) return null;
  if (!cur && mode === 'none') return null;
  if (cur && cleanText(reason).length < 5) {
    errs.push({ path, message: `Barcode ${cur} sudah tersimpan. Isi alasan perubahan (min. 5 karakter) untuk menggantinya.`, code: 'REASON_REQUIRED' });
    return null;
  }
  try {
    if (cur) retireBarcode_(user, cur, cleanText(reason));
    if (mode === 'none') return { gtin: '', internal: '' };
    const b = attachBarcode_(user, input, target, path, notes, cur ? cleanText(reason) : 'registrasi');
    if (cur) audit_(user.email, 'barcode.change', target.conversionId ? 'conversion' : 'variant', target.conversionId || target.variantId, { code: cur }, { code: b.Code }, { reason: cleanText(reason), productId: target.productId });
    return b.BarcodeType === 'GTIN' ? { gtin: b.Code, internal: '' } : { gtin: '', internal: b.Code };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    (e.details.length ? e.details : [{ path, message: e.message }]).forEach((d) => errs.push({ path: d.path || path, message: d.message, code: d.code || e.code, data: d.data }));
    return null;
  }
}

function touchProduct_(user, productId) {
  const p = db_('MASTER_PRODUCTS').byId(productId);
  if (p) db_('MASTER_PRODUCTS').update(p, { UpdatedBy: user.email, UpdatedAt: now_(), Version: (p.Version || 1) + 1 });
}

function productSetStatus_(user, input) {
  const p = db_('MASTER_PRODUCTS').byId(input.id);
  if (!p) throw new AppError('Produk tidak ditemukan', [], 'NOT_FOUND');
  const status = input.status === STATUS.ACTIVE ? STATUS.ACTIVE : STATUS.INACTIVE;
  if (p.Status === status) return productDetail_(p.ProductID);
  if (status === STATUS.INACTIVE && cleanText(input.reason).length < 5) throw new AppError('Alasan menonaktifkan wajib diisi (min. 5 karakter)', [{ path: 'reason', message: 'Wajib' }], 'VALIDATION_FAILED');
  const before = p.Status;
  db_('MASTER_PRODUCTS').update(p, { Status: status, UpdatedBy: user.email, UpdatedAt: now_(), Version: (p.Version || 1) + 1 });
  audit_(user.email, status === STATUS.ACTIVE ? 'product.activate' : 'product.deactivate', 'product', p.ProductID, { status: before }, { status }, { reason: cleanText(input.reason) });
  return productDetail_(p.ProductID);
}

function productAudit_(id) {
  const variantIds = {};
  db_('PRODUCT_VARIANTS')
    .filter((v) => v.ProductID === id)
    .forEach((v) => (variantIds[v.VariantID] = 1));
  return db_('AUDIT_LOGS')
    .filter((a) => a.EntityID === id || variantIds[a.EntityID] || (a.MetaJson && a.MetaJson.productId === id))
    .reverse()
    .slice(0, 100)
    .map(auditView_);
}

function auditView_(a) {
  return { id: a.LogID, createdAt: a.CreatedAt, actor: a.Actor, action: a.Action, entityType: a.EntityType, entityId: a.EntityID, before: a.BeforeJson, after: a.AfterJson, meta: a.MetaJson };
}
