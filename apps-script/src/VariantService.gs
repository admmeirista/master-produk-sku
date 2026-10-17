/**
 * Varian fisik (multi-atribut). Setiap kombinasi atribut = satu varian dengan VariantID & SKU internal sendiri
 * (SKU000123) dan GTIN/barcode sendiri. GTIN TIDAK disimpan di level Product Master.
 * Produk tanpa varian eksplisit tetap punya satu varian default (tanpa atribut) agar struktur konsisten.
 * Karena SKU tidak bergantung pada atribut, atribut boleh dikoreksi kapan pun (tetap unik per produk & tercatat di audit).
 */

function cleanAttributes_(attrs) {
  return (attrs || [])
    .map((a) => ({ name: cleanAttrName(a && a.name), value: cleanText(a && a.value).slice(0, 40) }))
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

function variantView_(v, convs, attrs, externals) {
  return {
    id: v.VariantID,
    name: v.VariantName,
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
 * Validasi daftar varian dari formulir (baru + tersimpan). Mengisi errs lewat ctx.err; mengembalikan rencana per varian.
 * ctx: { hasVariants, dbVariants, dbAttrs, err }
 */
function planVariants_(input, ctx) {
  const err = ctx.err;
  const seenIds = {};
  const keys = {};
  const mentioned = {};
  (input.variants || []).forEach((iv) => iv.id && (mentioned[iv.id] = 1));
  // varian tersimpan yang tidak dikirim formulir tetap dihitung untuk cek kombinasi ganda
  ctx.dbVariants.filter((v) => !mentioned[v.VariantID]).forEach((v) => (keys[v.AttributeKey || ''] = 'varian ' + v.VariantName));
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
    const attrs = standardizeAttributes_(cleanAttributes_(iv.attributes));
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
    // konfigurasi inventory (hanya konfigurasi — saldo & lot aktual ada di sistem inventory)
    const shelf = iv.shelfLifeMonths === '' || iv.shelfLifeMonths === null || iv.shelfLifeMonths === undefined ? null : Number(iv.shelfLifeMonths);
    if (shelf !== null && !(Number.isInteger(shelf) && shelf >= 1 && shelf <= 600)) err(path + '.shelfLifeMonths', 'Masa simpan 1–600 bulan (bilangan bulat)');
    const inv = { batchTracking: !!iv.batchTracking, expiryTracking: !!iv.expiryTracking, shelfLifeMonths: shelf, purchaseUnit: normalizeUnit(iv.purchaseUnit), salesUnit: normalizeUnit(iv.salesUnit) };
    const key = attributeKey(attrs);
    const autoName = attrs.map((a) => a.value).join(' ');
    let name = (cleanText(iv.name) || autoName || 'Standar').slice(0, 120);
    // nama otomatis (gabungan nilai atribut lama) ikut diperbarui saat atribut dikoreksi
    if (dbv && key !== (dbv.AttributeKey || '') && cleanText(iv.name) === (dbv.VariantAttributes || []).map((a) => a.value).join(' ')) name = (autoName || 'Standar').slice(0, 120);
    if (ctx.hasVariants && !attrs.length) err(path + '.attributes', 'Isi minimal satu atribut (mis. Aroma, Volume)');
    if (!ctx.hasVariants && attrs.length && !dbv) err(path + '.attributes', 'Mode Quick Entry tidak memakai atribut');
    if (keys[key] !== undefined) err(path + '.attributes', key ? `Kombinasi atribut ini sama dengan ${keys[key]}` : 'Varian default (tanpa atribut) sudah ada');
    keys[key] = 'baris varian ' + (i + 1);
    return { i, path, iv, dbv, attrs, key, name, status, inv, sku: dbv ? dbv.SKU : '' };
  });
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
  return out;
}

