/**
/**
 * Child SKU = varian fisik (multi-atribut). Setiap kombinasi atribut = satu Child SKU dengan VariantID (identitas
 * internal) dan SKU PRD000001-001 (urut per parent). Barcode (GTIN produsen / barcode internal) disimpan TERPISAH di
 * VARIANT_BARCODES dan boleh kosong. GTIN tidak disimpan di level Parent. Produk tanpa variasi punya satu Child SKU default.
 * Nama Produk SKU dibentuk otomatis (brand + parent + atribut); override nama wajib beralasan dan tidak mengubah SKU.
 */

function cleanAttributes_(attrs) {
  return (attrs || [])
    .map((a) => ({ name: cleanAttrName(a && a.name), value: formatAttrValue(a && a.value).slice(0, 40) }))
    .filter((a) => a.name && a.value);
}

/** Atribut per varian dari VARIANT_ATTRIBUTES (baris kosong = atribut yang sudah dihapus). */
function attributesByVariant_(productId) {
  const out = {};
  db_('VARIANT_ATTRIBUTES')
    .filter((a) => (!productId || a.ProductID === productId) && a.AttributeName && a.AttributeValue)
    .sort((a, b) => a.SortOrder - b.SortOrder)
    .forEach((a) => (out[a.VariantID] = out[a.VariantID] || []).push({ name: a.AttributeName, value: a.AttributeValue }));
  return out;
}

/** Tulis atribut varian: baris yang ada diperbarui, kelebihan dikosongkan (tidak ada hapus fisik baris sheet). */
function writeAttributes_(variant, attrs) {
  const T = db_('VARIANT_ATTRIBUTES');
  const rows = T.filter((a) => a.VariantID === variant.VariantID).sort((a, b) => a.SortOrder - b.SortOrder);
  attrs.forEach((a, i) => {
    const r = rows[i];
    if (r) {
      if (r.AttributeName !== a.name || r.AttributeValue !== a.value || r.SortOrder !== i + 1) T.update(r, { AttributeName: a.name, AttributeValue: a.value, SortOrder: i + 1 });
    } else T.insert({ VariantAttributeID: uuid_(), VariantID: variant.VariantID, ProductID: variant.ProductID, AttributeName: a.name, AttributeValue: a.value, SortOrder: i + 1 });
  });
  rows.slice(attrs.length).forEach((r) => r.AttributeName && T.update(r, { AttributeName: '', AttributeValue: '', SortOrder: 0 }));
}

/** Nama tampilan Child SKU: override (bila ada) atau nama otomatis. */
function variantDisplayName_(v) {
  return v.NameOverride || v.ProductSKUName || v.VariantName || '';
}

function variantView_(v, convs, attrs, externals, dims, product) {
  const baseUnit = v.BaseUnit || (product && product.BaseUnit) || ((convs || []).find((c) => c.IsBaseUnit) || {}).UnitName || '';
  const dv = dims || [];
  return {
    id: v.VariantID,
    name: v.VariantName,
    skuName: variantDisplayName_(v),
    imageUrl: v.ImageUrl || '',
    generatedName: v.ProductSKUName || '',
    nameOverride: v.NameOverride || '',
    nameOverrideReason: v.NameOverrideReason || '',
    baseUnit,
    dimensions: dv,
    packagingComplete: packagingComplete_(baseUnit, dv),
    attributes: attrs || v.VariantAttributes || [],
    sku: v.SKU,
    gtin: v.GTIN || '',
    internalBarcode: v.InternalBarcode || '',
    barcodeType: v.GTIN ? 'gtin' : v.InternalBarcode ? 'internal' : 'none',
    isDefault: v.IsDefault,
    status: v.Status,
    sortOrder: v.SortOrder,
    createdAt: v.CreatedAt,
    conversions: (convs || []).map(conversionView_),
    externalSkus: externals || [],
    stockable: v.Stockable !== 'NON_STOCKABLE',
    batchTracking: v.BatchTracking,
    expiryTracking: v.ExpiryTracking,
    shelfLifeMonths: v.ShelfLifeMonths,
    purchaseUnit: v.PurchaseUnit || '',
    salesUnit: v.SalesUnit || '',
    replacedBy: v.ReplacedByVariantID || '',
  };
}

