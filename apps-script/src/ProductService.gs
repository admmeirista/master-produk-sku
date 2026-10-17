/**
 * Product Master: registrasi 3 langkah (Identifikasi → Varian → Satuan & Konversi) → Simpan Produk.
 *
 * Satu kali "Simpan Produk" menyimpan Product Master, seluruh varian, identitas barcode, dan konversi
 * satuan dalam SATU transaksi (withLock_ + staging + jurnal): tidak pernah tersimpan setengah.
 * Tanpa approval — produk langsung aktif dan muncul di Direktori. Validasi integritas tetap berjalan di server:
 *   kode produk unik per brand, SKU unik global, kombinasi varian tidak ganda, GTIN satu pemilik, konversi valid.
 * Identitas yang sudah tersimpan bersifat permanen: brand, kategori, kode produk, satuan dasar, atribut & SKU
 * varian, serta isi kemasan ber-SKU. Perubahan GTIN yang sudah tersimpan wajib disertai alasan (tercatat di audit).
 */

function productRefs_(p) {
  const b = db_('MASTER_BRANDS').byId(p.BrandID) || {};
  const c = db_('MASTER_CATEGORIES').byId(p.CategoryID) || {};
  return { brand: { id: b.BrandID, code: b.BrandCode, name: b.BrandName, status: b.Status }, category: { id: c.CategoryID, code: c.CategoryCode, name: c.CategoryName, status: c.Status } };
}

function productDetail_(id) {
  const p = db_('MASTER_PRODUCTS').byId(id);
  if (!p) throw new AppError('Produk tidak ditemukan', [], 'NOT_FOUND');
  const convs = {};
  db_('UNIT_CONVERSIONS')
    .filter((c) => c.ProductID === id)
    .sort((a, b) => (b.IsBaseUnit ? 1 : 0) - (a.IsBaseUnit ? 1 : 0) || a.SortOrder - b.SortOrder)
    .forEach((c) => (convs[c.VariantID] = (convs[c.VariantID] || []).concat([c])));
  const variants = db_('PRODUCT_VARIANTS')
    .filter((v) => v.ProductID === id)
    .sort((a, b) => a.SortOrder - b.SortOrder)
    .map((v) => variantView_(v, convs[v.VariantID]));
  const refs = productRefs_(p);
  return {
    id: p.ProductID,
    productNo: productNoLabel(p.ProductNo),
    name: p.ProductName,
    productCode: p.ProductCode,
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
    baseUnit: d.baseUnit,
    status: d.status,
    variants: d.variants.map((v) => ({
      sku: v.sku,
      name: v.name,
      status: v.status,
      gtin: v.gtin,
      internal: v.internalBarcode,
      units: v.conversions.filter((c) => !c.isBaseUnit).map((c) => `${c.unitName}=${c.factor} ${c.containsUnit} (${c.baseUnitEquivalent})${c.sku ? ' ' + c.sku : ''}${c.status !== STATUS.ACTIVE ? ' nonaktif' : ''}`),
    })),
  };
}

function productList_(f) {
  f = f || {};
  const brands = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const cats = indexBy_(db_('MASTER_CATEGORIES').rows(), 'CategoryID');
  const stats = {};
  const st = (pid) => (stats[pid] = stats[pid] || { variants: 0, active: 0, withBarcode: 0, skus: 0, text: '' });
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
      if (!c.SKU) return;
      const s = st(c.ProductID);
      s.skus++;
      s.text += ' ' + [c.SKU, c.GTIN, c.InternalBarcode].join(' ');
    });
  const q = cleanText(f.search);
  const qn = normalizeName(q);
  const qu = q.toUpperCase();
  let rows = db_('MASTER_PRODUCTS')
    .rows()
    .filter((p) => (f.status === 'all' || !f.status ? true : p.Status === f.status))
    .filter((p) => (!f.brandId || p.BrandID === f.brandId) && (!f.categoryId || p.CategoryID === f.categoryId))
    .map((p) => {
      const s = stats[p.ProductID] || { variants: 0, active: 0, withBarcode: 0, skus: 0, text: '' };
      const b = brands[p.BrandID] || {};
      const c = cats[p.CategoryID] || {};
      return {
        id: p.ProductID,
        productNo: productNoLabel(p.ProductNo),
        productNoNum: p.ProductNo,
        name: p.ProductName,
        productCode: p.ProductCode,
        baseUnit: p.BaseUnit,
        status: p.Status,
        updatedAt: p.UpdatedAt,
        brandName: b.BrandName,
        brandCode: b.BrandCode,
        categoryName: c.CategoryName,
        categoryCode: c.CategoryCode,
        variantCount: s.variants,
        activeVariants: s.active,
        withBarcode: s.withBarcode,
        skuCount: s.skus,
        complete: s.active > 0 && s.withBarcode === s.active,
        _text: (p.NameKey || '') + ' ' + p.ProductCode + ' ' + s.text.toUpperCase() + ' ' + productNoLabel(p.ProductNo),
      };
    })
    .filter((r) => (f.completeness === 'incomplete' ? !r.complete : f.completeness === 'complete' ? r.complete : true))
    .filter((r) => !q || r._text.indexOf(qn) >= 0 || r._text.toUpperCase().indexOf(qu) >= 0);
  const key = { name: 'name', brand: 'brandName', category: 'categoryName', productNo: 'productNoNum', skus: 'skuCount' }[f.sort] || 'updatedAt';
  const dir = f.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
  rows.forEach((r) => delete r._text);
  return paginate_(rows, f.page, Math.min(Number(f.pageSize) || 25, 200));
}

