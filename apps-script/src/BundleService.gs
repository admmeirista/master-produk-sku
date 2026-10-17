/**
 * Multipack & Bundle (Bill of Materials).
 *   Type A — konversi kemasan (UNIT_CONVERSIONS): BUKAN bundle, tidak wajib SKU baru.
 *   Type B — MULTIPACK  : 1 Child SKU × N dijual dengan identitas sendiri (SKU MP000001).
 *   Type C — MIXED      : beberapa Child SKU berbeda (SKU BDL000001).
 *          — REQUEST_MIX: customer memilih isi dari daftar komponen; komposisi AKTUAL dipilih saat pemenuhan pesanan.
 * StockMode VIRTUAL  → non-stockable: tidak punya saldo sendiri, stok dihitung dari komponen (tanpa double counting).
 * StockMode PREASSEMBLED → stockable: benar-benar dirakit & disimpan sebagai barang terpisah; perakitan dijalankan
 *   oleh sistem inventory (aplikasi ini hanya menyimpan definisinya).
 * Komponen selalu Child SKU (bukan bundle) → BOM tidak mungkin bersiklus.
 */

const BUNDLE_TYPES = { MULTIPACK: 'Multipack', MIXED: 'Mixed bundle', REQUEST_MIX: 'Request mix' };

