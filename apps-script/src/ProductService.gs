/**
 * Registrasi produk satu alur 3 tahap: 1 Identifikasi Produk → 2 Varian & Barcode → 3 Kemasan & Logistik (opsional).
 *
 * Satu kali simpan menyimpan Parent, seluruh Child SKU + atribut, barcode, kemasan, dan dimensi dalam SATU transaksi
 * (withLock_ + staging + jurnal): tidak pernah tersimpan setengah. Tanpa approval. "Simpan Draft" → status DRAFT.
 * User tidak mengisi kode: Parent SKU (BRAND-KATEGORI-0001) dan Child SKU (PARENT_SKU-BARCODE) dibentuk server
 * di dalam lock. Identitas permanen: ProductID, VariantID (relasi), dan SKU sejak produk aktif.
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
  const dims = dimensionsByVariant_(id);
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
    .map((v) => variantView_(v, convs[v.VariantID], attrs[v.VariantID] || [], ext[v.VariantID], dims[v.VariantID], p));
  const refs = productRefs_(p);
  return {
    id: p.ProductID,
    productCode: p.ProductCode,
    parentSku: p.ProductCode,
    parentCode: p.ParentCode || '',
    displayName: buildSkuName(refs.brand.name, p.ProductName, [], []),
    skuFrozen: p.Status !== STATUS.DRAFT,
    packagingComplete: variants.filter((v) => v.status === STATUS.ACTIVE || v.status === STATUS.DRAFT).every((v) => v.packagingComplete),
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
    description: p.Description || '',
    imageUrl: p.ImageUrl || '',
    dataSource: p.DataSource || '',
    stockable: false, // Parent SKU tidak pernah menyimpan saldo stok
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
      name: v.skuName,
      baseUnit: v.baseUnit,
      dimensions: v.dimensions.map((x) => `${x.unit} ${x.lengthCm || '-'}×${x.widthCm || '-'}×${x.heightCm || '-'} cm ${x.grossWeightGrams || '-'} g`),
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
      s.text += ' ' + [v.SKU, v.GTIN, v.InternalBarcode, v.VariantName, normalizeName(v.ProductSKUName), normalizeName(v.NameOverride)].join(' ');
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

/**
 * Pratinjau Parent SKU di tahap 1 (tidak mengikat, tidak menulis apa pun). Nomor final dialokasikan di dalam lock saat
 * disimpan, sehingga membatalkan registrasi tidak meninggalkan record Parent atau nomor terpakai.
 */
function parentPreview_(p) {
  const b = p.brandId ? db_('MASTER_BRANDS').byId(p.brandId) : null;
  const c = p.categoryId ? db_('MASTER_CATEGORIES').byId(p.categoryId) : null;
  const no = peekSeq_('parent_no');
  const parentCode = String(no).padStart(PARENT_CODE_DIGITS, '0');
  return { parentCode, parentSku: b && c ? buildParentSku(b.BrandCode, c.CategoryCode, no) : '', estimated: true, displayName: b ? buildSkuName(b.BrandName, p.name, [], []) : cleanText(p.name) };
}

