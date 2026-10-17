/**
 * Varian fisik (multi-atribut). Setiap kombinasi atribut = satu varian dengan VariantID unik,
 * SKU sendiri, dan GTIN/barcode sendiri. GTIN TIDAK disimpan di level Product Master.
 * Produk tanpa varian eksplisit tetap punya satu varian default (atribut kosong) agar struktur konsisten.
 */

function cleanAttributes_(attrs) {
  return (attrs || [])
    .map((a) => ({ name: cleanAttrName(a && a.name), value: cleanText(a && a.value).slice(0, 40) }))
    .filter((a) => a.name && a.value);
}

function variantView_(v, convs) {
  const bcType = v.GTIN ? 'gtin' : v.InternalBarcode ? 'internal' : 'none';
  return {
    id: v.VariantID,
    code: v.VariantCode || '',
    name: v.VariantName,
    attributes: v.VariantAttributes || [],
    sku: v.SKU,
    gtin: v.GTIN || '',
    internalBarcode: v.InternalBarcode || '',
    barcodeType: bcType,
    isDefault: v.IsDefault,
    status: v.Status,
    sortOrder: v.SortOrder,
    createdAt: v.CreatedAt,
    conversions: (convs || []).map(conversionView_),
  };
}

/**
 * Validasi daftar varian dari formulir (baru + yang sudah tersimpan). Mengisi errs; mengembalikan rencana per varian.
 * ctx: { hasVariants, dbVariants, settings, brandCode, categoryCode, productCode, skuOwner, err }
 */
function planVariants_(input, ctx) {
  const err = ctx.err;
  const keys = {};
  const codes = {};
  ctx.dbVariants.forEach((v) => {
    keys[v.AttributeKey || ''] = v.VariantID;
    codes[v.VariantCode || ''] = v.VariantID;
  });
  const seenIds = {};
  const plans = (input.variants || []).map((iv, i) => {
    const path = 'variants.' + i;
    const dbv = iv.id ? ctx.dbVariants.find((v) => v.VariantID === iv.id) : null;
    if (iv.id && !dbv) {
      err(path, 'Varian tidak ditemukan pada produk ini');
      return null;
    }
    if (iv.id && seenIds[iv.id]) {
      err(path, 'Varian dikirim dua kali');
      return null;
    }
    if (iv.id) seenIds[iv.id] = 1;
    const attrs = cleanAttributes_(iv.attributes);
    const names = attrs.map((a) => normalizeName(a.name));
    if (new Set(names).size !== names.length) err(path + '.attributes', 'Jenis atribut ganda dalam satu varian');
    const status = iv.status === STATUS.INACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE;
    const name = (cleanText(iv.name) || attrs.map((a) => a.value).join(' ') || 'Standar').slice(0, 120);
    if (dbv) {
      if (attributeKey(attrs) !== (dbv.AttributeKey || '')) err(path + '.attributes', 'Atribut varian yang sudah tersimpan tidak dapat diubah (identitas & SKU permanen). Nonaktifkan, lalu buat varian baru.');
      if (iv.variantCode !== undefined && iv.variantCode !== null && normalizeCode(iv.variantCode) !== (dbv.VariantCode || '')) err(path + '.variantCode', 'Kode varian yang sudah tersimpan tidak dapat diubah');
      return { i, path, iv, dbv, attrs, name, status, code: dbv.VariantCode || '', sku: dbv.SKU };
    }
    const key = attributeKey(attrs);
    if (ctx.hasVariants && !attrs.length) err(path + '.attributes', 'Isi minimal satu atribut (mis. Aroma, Volume)');
    if (!ctx.hasVariants && attrs.length) err(path + '.attributes', 'Produk tanpa varian tidak memakai atribut');
    if (keys[key] !== undefined) err(path + '.attributes', key ? 'Kombinasi atribut ini sudah ada pada produk yang sama' : 'Varian default sudah ada');
    keys[key] = 'new' + i;
    let code = normalizeCode(iv.variantCode);
    if (!code && attrs.length) code = uniquifyCode(suggestVariantCode(attrs) || 'V', (c) => codes[c] !== undefined);
    if (code.length > 12) err(path + '.variantCode', 'Kode varian maksimal 12 huruf/angka');
    if (ctx.hasVariants && !code) err(path + '.variantCode', 'Kode varian wajib diisi');
    if (codes[code] !== undefined) err(path + '.variantCode', `Kode varian ${code || '(kosong)'} sudah dipakai varian lain`);
    codes[code] = 'new' + i;
    const gen = buildSku(ctx.settings.sku_template, { brand: ctx.brandCode, category: ctx.categoryCode, product: ctx.productCode, variant: code });
    if (!gen.ok) err(path + '.sku', 'SKU tidak dapat dibuat: ' + gen.missing.map((m) => 'data ' + m + ' kosong').concat(gen.errors).join('; '));
    else claimSku_(ctx, gen.sku, path + '.sku');
    return { i, path, iv, dbv: null, attrs, key, name, status, code, sku: gen.sku };
  });
  return plans;
}

