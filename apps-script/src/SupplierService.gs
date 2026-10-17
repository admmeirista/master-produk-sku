/**
 * Master Supplier & Supplier Product Mapping.
 * Satu Child SKU boleh tersedia dari banyak supplier; kode produk supplier yang berbeda TIDAK membuat SKU internal baru.
 * Mapping menyimpan satuan beli & faktor konversi ke satuan stok (bilangan bulat, tanpa floating point) serta MOQ.
 * Bila spesifikasi fisik barang supplier berbeda, mapping ditandai SpecMismatch untuk evaluasi Child SKU baru.
 * Harga pembelian di luar cakupan aplikasi.
 */

function supplierView_(s, counts) {
  return { id: s.SupplierID, code: s.SupplierCode, name: s.SupplierName, contactName: s.ContactName || '', phone: s.Phone || '', email: s.Email || '', notes: s.Notes || '', status: s.Status, createdAt: s.CreatedAt, mappingCount: counts ? counts[s.SupplierID] || 0 : undefined };
}

function supplierList_(f) {
  f = f || {};
  const counts = {};
  db_('SUPPLIER_PRODUCT_MAPPING')
    .filter((m) => m.Status === STATUS.ACTIVE)
    .forEach((m) => (counts[m.SupplierID] = (counts[m.SupplierID] || 0) + 1));
  return db_('MASTER_SUPPLIERS')
    .filter((s) => s.Status !== STATUS.DELETED && (!f.activeOnly || s.Status === STATUS.ACTIVE))
    .map((s) => supplierView_(s, counts))
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

function supplierSave_(user, input) {
  const T = db_('MASTER_SUPPLIERS');
  const name = cleanText(input.name);
  if (name.length < 2 || name.length > 100) throw new AppError('Nama supplier 2–100 karakter', [{ path: 'name', message: 'Wajib' }], 'VALIDATION_FAILED');
  const email = cleanText(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Email tidak valid', [{ path: 'email', message: 'Format email' }], 'VALIDATION_FAILED');
  const key = masterNameKey(name);
  const dup = T.find((s) => s.NameKey === key && s.SupplierID !== input.id && s.Status !== STATUS.DELETED);
  if (dup) throw new AppError(`Supplier "${dup.SupplierName}" sudah terdaftar (${dup.SupplierCode})`, [{ path: 'name', message: 'Duplikat' }], 'DUPLICATE');
  const fields = { SupplierName: name, NameKey: key, ContactName: cleanText(input.contactName), Phone: cleanText(input.phone), Email: email, Notes: cleanText(input.notes).slice(0, 500), UpdatedBy: user.email, UpdatedAt: now_() };
  if (input.id) {
    const rec = T.byId(input.id);
    if (!rec || rec.Status === STATUS.DELETED) throw new AppError('Supplier tidak ditemukan', [], 'NOT_FOUND');
    const before = supplierView_(rec);
    T.update(rec, fields);
    audit_(user.email, 'supplier.update', 'supplier', rec.SupplierID, before, supplierView_(rec));
    return supplierView_(rec);
  }
  const used = {};
  T.rows().forEach((s) => (used[s.SupplierCode] = 1));
  let code;
  do code = SUPPLIER_PREFIX + String(nextSeq_('supplier_no')).padStart(4, '0');
  while (used[code]);
  const rec = T.insert(Object.assign({ SupplierID: uuid_(), SupplierCode: code, Status: STATUS.ACTIVE, CreatedBy: user.email, CreatedAt: now_() }, fields));
  audit_(user.email, 'supplier.create', 'supplier', rec.SupplierID, null, supplierView_(rec));
  return supplierView_(rec);
}

function supplierSetStatus_(user, input) {
  const rec = db_('MASTER_SUPPLIERS').byId(input.id);
  if (!rec || rec.Status === STATUS.DELETED) throw new AppError('Supplier tidak ditemukan', [], 'NOT_FOUND');
  const to = input.status === STATUS.ACTIVE ? STATUS.ACTIVE : STATUS.INACTIVE;
  if (rec.Status === to) return supplierView_(rec);
  const before = rec.Status;
  db_('MASTER_SUPPLIERS').update(rec, { Status: to, UpdatedBy: user.email, UpdatedAt: now_() });
  audit_(user.email, 'supplier.status', 'supplier', rec.SupplierID, { status: before }, { status: to });
  return supplierView_(rec);
}

// ------------------------------------------------------------------ mapping kode produk supplier

function supplierMapView_(m, ctx) {
  const v = ctx.variants[m.VariantID] || {};
  const p = ctx.products[v.ProductID] || {};
  const s = ctx.suppliers[m.SupplierID] || {};
  return {
    id: m.SupplierMapID,
    supplierId: m.SupplierID,
    supplierCode: s.SupplierCode,
    supplierName: s.SupplierName,
    supplierProductCode: m.SupplierProductCode,
    supplierProductName: m.SupplierProductName || '',
    variantId: m.VariantID,
    productId: v.ProductID,
    sku: v.SKU,
    productName: p.ProductName,
    variantName: v.IsDefault ? '' : v.VariantName,
    skuStatus: v.Status,
    baseUnit: p.BaseUnit,
    purchaseUnit: m.PurchaseUnit,
    conversionFactor: m.ConversionFactor,
    moq: m.MinimumOrderQuantity,
    specMismatch: m.SpecMismatch,
    specNote: m.SpecNote || '',
    status: m.Status,
    updatedAt: m.UpdatedAt,
  };
}

function supplierMapCtx_() {
  return { variants: indexBy_(db_('PRODUCT_VARIANTS').rows(), 'VariantID'), products: indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID'), suppliers: indexBy_(db_('MASTER_SUPPLIERS').rows(), 'SupplierID') };
}

function supplierMapList_(f) {
  f = f || {};
  const ctx = supplierMapCtx_();
  const q = String(f.search || '').toUpperCase();
  const rows = db_('SUPPLIER_PRODUCT_MAPPING')
    .filter((m) => (f.status === 'all' ? m.Status !== STATUS.DELETED : m.Status === (f.status || STATUS.ACTIVE)) && (!f.supplierId || m.SupplierID === f.supplierId) && (!f.variantId || m.VariantID === f.variantId) && (!f.productId || m.ProductID === f.productId))
    .map((m) => supplierMapView_(m, ctx))
    .filter((m) => !q || [m.supplierProductCode, m.supplierProductName, m.sku, m.productName, m.supplierName].join(' ').toUpperCase().indexOf(q) >= 0)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return paginate_(rows, f.page, Math.min(Number(f.pageSize) || 50, 200));
}

/** Cari barang berdasarkan kode supplier (dipakai juga oleh Scan Barcode). */
function supplierCodeLookup_(code) {
  const key = normalizeCode(code);
  if (!key) return [];
  const ctx = supplierMapCtx_();
  return db_('SUPPLIER_PRODUCT_MAPPING')
    .filter((m) => m.SupplierCodeKey === key && m.Status === STATUS.ACTIVE)
    .map((m) => supplierMapView_(m, ctx));
}

function supplierMapSave_(user, input) {
  const T = db_('SUPPLIER_PRODUCT_MAPPING');
  const errs = [];
  const sup = db_('MASTER_SUPPLIERS').byId(input.supplierId);
  if (!sup || sup.Status !== STATUS.ACTIVE) errs.push({ path: 'supplierId', message: 'Pilih supplier aktif' });
  const code = cleanText(input.supplierProductCode).toUpperCase();
  const key = normalizeCode(code);
  if (!key || code.length > 60) errs.push({ path: 'supplierProductCode', message: 'Kode produk supplier wajib (maks. 60 karakter)' });
  const v = db_('PRODUCT_VARIANTS').byId(input.variantId);
  let p = null;
  try {
    p = input.id && v && T.byId(input.id) && T.byId(input.id).VariantID === v.VariantID ? db_('MASTER_PRODUCTS').byId(v.ProductID) : assertUsableVariant_(v, 'variantId');
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    errs.push({ path: 'variantId', message: e.message });
  }
  const factor = Number(input.conversionFactor);
  if (!(Number.isInteger(factor) && factor >= 1 && factor <= 100000)) errs.push({ path: 'conversionFactor', message: 'Faktor konversi bilangan bulat 1–100.000' });
  const unit = normalizeUnit(input.purchaseUnit) || (p && p.BaseUnit);
  if (!/^[A-Z][A-Z0-9]{1,11}$/.test(unit || '')) errs.push({ path: 'purchaseUnit', message: 'Satuan beli 2–12 huruf/angka' });
  if (p && unit === p.BaseUnit && factor !== 1) errs.push({ path: 'conversionFactor', message: `Satuan beli = satuan stok (${p.BaseUnit}), faktor harus 1` });
  // konsisten dengan kemasan yang terdaftar di varian (bila satuan yang sama sudah didefinisikan)
  if (v && unit && p && unit !== p.BaseUnit) {
    const conv = db_('UNIT_CONVERSIONS').find((c) => c.VariantID === v.VariantID && c.UnitName === unit && c.Status === STATUS.ACTIVE);
    if (conv && conv.BaseUnitEquivalent !== factor) errs.push({ path: 'conversionFactor', message: `Kemasan ${unit} varian ini berisi ${conv.BaseUnitEquivalent} ${p.BaseUnit}, bukan ${factor}. Bila isi supplier memang berbeda, gunakan nama satuan lain (mis. ${unit}${factor}).` });
  }
  const moq = input.moq === '' || input.moq === null || input.moq === undefined ? null : Number(input.moq);
  if (moq !== null && !(Number.isInteger(moq) && moq >= 1)) errs.push({ path: 'moq', message: 'MOQ bilangan bulat ≥ 1' });
  if (sup && key) {
    const dup = T.find((m) => m.SupplierID === sup.SupplierID && m.SupplierCodeKey === key && m.Status === STATUS.ACTIVE && m.SupplierMapID !== input.id);
    if (dup) {
      const dv = db_('PRODUCT_VARIANTS').byId(dup.VariantID) || {};
      errs.push({ path: 'supplierProductCode', message: `Kode ${code} dari ${sup.SupplierName} sudah dipetakan ke SKU ${dv.SKU}`, code: 'DUPLICATE' });
    }
  }
  if (errs.length) throw new AppError('Periksa kembali mapping supplier', errs, 'VALIDATION_FAILED');
  const fields = { SupplierID: sup.SupplierID, SupplierProductCode: code, SupplierCodeKey: key, SupplierProductName: cleanText(input.supplierProductName).slice(0, 200), VariantID: v.VariantID, ProductID: v.ProductID, PurchaseUnit: unit, ConversionFactor: factor, MinimumOrderQuantity: moq, SpecMismatch: !!input.specMismatch, SpecNote: cleanText(input.specNote).slice(0, 300), UpdatedBy: user.email, UpdatedAt: now_() };
  const ctx = supplierMapCtx_();
  if (input.id) {
    const rec = T.byId(input.id);
    if (!rec || rec.Status === STATUS.DELETED) throw new AppError('Mapping tidak ditemukan', [], 'NOT_FOUND');
    const before = supplierMapView_(rec, ctx);
    T.update(rec, fields);
    audit_(user.email, 'supplier_map.update', 'supplier_map', rec.SupplierMapID, before, supplierMapView_(rec, ctx), { productId: v.ProductID });
    return supplierMapView_(rec, ctx);
  }
  const rec = T.insert(Object.assign({ SupplierMapID: uuid_(), Status: STATUS.ACTIVE, CreatedBy: user.email, CreatedAt: now_() }, fields));
  audit_(user.email, 'supplier_map.create', 'supplier_map', rec.SupplierMapID, null, supplierMapView_(rec, ctx), { productId: v.ProductID });
  return supplierMapView_(rec, ctx);
}

function supplierMapSetStatus_(user, input) {
  const rec = db_('SUPPLIER_PRODUCT_MAPPING').byId(input.id);
  if (!rec || rec.Status === STATUS.DELETED) throw new AppError('Mapping tidak ditemukan', [], 'NOT_FOUND');
  const to = input.status === STATUS.ACTIVE ? STATUS.ACTIVE : STATUS.INACTIVE;
  if (to === STATUS.ACTIVE) {
    assertUsableVariant_(db_('PRODUCT_VARIANTS').byId(rec.VariantID), 'variantId');
    if (db_('SUPPLIER_PRODUCT_MAPPING').find((m) => m.SupplierID === rec.SupplierID && m.SupplierCodeKey === rec.SupplierCodeKey && m.Status === STATUS.ACTIVE && m.SupplierMapID !== rec.SupplierMapID)) throw new AppError('Kode supplier ini sudah aktif di mapping lain', [], 'DUPLICATE');
  }
  const before = rec.Status;
  db_('SUPPLIER_PRODUCT_MAPPING').update(rec, { Status: to, UpdatedBy: user.email, UpdatedAt: now_() });
  audit_(user.email, 'supplier_map.status', 'supplier_map', rec.SupplierMapID, { status: before }, { status: to }, { productId: rec.ProductID, reason: cleanText(input.reason) });
  return { id: rec.SupplierMapID, status: to };
}