/** Perbarui Nama Produk SKU otomatis setelah nama brand berubah (override & SKU tidak disentuh). */
function refreshSkuNames_(brandId) {
  const S = getSettings_();
  const b = db_('MASTER_BRANDS').byId(brandId);
  if (!b) return 0;
  const prods = indexBy_(db_('MASTER_PRODUCTS').filter((p) => p.BrandID === brandId), 'ProductID');
  let n = 0;
  db_('PRODUCT_VARIANTS')
    .filter((v) => prods[v.ProductID])
    .forEach((v) => {
      const g = buildSkuName(b.BrandName, prods[v.ProductID].ProductName, v.VariantAttributes || [], S.attribute_types);
      if (g !== v.ProductSKUName) {
        db_('PRODUCT_VARIANTS').update(v, { ProductSKUName: g, UpdatedAt: now_() });
        n++;
      }
    });
  return n;
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

  // ---------------- Tahap 1: identifikasi produk (Parent)
  const name = cleanText(input.name);
  if (name.length < 3) err('name', 'Nama produk parent minimal 3 karakter');
  if (name.length > 120) err('name', 'Nama produk parent maksimal 120 karakter');
  const brandId = input.brandId || (existing && existing.BrandID);
  const categoryId = input.categoryId || (existing && existing.CategoryID);
  const brand = existing && brandId === existing.BrandID ? db_('MASTER_BRANDS').byId(brandId) : collect(() => activeBrand_(brandId));
  const cat = existing && categoryId === existing.CategoryID ? db_('MASTER_CATEGORIES').byId(categoryId) : collect(() => activeCategory_(categoryId));
  const dbVariants = existing ? V.filter((v) => v.ProductID === existing.ProductID) : [];
  // satuan dasar default produk (tiap Child SKU boleh override di tahap Kemasan & Logistik)
  const baseUnit = normalizeUnit(input.baseUnit) || (existing && existing.BaseUnit) || '';
  if (!baseUnit) err('baseUnit', 'Pilih satuan dasar');
  else if ((!existing || baseUnit !== existing.BaseUnit) && (S.base_units || []).indexOf(baseUnit) < 0) err('baseUnit', `Satuan dasar ${baseUnit} tidak ada di daftar (tambahkan di Settings)`);

  // ---------------- Tahap 2: varian & barcode
  const newCount = (input.variants || []).filter((v) => !v.id).length;
  if (!dbVariants.length && !newCount) err('variants', 'Minimal satu Child SKU');
  if (newCount + dbVariants.length > MAX_VARIANTS) err('variants', `Maksimal ${MAX_VARIANTS} Child SKU per produk`);
  const newStatus = existing ? (existing.Status === STATUS.DRAFT ? STATUS.DRAFT : STATUS.ACTIVE) : input.saveAsDraft ? STATUS.DRAFT : STATUS.ACTIVE;
  if (existing && existing.Status === STATUS.ARCHIVED) err('status', 'Produk berstatus Diarsipkan hanya untuk referensi historis dan tidak dapat diubah.');
  const description = input.description === undefined && existing ? existing.Description || '' : cleanText(input.description).slice(0, 1000);
  const imageUrl = cleanText(input.imageUrl);
  if (imageUrl && !/^https:\/\/[^\s]+$/.test(imageUrl)) err('imageUrl', 'URL gambar harus diawali https://');
  const ctx = { err, dbVariants, baseUnit, newStatus, brandName: brand ? brand.BrandName : '', parentName: name, types: S.attribute_types, baseUnits: S.base_units };
  const vplans = planVariants_(input, ctx).filter(Boolean);

  // ---------------- Tahap 3: kemasan & logistik (opsional)
  vplans.forEach((vp) => (vp.convs = planConversions_(vp, ctx)));
  if (existing) {
    const activeLeft =
      dbVariants.filter((v) => {
        const vp = vplans.find((x) => x.dbv && x.dbv.VariantID === v.VariantID);
        return [STATUS.ACTIVE, STATUS.DRAFT].indexOf(vp ? vp.status : v.Status) >= 0;
      }).length + vplans.filter((x) => !x.dbv && [STATUS.ACTIVE, STATUS.DRAFT].indexOf(x.status) >= 0).length;
    if (!activeLeft && existing.Status === STATUS.ACTIVE) err('variants', 'Minimal satu Child SKU harus aktif. Untuk menghentikan produk, ubah status produknya.');
  }
  vplans.forEach((vp) => {
    const units = [vp.baseUnit].concat((vp.convs || []).filter((x) => x.status === STATUS.ACTIVE).map((x) => x.unitName));
    vp.dims = planDimensions_(vp, units, err);
    // satuan beli/jual (data v4, tidak lagi di formulir): input eksplisit divalidasi; nilai tersimpan yang kemasannya sudah tidak ada dikosongkan
    ['purchaseUnit', 'salesUnit'].forEach((k) => {
      if (!vp.inv[k] || units.indexOf(vp.inv[k]) >= 0) return;
      if (vp.invExplicit[k]) err(vp.path + '.' + k, `Satuan ${vp.inv[k]} belum didefinisikan sebagai kemasan Child SKU ini`);
      else vp.inv[k] = '';
    });
    // kemasan ber-identitas sendiri wajib punya barcode kemasan (bukan barcode Child SKU)
    (vp.convs || [])
      .filter((x) => x.isTradeItem && x.status === STATUS.ACTIVE && !x.kept)
      .forEach((x) => {
        const b = x.ic.barcode || {};
        const has = x.dbc && (x.dbc.GTIN || x.dbc.InternalBarcode);
        if (!has && b.mode !== 'gtin' && b.mode !== 'internal') err(x.path + '.barcode', `Kemasan ${x.unitName} dengan identitas sendiri wajib punya barcode kemasan (GTIN kemasan, atau barcode internal)`);
      });
  });

  // barcode yang sama dipakai dua kali di formulir
  const formCodes = {};
  vplans.forEach((vp) => {
    const vl = 'varian ' + (vp.i + 1) + ' (' + vp.name + ')';
    const list = [{ b: vp.iv.barcode, path: vp.path + '.barcode', label: vl }].concat((vp.convs || []).filter((x) => x.isTradeItem && !x.kept && x.status === STATUS.ACTIVE).map((x) => ({ b: x.ic.barcode, path: x.path + '.barcode', label: 'kemasan ' + x.unitName + ' ' + vl })));
    list.forEach((x) => {
      const code = x.b && x.b.mode === 'gtin' ? cleanBarcode(x.b.code) : '';
      if (!code) return;
      if (formCodes[code]) err(x.path, `Barcode ${code} juga dipakai ${formCodes[code]}. Setiap Child SKU/kemasan wajib punya barcode sendiri.`, 'DUPLICATE');
      else formCodes[code] = x.label;
    });
  });

  if (errs.length) throw new AppError('Periksa kembali isian (' + errs.length + ' masalah)', errs, 'VALIDATION_FAILED');

  const similar = similarProducts_(name, brand.BrandID, existing ? existing.ProductID : null);
  const nameChanged = !existing || normalizeName(name) !== existing.NameKey || brand.BrandID !== existing.BrandID;
  if (nameChanged && similar.length && !input.acknowledgeSimilar && !opts.dryRun)
    throw new AppError('Kemungkinan produk duplikat pada brand ini. Pilih Parent yang sudah ada untuk menambah varian, atau lanjutkan bila memang berbeda.', similar.map((s) => ({ path: 'name', message: s.message, code: 'SIMILAR', data: s })), 'SIMILAR_EXISTS');

  // ---------------- Terapkan (di memori; ditulis sekaligus oleh commitAll_)
  const ts = now_();
  const before = existing ? productAuditSummary_(productDetail_(existing.ProductID)) : null;
  const hasVariants = vplans.some((vp) => vp.attrs.length) || dbVariants.some((v) => !vplans.some((x) => x.dbv === v) && v.AttributeKey);
  let p;
  if (existing) {
    p = existing;
    const patch = { ProductName: name, NameKey: normalizeName(name), BrandID: brand.BrandID, CategoryID: cat.CategoryID, BaseUnit: baseUnit, HasVariants: hasVariants, Description: description, UpdatedBy: user.email, UpdatedAt: ts, Version: (p.Version || 1) + 1 };
    if (imageUrl) patch.ImageUrl = imageUrl;
    // Parent SKU dihitung ulang hanya selama DRAFT (brand/kategori dikoreksi); sejak aktif, Parent SKU dibekukan
    if (p.Status === STATUS.DRAFT && p.ParentCode && (brand.BrandID !== p.BrandID || cat.CategoryID !== p.CategoryID)) {
      const code = buildParentSku(brand.BrandCode, cat.CategoryCode, p.ParentCode);
      if (P.find((x) => x.ProductID !== p.ProductID && String(x.ProductCode).toUpperCase() === code)) throw new AppError(`Parent SKU ${code} sudah dipakai produk lain`, [{ path: 'brandId', message: 'Parent SKU bentrok' }], 'VALIDATION_FAILED');
      patch.ProductCode = code;
    }
    P.update(p, patch);
  } else {
    const pc = allocateParentSku_(brand, cat);
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
      Status: newStatus,
      CreatedBy: user.email,
      CreatedAt: ts,
      UpdatedBy: user.email,
      UpdatedAt: ts,
      Version: 1,
      LegacyCode: '',
      Description: description,
      ImageUrl: imageUrl,
      DataSource: cleanText(input.dataSource).slice(0, 200),
      ParentCode: pc.parentCode,
    });
    recordLifecycle_(user, 'product', p.ProductID, p.ProductID, '', newStatus, 'Registrasi');
  }
  // nama brand / parent berubah → nama otomatis Child SKU yang tidak dikirim formulir ikut diperbarui
  dbVariants
    .filter((v) => !vplans.some((x) => x.dbv === v))
    .forEach((v) => {
      const g = buildSkuName(brand.BrandName, name, v.VariantAttributes || [], S.attribute_types);
      if (g !== v.ProductSKUName) V.update(v, { ProductSKUName: g, UpdatedAt: ts });
    });
  const bcErrs = [];
  let order = dbVariants.reduce((m, v) => Math.max(m, v.SortOrder || 0), 0);
  vplans.forEach((vp) => {
    let v = vp.dbv;
    const named = { ProductSKUName: vp.generated, NameOverride: vp.override, NameOverrideReason: vp.overrideReason };
    if (!v) {
      v = V.insert(
        Object.assign(
          {
            VariantID: uuid_(),
            ProductID: p.ProductID,
            VariantCode: '',
            VariantName: vp.name,
            VariantAttributes: vp.attrs,
            AttributeKey: vp.key,
            SKU: '',
            GTIN: '',
            InternalBarcode: '',
            IsDefault: !vp.attrs.length,
            Status: vp.status,
            SortOrder: ++order,
            CreatedBy: user.email,
            CreatedAt: ts,
            UpdatedAt: ts,
            Stockable: 'STOCKABLE',
            BatchTracking: vp.inv.batchTracking,
            ExpiryTracking: vp.inv.expiryTracking,
            ShelfLifeMonths: vp.inv.shelfLifeMonths,
            PurchaseUnit: vp.inv.purchaseUnit,
            SalesUnit: vp.inv.salesUnit,
            BaseUnit: vp.baseUnit,
          },
          named,
        ),
      );
      writeAttributes_(v, vp.attrs);
      C.insert({ ConversionID: uuid_(), VariantID: v.VariantID, ProductID: p.ProductID, UnitName: vp.baseUnit, ConversionFactor: 1, ContainsUnit: vp.baseUnit, BaseUnitEquivalent: 1, IsBaseUnit: true, IsTradeItem: false, SKU: '', GTIN: '', InternalBarcode: '', Status: STATUS.ACTIVE, SortOrder: 0, CreatedAt: ts, UpdatedAt: ts });
    } else {
      const patch = {};
      if (v.VariantName !== vp.name) patch.VariantName = vp.name;
      if (v.Status !== vp.status) {
        patch.Status = vp.status;
        recordLifecycle_(user, 'variant', v.VariantID, p.ProductID, v.Status, vp.status, vp.iv.statusReason || 'Diubah lewat edit produk');
      }
      const inv = Object.assign({ BatchTracking: vp.inv.batchTracking, ExpiryTracking: vp.inv.expiryTracking, ShelfLifeMonths: vp.inv.shelfLifeMonths, PurchaseUnit: vp.inv.purchaseUnit, SalesUnit: vp.inv.salesUnit, BaseUnit: vp.baseUnit }, named);
      Object.keys(inv).forEach((k) => (inv[k] === null || inv[k] === undefined ? '' : inv[k]) !== (v[k] === null || v[k] === undefined ? '' : v[k]) && (patch[k] = inv[k]));
      if ((v.AttributeKey || '') !== vp.key) Object.assign(patch, { VariantAttributes: vp.attrs, AttributeKey: vp.key, IsDefault: !vp.attrs.length });
      const oldName = variantDisplayName_(v);
      if (Object.keys(patch).length) V.update(v, Object.assign(patch, { UpdatedAt: ts }));
      if (patch.AttributeKey !== undefined) writeAttributes_(v, vp.attrs);
      if (patch.BaseUnit !== undefined) C.filter((c) => c.VariantID === v.VariantID && c.IsBaseUnit).forEach((c) => C.update(c, { UnitName: vp.baseUnit, ContainsUnit: vp.baseUnit, UpdatedAt: ts }));
      if (patch.NameOverride !== undefined) audit_(user.email, 'variant.rename', 'variant', v.VariantID, { name: oldName }, { name: vp.override || vp.generated }, { reason: vp.overrideReason || 'Kembali ke nama otomatis', productId: p.ProductID, sku: v.SKU });
    }
    const vb = applyBarcode_(user, vp.iv.barcode, { productId: p.ProductID, variantId: v.VariantID }, v, vp.iv.barcodeChangeReason, vp.path + '.barcode', 'Child SKU ' + name + ' ' + vp.name, bcErrs);
    if (vb) V.update(v, { GTIN: vb.gtin, InternalBarcode: vb.internal, UpdatedAt: ts });
    vp.v = v;

    let corder = 0;
    (vp.convs || []).forEach((x) => {
      let c = x.dbc;
      const fields = { UnitName: x.unitName, ConversionFactor: x.factor, ContainsUnit: x.containsUnit, BaseUnitEquivalent: x.baseUnitEquivalent, IsTradeItem: x.isTradeItem, Status: x.status, SortOrder: ++corder };
      if (!c) {
        if (x.status !== STATUS.ACTIVE) return; // baris baru yang langsung dihapus di formulir
        c = C.insert(Object.assign({ ConversionID: uuid_(), VariantID: v.VariantID, ProductID: p.ProductID, IsBaseUnit: false, SKU: '', GTIN: '', InternalBarcode: '', CreatedAt: ts, UpdatedAt: ts, EffectiveFrom: ts }, fields));
        x.dbc = c;
      } else if (!x.kept) {
        const changed = Object.keys(fields).some((k) => fields[k] !== c[k]);
        if (changed && (c.ConversionFactor !== x.factor || c.ContainsUnit !== x.containsUnit) && x.status === STATUS.ACTIVE) {
          // perubahan isi kemasan yang sudah tersimpan → histori dengan tanggal efektif
          db_('PACKAGING_HISTORY').insert({ HistoryID: uuid_(), ConversionID: c.ConversionID, VariantID: v.VariantID, ProductID: p.ProductID, UnitName: x.unitName, OldFactor: c.ConversionFactor, NewFactor: x.factor, OldContainsUnit: c.ContainsUnit, NewContainsUnit: x.containsUnit, OldEquivalent: c.BaseUnitEquivalent, NewEquivalent: x.baseUnitEquivalent, EffectiveFrom: ts, ChangedBy: user.email, Reason: cleanText(x.ic.changeReason) || 'Edit produk' });
          fields.EffectiveFrom = ts;
        }
        if (changed) C.update(c, Object.assign(fields, { UpdatedAt: ts }));
      }
      if (x.kept) return;
      if (x.isTradeItem && x.status === STATUS.ACTIVE) {
        const cb = applyBarcode_(user, x.ic.barcode, { productId: p.ProductID, variantId: v.VariantID, conversionId: c.ConversionID }, c, x.ic.barcodeChangeReason, x.path + '.barcode', 'Kemasan ' + x.unitName + ' ' + name, bcErrs);
        if (cb) C.update(c, { GTIN: cb.gtin, InternalBarcode: cb.internal, UpdatedAt: ts });
      }
    });
    writeDimensions_(user, v, vp.dims, ts);
  });
  if (bcErrs.length) throw new AppError('Periksa kembali barcode (' + bcErrs.length + ' masalah)', bcErrs, 'VALIDATION_FAILED');
  syncSkus_(p, vplans, ts);

  const after = productDetail_(p.ProductID);
  if (opts.dryRun) return Object.assign(after, { dryRun: true, similar });
  audit_(user.email, existing ? 'product.update' : 'product.create', 'product', p.ProductID, before, productAuditSummary_(after));
  return after;
}