/** Pencarian ringkas untuk searchable dropdown produk. */
function productSearch_(q) {
  return productList_({ search: q, status: 'all', pageSize: 20, sort: 'name', dir: 'asc' }).rows.map((r) => ({ id: r.id, name: r.name, code: r.productCode, brandName: r.brandName, productNo: r.productNo, status: r.status }));
}

function productSuggestCode_(brandId, name) {
  const base = suggestProductCode(name || '');
  const used = {};
  db_('MASTER_PRODUCTS')
    .filter((p) => p.BrandID === brandId)
    .forEach((p) => (used[p.ProductCode] = 1));
  return { code: uniquifyCode(base, (c) => !!used[c]) };
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
      productNo: productNoLabel(x.p.ProductNo),
      name: x.p.ProductName,
      productCode: x.p.ProductCode,
      status: x.p.Status,
      score: x.score,
      message: x.exact ? `Nama sama dengan "${x.p.ProductName}" (${productNoLabel(x.p.ProductNo)})` : `Nama mirip ${Math.round(x.score * 100)}% dengan "${x.p.ProductName}" (${productNoLabel(x.p.ProductNo)})`,
    }));
}

function productCheck_(p) {
  return { similar: similarProducts_(p.name, p.brandId, p.productId), suggestedCode: p.brandId && p.name ? productSuggestCode_(p.brandId, p.name).code : '' };
}