/**
 * Validasi daftar Child SKU dari formulir (baru + tersimpan). Mengisi errs lewat ctx.err; mengembalikan rencana per varian.
 * ctx: { err, dbVariants, newStatus, baseUnit (default produk), brandName, parentName, types, baseUnits }
 */
function planVariants_(input, ctx) {
  const err = ctx.err;
  const seenIds = {};
  const keys = {};
  const mentioned = {};
  (input.variants || []).forEach((iv) => iv.id && (mentioned[iv.id] = 1));
  // varian tersimpan yang tidak dikirim formulir tetap dihitung untuk cek kombinasi ganda
  ctx.dbVariants.filter((v) => !mentioned[v.VariantID]).forEach((v) => (keys[v.AttributeKey || ''] = 'Child SKU ' + v.SKU));
  const dbBase = {};
  db_('UNIT_CONVERSIONS')
    .filter((c) => c.IsBaseUnit && ctx.dbVariants.some((v) => v.VariantID === c.VariantID))
    .forEach((c) => (dbBase[c.VariantID] = c.UnitName));
  const plans = (input.variants || []).map((iv, i) => {
    const path = 'variants.' + i;
    const dbv = iv.id ? ctx.dbVariants.find((v) => v.VariantID === iv.id) : null;
    if (iv.id && !dbv) {
      err(path, 'Child SKU tidak ditemukan pada produk ini');
      return null;
    }
    if (iv.id && seenIds[iv.id]) {
      err(path, 'Child SKU dikirim dua kali');
      return null;
    }
    if (iv.id) seenIds[iv.id] = 1;
    const attrs = orderAttributes(standardizeAttributes_(cleanAttributes_(iv.attributes)), ctx.types);
    const names = attrs.map((a) => normalizeName(a.name));
    if (new Set(names).size !== names.length) err(path + '.attributes', 'Jenis atribut ganda dalam satu varian');
    // status lifecycle: varian baru mengikuti produk (DRAFT/ACTIVE); varian tersimpan hanya boleh transisi yang sah
    let status = dbv ? dbv.Status : ctx.newStatus;
    if (dbv && iv.status && iv.status !== dbv.Status) {
      try {
        lifecycleCheck_(dbv.Status, iv.status, iv.statusReason || 'Diubah lewat edit produk', 'SKU ' + dbv.SKU);
        status = iv.status;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        err(path + '.status', e.message);
      }
    }
    // barcode opsional: GTIN produsen (boleh dikosongkan dulu → ditandai "GTIN belum didata"), atau nomor internal dari sistem
    if (iv.barcode && iv.barcode.mode === 'gtin' && !cleanBarcode(iv.barcode.code)) iv.barcode = { mode: 'none' };
    // satuan dasar per Child SKU (default dari produk)
    const curBase = dbv ? dbv.BaseUnit || dbBase[dbv.VariantID] || '' : '';
    const baseUnit = normalizeUnit(iv.baseUnit) || curBase || ctx.baseUnit;
    if (!baseUnit) err(path + '.baseUnit', 'Pilih satuan dasar');
    else if (baseUnit !== curBase && (ctx.baseUnits || []).indexOf(baseUnit) < 0) err(path + '.baseUnit', `Satuan dasar ${baseUnit} tidak ada di daftar (tambahkan di Settings)`);
    if (dbv && curBase && baseUnit !== curBase && db_('UNIT_CONVERSIONS').filter((c) => c.VariantID === dbv.VariantID && !c.IsBaseUnit && c.Status !== STATUS.DELETED).length)
      err(path + '.baseUnit', 'Satuan dasar tidak dapat diganti selama Child SKU ini masih punya satuan kemasan. Hapus kemasannya dulu.');
    // konfigurasi lama (batch/expiry, satuan beli/jual) tidak lagi diisi lewat formulir — nilainya dipertahankan
    const keep = (k, f, def) => (iv[k] !== undefined ? f(iv[k]) : dbv ? dbv[k.charAt(0).toUpperCase() + k.slice(1)] : def);
    const inv = {
      batchTracking: keep('batchTracking', (x) => !!x, false),
      expiryTracking: keep('expiryTracking', (x) => !!x, false),
      shelfLifeMonths: keep('shelfLifeMonths', (x) => (x === '' || x === null ? null : Number(x)), null),
      purchaseUnit: keep('purchaseUnit', normalizeUnit, ''),
      salesUnit: keep('salesUnit', normalizeUnit, ''),
    };
    const key = attributeKey(attrs);
    const name = (attrs.map((a) => a.value).join(' ') || 'Standar').slice(0, 120);
    // nama Produk SKU otomatis + override beralasan (tidak mengubah SKU)
    const generated = buildSkuName(ctx.brandName, ctx.parentName, attrs, ctx.types);
    let override = iv.nameOverride === undefined ? (dbv ? dbv.NameOverride || '' : '') : cleanText(iv.nameOverride).slice(0, 200);
    if (override && override === generated) override = '';
    let overrideReason = dbv ? dbv.NameOverrideReason || '' : '';
    if (override && override !== (dbv ? dbv.NameOverride || '' : '')) {
      overrideReason = cleanText(iv.nameOverrideReason);
      if (override.length < 3) err(path + '.nameOverride', 'Nama tampilan minimal 3 karakter');
      if (overrideReason.length < 5) err(path + '.nameOverride', 'Isi alasan perubahan nama (min. 5 karakter)');
    }
    if (!override) overrideReason = '';
    // foto Child SKU: tautan https (mis. CDN marketplace) atau file yang diunggah ke Drive
    let imageUrl = iv.imageUrl === undefined ? (dbv ? dbv.ImageUrl || '' : '') : cleanText(iv.imageUrl);
    let imageFileId = iv.imageUrl === undefined ? (dbv ? dbv.ImageFileId || '' : '') : cleanText(iv.imageFileId);
    if (imageUrl && !/^https:\/\/[^\s<>"']+$/i.test(imageUrl)) err(path + '.imageUrl', 'Link foto harus diawali https://');
    if (imageUrl.length > 500) err(path + '.imageUrl', 'Link foto terlalu panjang (maks. 500 karakter)');
    if (!imageUrl) imageFileId = '';
    if (keys[key] !== undefined) err(path + '.attributes', key ? `Kombinasi atribut ini sama dengan ${keys[key]}` : 'Child SKU default (tanpa atribut) sudah ada');
    keys[key] = 'baris varian ' + (i + 1);
    return { i, path, iv, dbv, attrs, key, name, status, imageUrl, imageFileId, inv, invExplicit: { purchaseUnit: iv.purchaseUnit !== undefined, salesUnit: iv.salesUnit !== undefined }, baseUnit, generated, override, overrideReason, sku: dbv ? dbv.SKU : '' };
  });
  // lebih dari satu Child SKU → setiap Child SKU wajib punya atribut pembeda
  const live = plans.filter((p) => p && [STATUS.ACTIVE, STATUS.DRAFT].indexOf(p.status) >= 0);
  const dbLive = ctx.dbVariants.filter((v) => !mentioned[v.VariantID] && [STATUS.ACTIVE, STATUS.DRAFT].indexOf(v.Status) >= 0);
  if (live.length + dbLive.length > 1)
    live.filter((p) => !p.attrs.length).forEach((p) => err(p.path + '.attributes', 'Produk dengan beberapa varian: isi atribut pembeda (mis. Warna, Volume) untuk setiap baris'));
  return plans;
}

/** Peta semua SKU terpakai (varian, kemasan, termasuk nonaktif) → label pemilik. SKU tidak pernah dipakai ulang. */
function skuOwnerMap_() {
  const prods = indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID');
  const out = {};
  const label = (pid) => {
    const p = prods[pid];
    return p ? `${p.ProductName} [${p.ProductCode}]` : 'produk lain';
  };
  db_('PRODUCT_VARIANTS')
    .rows()
    .forEach((v) => v.SKU && (out[v.SKU.toUpperCase()] = label(v.ProductID)));
  db_('UNIT_CONVERSIONS')
    .rows()
    .forEach((c) => c.SKU && (out[c.SKU.toUpperCase()] = label(c.ProductID) + ' (kemasan ' + c.UnitName + ')'));
  db_('BUNDLE_MASTERS')
    .rows()
    .forEach((b) => b.BundleSKU && (out[b.BundleSKU.toUpperCase()] = 'bundle ' + b.BundleName));
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.System === 'legacy' && m.ExternalSku)
    .forEach((m) => (out[String(m.ExternalSku).toUpperCase()] = out[String(m.ExternalSku).toUpperCase()] || 'SKU lama'));
  return out;
}