function bundleView_(b, ctx) {
  ctx = ctx || { variants: indexBy_(db_('PRODUCT_VARIANTS').rows(), 'VariantID'), products: indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID') };
  const comps = db_('BUNDLE_COMPONENTS')
    .filter((c) => c.BundleID === b.BundleID && c.Status === STATUS.ACTIVE)
    .sort((x, y) => x.SortOrder - y.SortOrder)
    .map((c) => {
      const v = ctx.variants[c.VariantID] || {};
      const p = ctx.products[v.ProductID] || {};
      return { id: c.ComponentID, variantId: c.VariantID, productId: v.ProductID, sku: v.SKU, name: cleanText((p.ProductName || '') + (v.IsDefault ? '' : ' ' + (v.VariantName || ''))), quantity: c.Quantity, selectable: c.Selectable, skuStatus: v.Status === STATUS.ACTIVE && p.Status === STATUS.ACTIVE ? STATUS.ACTIVE : v.Status !== STATUS.ACTIVE ? v.Status : p.Status, baseUnit: p.BaseUnit };
    });
  const bc = db_('VARIANT_BARCODES').find((x) => x.BundleID === b.BundleID && x.Status === 'ACTIVE');
  return { id: b.BundleID, sku: b.BundleSKU, type: b.BundleType, typeLabel: BUNDLE_TYPES[b.BundleType], name: b.BundleName, stockMode: b.StockMode, stockable: b.Stockable === 'STOCKABLE', pickQuantity: b.PickQuantity, status: b.Status, description: b.Description || '', version: b.Version, barcode: bc ? bc.Code : '', barcodeType: bc ? bc.BarcodeType : '', components: comps, createdAt: b.CreatedAt, updatedAt: b.UpdatedAt };
}

function bundleList_(f) {
  f = f || {};
  const ctx = { variants: indexBy_(db_('PRODUCT_VARIANTS').rows(), 'VariantID'), products: indexBy_(db_('MASTER_PRODUCTS').rows(), 'ProductID') };
  const q = String(f.search || '').toUpperCase();
  let rows = db_('BUNDLE_MASTERS')
    .filter((b) => (!f.type || b.BundleType === f.type) && (f.status === 'all' || !f.status ? b.Status !== STATUS.ARCHIVED || f.status === 'all' : b.Status === f.status))
    .map((b) => bundleView_(b, ctx));
  if (f.variantId) rows = rows.filter((b) => b.components.some((c) => c.variantId === f.variantId));
  if (f.productId) rows = rows.filter((b) => b.components.some((c) => c.productId === f.productId));
  if (q) rows = rows.filter((b) => [b.sku, b.name, b.barcode].concat(b.components.map((c) => c.sku + ' ' + c.name)).join(' ').toUpperCase().indexOf(q) >= 0);
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return paginate_(rows, f.page, Math.min(Number(f.pageSize) || 50, 200));
}

function bundleGet_(id) {
  const b = db_('BUNDLE_MASTERS').byId(id);
  if (!b) throw new AppError('Bundle tidak ditemukan', [], 'NOT_FOUND');
  return bundleView_(b);
}

function bundleSave_(user, input, opts) {
  opts = opts || {};
  const T = db_('BUNDLE_MASTERS');
  const errs = [];
  const err = (path, message, code) => errs.push({ path, message, code: code || 'INVALID' });
  const existing = input.id ? T.byId(input.id) : null;
  if (input.id && !existing) throw new AppError('Bundle tidak ditemukan', [], 'NOT_FOUND');
  if (existing && input.version !== undefined && input.version !== null && Number(input.version) !== existing.Version) throw new AppError('Bundle baru saja diubah pengguna lain. Muat ulang.', [], 'STALE_VERSION');
  if (existing && existing.Status === STATUS.ARCHIVED) throw new AppError('Bundle yang diarsipkan tidak dapat diubah');
  const type = existing ? existing.BundleType : input.type;
  if (!BUNDLE_TYPES[type]) err('type', 'Pilih jenis: Multipack, Mixed bundle, atau Request mix');
  if (existing && input.type && input.type !== existing.BundleType) err('type', 'Jenis bundle tidak dapat diubah setelah tersimpan (SKU permanen)');
  const name = cleanText(input.name);
  if (name.length < 3 || name.length > 120) err('name', 'Nama bundle 3–120 karakter');
  const stockMode = input.stockMode === 'PREASSEMBLED' ? 'PREASSEMBLED' : 'VIRTUAL';
  if (type === 'REQUEST_MIX' && stockMode === 'PREASSEMBLED') err('stockMode', 'Request mix selalu virtual — isinya baru ditentukan saat pesanan');
  const comps = (input.components || []).map((c, i) => ({ i, variantId: c.variantId, quantity: Number(c.quantity), selectable: type === 'REQUEST_MIX' ? true : false }));
  const seen = {};
  comps.forEach((c) => {
    const path = 'components.' + c.i;
    if (seen[c.variantId]) err(path, 'Komponen ganda — gabungkan jumlahnya');
    seen[c.variantId] = 1;
    if (!(Number.isInteger(c.quantity) && c.quantity >= 1 && c.quantity <= 1000)) err(path + '.quantity', 'Jumlah bilangan bulat 1–1.000');
    const v = db_('PRODUCT_VARIANTS').byId(c.variantId);
    const keepOld = existing && db_('BUNDLE_COMPONENTS').find((x) => x.BundleID === existing.BundleID && x.VariantID === c.variantId && x.Status === STATUS.ACTIVE);
    if (!keepOld) {
      try {
        assertUsableVariant_(v, path);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        err(path, e.message);
      }
    } else if (!v) err(path, 'Komponen tidak ditemukan');
  });
  if (type === 'MULTIPACK' && (comps.length !== 1 || !(comps[0] && comps[0].quantity >= 2))) err('components', 'Multipack = tepat 1 Child SKU dengan jumlah minimal 2');
  if (type === 'MIXED' && comps.length < 2) err('components', 'Mixed bundle minimal 2 Child SKU berbeda');
  let pick = null;
  if (type === 'REQUEST_MIX') {
    pick = Number(input.pickQuantity);
    if (comps.length < 2) err('components', 'Request mix minimal 2 pilihan Child SKU');
    if (!(Number.isInteger(pick) && pick >= 2 && pick <= 1000)) err('pickQuantity', 'Jumlah isi paket (dipilih customer) bilangan bulat ≥ 2');
  }
  // duplikasi definisi
  const key = masterNameKey(name);
  if (name && T.find((b) => b.NameKey === key && b.BundleID !== (existing && existing.BundleID) && b.Status !== STATUS.ARCHIVED)) err('name', 'Nama bundle sudah dipakai', 'DUPLICATE');
  if (type === 'MULTIPACK' && comps.length === 1) {
    const same = T.filter((b) => b.BundleType === 'MULTIPACK' && b.BundleID !== (existing && existing.BundleID) && b.Status !== STATUS.ARCHIVED).find((b) => {
      const bc = db_('BUNDLE_COMPONENTS').filter((x) => x.BundleID === b.BundleID && x.Status === STATUS.ACTIVE);
      return bc.length === 1 && bc[0].VariantID === comps[0].variantId && bc[0].Quantity === comps[0].quantity;
    });
    if (same) err('components', `Multipack yang sama sudah ada: ${same.BundleSKU} ${same.BundleName}`, 'DUPLICATE');
  }
  if (errs.length) throw new AppError('Periksa kembali bundle (' + errs.length + ' masalah)', errs, 'VALIDATION_FAILED');

  const ts = now_();
  let b;
  const fields = { BundleName: name, NameKey: key, StockMode: stockMode, Stockable: stockMode === 'PREASSEMBLED' ? 'STOCKABLE' : 'NON_STOCKABLE', PickQuantity: pick, Description: cleanText(input.description).slice(0, 500), UpdatedBy: user.email, UpdatedAt: ts };
  const before = existing ? bundleView_(existing) : null;
  if (existing) {
    b = existing;
    T.update(b, Object.assign(fields, { Version: (b.Version || 1) + 1 }));
  } else {
    const prefix = type === 'MULTIPACK' ? MULTIPACK_PREFIX : BUNDLE_PREFIX;
    const used = {};
    T.rows().forEach((x) => (used[x.BundleSKU] = 1));
    let sku;
    do sku = padCode_(prefix, nextSeq_(type === 'MULTIPACK' ? 'multipack_no' : 'bundle_no'));
    while (used[sku]);
    const status = input.saveAsDraft ? STATUS.DRAFT : STATUS.ACTIVE;
    b = T.insert(Object.assign({ BundleID: uuid_(), BundleSKU: sku, BundleType: type, Status: status, CreatedBy: user.email, CreatedAt: ts, Version: 1 }, fields));
    recordLifecycle_(user, 'bundle', b.BundleID, '', '', status, 'Registrasi bundle');
  }
  // BOM: komponen lama yang tidak dikirim → nonaktif (histori tetap ada); yang ada diperbarui; baru ditambahkan
  const C = db_('BUNDLE_COMPONENTS');
  const old = C.filter((c) => c.BundleID === b.BundleID && c.Status === STATUS.ACTIVE);
  old.forEach((c) => !seen[c.VariantID] && C.update(c, { Status: STATUS.INACTIVE }));
  comps.forEach((c, i) => {
    const ex = old.find((o) => o.VariantID === c.variantId);
    if (ex) {
      if (ex.Quantity !== c.quantity || ex.SortOrder !== i + 1) C.update(ex, { Quantity: c.quantity, SortOrder: i + 1, Selectable: c.selectable });
    } else C.insert({ ComponentID: uuid_(), BundleID: b.BundleID, VariantID: c.variantId, Quantity: c.quantity, Selectable: c.selectable, Status: STATUS.ACTIVE, SortOrder: i + 1, CreatedAt: ts });
  });
  // barcode bundle (opsional): GTIN produsen untuk paket, atau barcode internal
  const bcErrs = [];
  const curRow = db_('VARIANT_BARCODES').find((x) => x.BundleID === b.BundleID && x.Status === 'ACTIVE');
  const rec = { GTIN: curRow && curRow.BarcodeType === 'GTIN' ? curRow.Code : '', InternalBarcode: curRow && curRow.BarcodeType === 'INTERNAL' ? curRow.Code : '' };
  applyBarcode_(user, input.barcode, { bundleId: b.BundleID }, rec, input.barcodeChangeReason, 'barcode', 'Bundle ' + name, bcErrs);
  if (bcErrs.length) throw new AppError('Periksa kembali barcode bundle', bcErrs, 'VALIDATION_FAILED');
  const after = bundleView_(b);
  if (opts.dryRun) return after;
  audit_(user.email, existing ? 'bundle.update' : 'bundle.create', 'bundle', b.BundleID, before, after);
  return after;
}

function bundleSetStatus_(user, input) {
  const b = db_('BUNDLE_MASTERS').byId(input.id);
  if (!b) throw new AppError('Bundle tidak ditemukan', [], 'NOT_FOUND');
  if (!LIFECYCLE[input.status]) throw new AppError('Status tidak dikenal');
  if (!lifecycleCheck_(b.Status, input.status, input.reason, 'Bundle ' + b.BundleSKU)) return bundleView_(b);
  if (input.status === STATUS.ACTIVE) {
    const bad = bundleView_(b).components.filter((c) => c.skuStatus !== STATUS.ACTIVE);
    if (bad.length) throw new AppError('Komponen tidak aktif: ' + bad.map((c) => c.sku).join(', ') + '. Ganti komponennya dulu.');
  }
  const from = b.Status;
  db_('BUNDLE_MASTERS').update(b, { Status: input.status, UpdatedBy: user.email, UpdatedAt: now_(), Version: (b.Version || 1) + 1 });
  recordLifecycle_(user, 'bundle', b.BundleID, '', from, input.status, input.reason);
  audit_(user.email, 'bundle.status', 'bundle', b.BundleID, { status: from }, { status: input.status }, { reason: cleanText(input.reason) });
  return bundleView_(b);
}

/**
 * Komposisi aktual untuk pemenuhan pesanan (dipakai sistem fulfillment/inventory — TIDAK mengurangi stok di sini).
 * MULTIPACK/MIXED → BOM default. REQUEST_MIX → selections [{variantId|sku, quantity}] wajib, total = PickQuantity,
 * hanya dari daftar pilihan & Child SKU aktif.
 */
function bundleResolve_(input) {
  const b = db_('BUNDLE_MASTERS').byId(input.id) || db_('BUNDLE_MASTERS').find((x) => x.BundleSKU === String(input.sku || '').toUpperCase());
  if (!b) throw new AppError('Bundle tidak ditemukan', [], 'NOT_FOUND');
  const view = bundleView_(b);
  if (view.status !== STATUS.ACTIVE) throw new AppError(`Bundle ${view.sku} berstatus ${STATUS_LABEL[view.status]}`);
  const lines = [];
  if (view.type !== 'REQUEST_MIX') view.components.forEach((c) => lines.push({ variantId: c.variantId, sku: c.sku, name: c.name, quantity: c.quantity }));
  else {
    const pool = indexBy_(view.components, 'variantId');
    const bySku = indexBy_(view.components, 'sku');
    const errs = [];
    let total = 0;
    (input.selections || []).forEach((s, i) => {
      const c = pool[s.variantId] || bySku[String(s.sku || '').toUpperCase()];
      const q = Number(s.quantity);
      if (!c) return errs.push({ path: 'selections.' + i, message: `${s.sku || s.variantId} bukan pilihan bundle ini` });
      if (c.skuStatus !== STATUS.ACTIVE) return errs.push({ path: 'selections.' + i, message: `${c.sku} tidak aktif` });
      if (!(Number.isInteger(q) && q >= 1)) return errs.push({ path: 'selections.' + i, message: 'Jumlah tidak valid' });
      if (q > c.quantity) return errs.push({ path: 'selections.' + i, message: `${c.sku} maksimal ${c.quantity} per paket` });
      const ex = lines.find((l) => l.variantId === c.variantId);
      if (ex) ex.quantity += q;
      else lines.push({ variantId: c.variantId, sku: c.sku, name: c.name, quantity: q });
      total += q;
    });
    if (total !== view.pickQuantity) errs.push({ path: 'selections', message: `Total isi harus ${view.pickQuantity}, terpilih ${total}` });
    if (errs.length) throw new AppError('Komposisi request mix tidak valid', errs, 'VALIDATION_FAILED');
  }
  return { bundleSku: view.sku, bundleName: view.name, type: view.type, stockMode: view.stockMode, stockable: view.stockable, components: lines, note: view.stockable ? 'Bundle dirakit: stok dicatat pada SKU bundle; komponen dikurangi saat perakitan di sistem inventory.' : 'Bundle virtual: tidak punya stok sendiri — kurangi stok komponen sesuai komposisi ini.' };
}

/**
 * Cari / buat MULTIPACK virtual untuk (Child SKU × qty) — dipakai migrasi & import data lama.
 * Mengembalikan BundleID. Paket yang sama tidak pernah dibuat dua kali.
 */
function ensureMultipack_(user, variantId, qty, ts) {
  const ex = db_('BUNDLE_MASTERS')
    .filter((b) => b.BundleType === 'MULTIPACK' && b.Status !== STATUS.ARCHIVED)
    .find((b) => {
      const c = db_('BUNDLE_COMPONENTS').filter((x) => x.BundleID === b.BundleID && x.Status === STATUS.ACTIVE);
      return c.length === 1 && c[0].VariantID === variantId && c[0].Quantity === qty;
    });
  if (ex) return ex.BundleID;
  const v = db_('PRODUCT_VARIANTS').byId(variantId);
  const p = db_('MASTER_PRODUCTS').byId(v.ProductID);
  const used = {};
  db_('BUNDLE_MASTERS').rows().forEach((x) => (used[x.BundleSKU] = 1));
  let sku;
  do sku = padCode_(MULTIPACK_PREFIX, nextSeq_('multipack_no'));
  while (used[sku]);
  let name = cleanText(p.ProductName + (v.IsDefault ? '' : ' ' + v.VariantName) + ' - Paket ' + qty + ' ' + p.BaseUnit).slice(0, 120);
  if (db_('BUNDLE_MASTERS').find((x) => x.NameKey === masterNameKey(name))) name = (name.slice(0, 110) + ' ' + sku).trim();
  const b = db_('BUNDLE_MASTERS').insert({ BundleID: uuid_(), BundleSKU: sku, BundleType: 'MULTIPACK', BundleName: name, NameKey: masterNameKey(name), StockMode: 'VIRTUAL', Stockable: 'NON_STOCKABLE', PickQuantity: null, Status: STATUS.ACTIVE, Description: 'Paket jual dari data lama', CreatedBy: user.email || user, CreatedAt: ts, UpdatedBy: user.email || user, UpdatedAt: ts, Version: 1 });
  db_('BUNDLE_COMPONENTS').insert({ ComponentID: uuid_(), BundleID: b.BundleID, VariantID: variantId, Quantity: qty, Selectable: false, Status: STATUS.ACTIVE, SortOrder: 1, CreatedAt: ts });
  return b.BundleID;
}