/**
 * Simpan produk baru / perubahan produk. opts.dryRun = validasi penuh tanpa menulis (pratinjau ringkasan).
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

  // ---------------- Langkah 1: identifikasi produk
  let brand = null;
  let cat = null;
  const collect = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      (e.details.length ? e.details : [{ path: '', message: e.message }]).forEach((d) => err(d.path, d.message, d.code));
      return null;
    }
  };
  const name = cleanText(input.name);
  if (name.length < 3) err('name', 'Nama produk minimal 3 karakter');
  if (name.length > 120) err('name', 'Nama produk maksimal 120 karakter');
  let productCode;
  let baseUnit;
  if (existing) {
    brand = db_('MASTER_BRANDS').byId(existing.BrandID);
    cat = db_('MASTER_CATEGORIES').byId(existing.CategoryID);
    productCode = existing.ProductCode;
    baseUnit = existing.BaseUnit;
    if (input.brandId && input.brandId !== existing.BrandID) err('brandId', 'Brand tidak dapat diubah setelah produk tersimpan (SKU permanen)');
    if (input.categoryId && input.categoryId !== existing.CategoryID) err('categoryId', 'Kategori tidak dapat diubah setelah produk tersimpan (SKU permanen)');
    if (input.productCode && normalizeCode(input.productCode) !== productCode) err('productCode', 'Kode produk tidak dapat diubah setelah produk tersimpan');
    if (input.baseUnit && normalizeUnit(input.baseUnit) !== baseUnit) err('baseUnit', 'Satuan dasar tidak dapat diubah setelah produk tersimpan');
  } else {
    brand = collect(() => activeBrand_(input.brandId));
    cat = collect(() => activeCategory_(input.categoryId));
    productCode = normalizeCode(input.productCode);
    if (!productCode && brand && name) productCode = productSuggestCode_(brand.BrandID, name).code;
    if (!/^[A-Z0-9]{2,16}$/.test(productCode)) err('productCode', 'Kode produk 2–16 huruf/angka');
    else if (brand) {
      const clash = P.find((p) => p.BrandID === brand.BrandID && p.ProductCode === productCode);
      if (clash) err('productCode', `Kode produk ${productCode} sudah dipakai "${clash.ProductName}" pada brand ${brand.BrandName}`, 'DUPLICATE');
    }
    baseUnit = normalizeUnit(input.baseUnit);
    if (!baseUnit) err('baseUnit', 'Pilih satuan dasar');
    else if ((S.base_units || []).indexOf(baseUnit) < 0) err('baseUnit', `Satuan dasar ${baseUnit} tidak ada di daftar (tambahkan di Pengaturan)`);
  }

  // ---------------- Langkah 2: varian
  const dbVariants = existing ? V.filter((v) => v.ProductID === existing.ProductID) : [];
  const newCount = (input.variants || []).filter((v) => !v.id).length;
  const hasVariants = existing ? existing.HasVariants || !!input.hasVariants : !!input.hasVariants;
  if (!dbVariants.length && !newCount) err('variants', 'Minimal satu varian');
  if (!hasVariants && dbVariants.length + newCount !== 1) err('variants', 'Produk tanpa varian harus memiliki tepat satu varian default');
  if (newCount + dbVariants.length > 300) err('variants', 'Maksimal 300 varian per produk');
  const ctx = {
    err,
    hasVariants,
    dbVariants,
    settings: S,
    brandCode: brand ? brand.BrandCode : '',
    categoryCode: cat ? cat.CategoryCode : '',
    productCode,
    baseUnit,
    skuOwner: skuOwnerMap_(existing ? existing.ProductID : null),
  };
  // SKU milik produk sendiri tetap dicatat agar varian/kemasan baru tidak memakai SKU yang sama
  if (existing) {
    dbVariants.forEach((v) => v.SKU && (ctx.skuOwner[v.SKU.toUpperCase()] = 'varian ' + v.VariantName + ' pada produk ini'));
    C.filter((c) => c.ProductID === existing.ProductID && c.SKU).forEach((c) => (ctx.skuOwner[c.SKU.toUpperCase()] = 'kemasan ' + c.UnitName + ' pada produk ini'));
  }
  const vplans = brand && cat ? planVariants_(input, ctx).filter(Boolean) : [];

  // ---------------- Langkah 3: satuan & konversi
  vplans.forEach((vp) => (vp.convs = planConversions_(vp, ctx)));
  if (existing) {
    const activeLeft = dbVariants.filter((v) => {
      const vp = vplans.find((x) => x.dbv && x.dbv.VariantID === v.VariantID);
      return (vp ? vp.status : v.Status) === STATUS.ACTIVE;
    }).length + vplans.filter((x) => !x.dbv && x.status === STATUS.ACTIVE).length;
    if (!activeLeft) err('variants', 'Minimal satu varian harus aktif. Untuk menghentikan produk, nonaktifkan produknya.');
  }

  // barcode yang sama dipakai dua kali di formulir
  const formCodes = {};
  vplans.forEach((vp) => {
    const vl = 'varian ' + (vp.i + 1) + ' (' + vp.name + ')';
    const list = [{ b: vp.iv.barcode, path: vp.path + '.barcode', label: vl }].concat((vp.convs || []).filter((x) => x.isTradeItem && !x.kept).map((x) => ({ b: x.ic.barcode, path: x.path + '.barcode', label: 'kemasan ' + x.unitName + ' ' + vl })));
    list.forEach((x) => {
      const code = x.b && x.b.mode !== 'none' ? cleanBarcode(x.b.code) : '';
      if (!code) return;
      if (formCodes[code]) {
        err(x.path, `Barcode ${code} juga dipakai ${formCodes[code]}. Setiap varian/kemasan wajib punya barcode sendiri.`, 'DUPLICATE');
      } else formCodes[code] = x.label;
    });
  });

  if (errs.length) throw new AppError('Periksa kembali isian (' + errs.length + ' masalah)', errs, 'VALIDATION_FAILED');

  const similar = similarProducts_(name, brand.BrandID, existing ? existing.ProductID : null);
  if (!existing && similar.length && !input.acknowledgeSimilar && !opts.dryRun)
    throw new AppError('Ada produk dengan nama sama/mirip pada brand ini. Pastikan bukan duplikat.', similar.map((s) => ({ path: 'name', message: s.message, code: 'SIMILAR', data: s })), 'SIMILAR_EXISTS');

  // ---------------- Terapkan (di memori; ditulis sekaligus oleh commitAll_)
  const ts = now_();
  const before = existing ? productAuditSummary_(productDetail_(existing.ProductID)) : null;
  let p;
  if (existing) {
    p = existing;
    P.update(p, { ProductName: name, NameKey: normalizeName(name), HasVariants: hasVariants, UpdatedBy: user.email, UpdatedAt: ts, Version: (p.Version || 1) + 1 });
  } else {
    p = P.insert({
      ProductID: uuid_(),
      ProductNo: nextSeq_('product_no'),
      BrandID: brand.BrandID,
      CategoryID: cat.CategoryID,
      ProductName: name,
      NameKey: normalizeName(name),
      ProductCode: productCode,
      BaseUnit: baseUnit,
      HasVariants: hasVariants,
      Status: STATUS.ACTIVE,
      CreatedBy: user.email,
      CreatedAt: ts,
      UpdatedBy: user.email,
      UpdatedAt: ts,
      Version: 1,
    });
  }
  const bcErrs = [];
  let order = dbVariants.reduce((m, v) => Math.max(m, v.SortOrder || 0), 0);
  vplans.forEach((vp) => {
    let v = vp.dbv;
    if (!v) {
      v = V.insert({
        VariantID: uuid_(),
        ProductID: p.ProductID,
        VariantCode: vp.code,
        VariantName: vp.name,
        VariantAttributes: vp.attrs,
        AttributeKey: vp.key,
        SKU: vp.sku,
        GTIN: '',
        InternalBarcode: '',
        IsDefault: !vp.attrs.length,
        Status: vp.status,
        SortOrder: ++order,
        CreatedBy: user.email,
        CreatedAt: ts,
        UpdatedAt: ts,
      });
      C.insert({ ConversionID: uuid_(), VariantID: v.VariantID, ProductID: p.ProductID, UnitName: baseUnit, ConversionFactor: 1, ContainsUnit: baseUnit, BaseUnitEquivalent: 1, IsBaseUnit: true, IsTradeItem: false, SKU: '', GTIN: '', InternalBarcode: '', Status: STATUS.ACTIVE, SortOrder: 0, CreatedAt: ts, UpdatedAt: ts });
    } else if (v.VariantName !== vp.name || v.Status !== vp.status) {
      V.update(v, { VariantName: vp.name, Status: vp.status, UpdatedAt: ts });
    }
    const vb = applyBarcode_(user, vp.iv.barcode, { productId: p.ProductID, variantId: v.VariantID }, v, vp.iv.barcodeChangeReason, vp.path + '.barcode', 'Varian ' + name + ' ' + vp.name, bcErrs);
    if (vb) V.update(v, { GTIN: vb.gtin, InternalBarcode: vb.internal, UpdatedAt: ts });

    let corder = 0;
    (vp.convs || []).forEach((x) => {
      let c = x.dbc;
      const fields = {
        UnitName: x.unitName,
        ConversionFactor: x.factor,
        ContainsUnit: x.containsUnit,
        BaseUnitEquivalent: x.baseUnitEquivalent,
        IsTradeItem: x.isTradeItem,
        SKU: x.sku || '',
        Status: x.status,
        SortOrder: ++corder,
      };
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
 * Terapkan pilihan barcode ke target (varian / kemasan). Mengembalikan {gtin, internal} baru,
 * atau null bila tidak berubah. Error dikumpulkan ke errs (bukan dilempar) agar semua masalah tampil sekaligus.
 */