/**
 * Child SKU = PARENT_SKU-BARCODE (juga kemasan ber-identitas sendiri). SKU diberikan sekali saat barcode tersedia;
 * selama produk DRAFT dihitung ulang mengikuti barcode/Parent SKU terbaru. Sejak aktif, SKU dibekukan: koreksi GTIN
 * hanya mengganti barcode (histori tercatat), SKU lama tetap. SKU yang pernah dialokasikan tidak dipakai barang lain.
 */
function syncSkus_(p, vplans, ts) {
  const V = db_('PRODUCT_VARIANTS');
  const C = db_('UNIT_CONVERSIONS');
  const draft = p.Status === STATUS.DRAFT;
  const owner = skuOwnerMap_();
  const vars = V.filter((v) => v.ProductID === p.ProductID);
  const convs = C.filter((c) => c.ProductID === p.ProductID && !c.IsBaseUnit && c.IsTradeItem);
  // SKU milik produk draft ini sendiri boleh dipertukarkan (mis. GTIN dua varian ditukar)
  if (draft) vars.concat(convs).forEach((r) => r.SKU && delete owner[String(r.SKU).toUpperCase()]);
  const errs = [];
  const pathOf = (variantId, conversionId) => {
    const vp = (vplans || []).find((x) => x.v && x.v.VariantID === variantId);
    if (!vp) return 'variants';
    if (!conversionId) return vp.path + '.barcode';
    const cx = (vp.convs || []).find((x) => x.dbc && x.dbc.ConversionID === conversionId);
    return cx ? cx.path + '.barcode' : vp.path + '.barcode';
  };
  const assign = (T, rec, code, label, path) => {
    if (!code || (rec.SKU && !draft)) return;
    const sku = buildChildSku(p.ProductCode, code);
    if (sku === rec.SKU) return (owner[sku.toUpperCase()] = label);
    if (owner[sku.toUpperCase()]) return errs.push({ path, message: `SKU ${sku} sudah pernah dialokasikan untuk ${owner[sku.toUpperCase()]} — SKU tidak boleh dipakai ulang`, code: 'DUPLICATE' });
    T.update(rec, { SKU: sku, UpdatedAt: ts });
    owner[sku.toUpperCase()] = label;
  };
  vars.forEach((v) => assign(V, v, v.GTIN || v.InternalBarcode, `${p.ProductName} [${p.ProductCode}]`, pathOf(v.VariantID)));
  convs.filter((c) => c.Status === STATUS.ACTIVE).forEach((c) => assign(C, c, c.GTIN || c.InternalBarcode, `${p.ProductName} (kemasan ${c.UnitName})`, pathOf(c.VariantID, c.ConversionID)));
  if (errs.length) throw new AppError('SKU bentrok', errs, 'VALIDATION_FAILED');
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
    if (cur) audit_(user.email, 'barcode.change', target.bundleId ? 'bundle' : target.conversionId ? 'conversion' : 'variant', target.bundleId || target.conversionId || target.variantId, { code: cur }, { code: b.Code }, { reason: cleanText(reason), productId: target.productId });
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