/** Pastikan SKU unik global (varian + kemasan, termasuk yang nonaktif) dan unik di formulir. */
function claimSku_(ctx, sku, path) {
  const up = String(sku).toUpperCase();
  const owner = ctx.skuOwner[up];
  if (owner) ctx.err(path, `SKU ${sku} sudah dipakai ${owner}`, 'SKU_IN_USE');
  else ctx.skuOwner[up] = 'baris lain di formulir ini';
}

function skuOwnerMap_(exceptProductId) {
  const prods = indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID');
  const out = {};
  const label = (pid) => {
    const p = prods[pid];
    return p ? `${p.ProductName} [${productNoLabel(p.ProductNo)}]` : 'produk lain';
  };
  db_('PRODUCT_VARIANTS')
    .rows()
    .forEach((v) => v.SKU && (out[v.SKU.toUpperCase()] = label(v.ProductID)));
  db_('UNIT_CONVERSIONS')
    .rows()
    .forEach((c) => c.SKU && (out[c.SKU.toUpperCase()] = label(c.ProductID) + ' (kemasan ' + c.UnitName + ')'));
  if (exceptProductId) {
    // SKU milik produk yang sedang diedit tidak dianggap bentrok dengan dirinya sendiri
    db_('PRODUCT_VARIANTS')
      .filter((v) => v.ProductID === exceptProductId)
      .forEach((v) => v.SKU && delete out[v.SKU.toUpperCase()]);
    db_('UNIT_CONVERSIONS')
      .filter((c) => c.ProductID === exceptProductId)
      .forEach((c) => c.SKU && delete out[c.SKU.toUpperCase()]);
  }
  return out;
}

/** Aktif/nonaktifkan satu varian (tanpa menghapus — SKU & barcode tetap tercatat). */
function variantSetStatus_(user, input) {
  const v = db_('PRODUCT_VARIANTS').byId(input.id);
  if (!v) throw new AppError('Varian tidak ditemukan', [], 'NOT_FOUND');
  const status = input.status === STATUS.ACTIVE ? STATUS.ACTIVE : STATUS.INACTIVE;
  if (v.Status === status) return variantView_(v, []);
  if (status === STATUS.INACTIVE) {
    const others = db_('PRODUCT_VARIANTS').filter((x) => x.ProductID === v.ProductID && x.VariantID !== v.VariantID && x.Status === STATUS.ACTIVE);
    if (!others.length) throw new AppError('Varian terakhir yang aktif tidak dapat dinonaktifkan. Nonaktifkan produknya.');
  }
  const before = v.Status;
  db_('PRODUCT_VARIANTS').update(v, { Status: status, UpdatedAt: now_() });
  touchProduct_(user, v.ProductID);
  audit_(user.email, status === STATUS.ACTIVE ? 'variant.activate' : 'variant.deactivate', 'variant', v.VariantID, { status: before }, { status, sku: v.SKU }, { productId: v.ProductID, reason: cleanText(input.reason) });
  return variantView_(v, []);
}