function applyBarcode_(user, input, target, rec, reason, path, notes, errs) {
  input = input || { mode: 'none' };
  const cur = rec.GTIN || rec.InternalBarcode || '';
  const curType = rec.GTIN ? 'gtin' : rec.InternalBarcode ? 'internal' : 'none';
  const code = cleanBarcode(input.code);
  const mode = input.mode || 'none';
  // tetap: kode sama, atau "internal" tanpa kode pada target yang sudah punya barcode internal
  if (cur && ((mode === curType && code === cur) || (mode === 'internal' && curType === 'internal' && !code))) return null;
  if (!cur && mode === 'none') return null;
  if (cur && cleanText(reason).length < 5) {
    errs.push({ path, message: `Barcode ${cur} sudah tersimpan. Isi alasan perubahan (min. 5 karakter) untuk menggantinya.`, code: 'REASON_REQUIRED' });
    return null;
  }
  try {
    if (cur) unassignBarcode_(user, cur, cleanText(reason));
    if (mode === 'none') return { gtin: '', internal: '' };
    const b = resolveBarcode_(user, input, target, path, notes);
    assignBarcode_(user, b, target, cur ? cleanText(reason) : 'registrasi');
    if (cur) audit_(user.email, 'barcode.change', target.conversionId ? 'conversion' : 'variant', target.conversionId || target.variantId, { code: cur }, { code: b.Code }, { reason: cleanText(reason), productId: target.productId });
    return b.BarcodeType === 'gtin' ? { gtin: b.Code, internal: '' } : { gtin: '', internal: b.Code };
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
  return db_('AuditLog')
    .filter((a) => a.entity_id === id || variantIds[a.entity_id] || (a.meta_json && a.meta_json.productId === id))
    .reverse()
    .slice(0, 100);
}
