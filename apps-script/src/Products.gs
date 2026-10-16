/**
 * Product master, varian, SKU, harga & registrasi draft.
 * Hierarki: Brand → Kategori → Product (keluarga) → Variant (fisik) → SKU (satuan / multipack / bundle).
 */

function productCtx_(id) {
  const p = db_('Products').byId(id);
  if (!p) throw new AppError('Produk tidak ditemukan', [], 'NOT_FOUND');
  const b = db_('Brands').byId(p.brand_id) || {};
  const c = db_('Categories').byId(p.category_id) || {};
  return Object.assign(p, { brand_code: b.code, brand_name: b.name, brand_status: b.status, category_code: c.code, category_name: c.name, category_status: c.status });
}

function skuView_(s) {
  const pack = primaryBarcode_({ skuId: s.id });
  const comps = db_('Components')
    .filter((c) => c.bundle_sku_id === s.id)
    .map((c) => {
      const cs = db_('SKUs').byId(c.component_sku_id) || {};
      return { skuId: c.component_sku_id, quantity: c.quantity, skuCode: cs.sku_code, name: cs.display_name, purchasePrice: cs.purchase_price };
    });
  const maps = db_('Mappings')
    .filter((m) => m.sku_id === s.id && m.is_active)
    .map((m) => ({ id: m.id, system: m.system, externalSku: m.external_sku, externalProductId: m.external_product_id, status: m.mapping_status }));
  return Object.assign({}, s, { pack_barcode: pack ? pack.code : null, components: comps, mappings: maps });
}

function productDetail_(id) {
  const p = productCtx_(id);
  const variants = db_('Variants')
    .filter((v) => v.product_id === id && v.status !== 'archived')
    .sort((a, b) => a.sort_order - b.sort_order || a.variant_no - b.variant_no)
    .map((v) => {
      const a = primaryBarcode_({ variantId: v.id });
      const bc = a ? findBarcode_(a.code) : null;
      return Object.assign({}, v, {
        attributes: v.attributes_json || [],
        barcode: bc ? { code: bc.code, type: bc.barcode_type, symbology: bc.symbology, verifiedOfficial: bc.verified_official } : null,
        skus: db_('SKUs')
          .filter((s) => s.variant_id === v.id && s.status !== 'archived')
          .sort((x, y) => x.pack_qty - y.pack_qty)
          .map(skuView_),
      });
    });
  const requests = db_('Requests')
    .filter((r) => r.product_id === id)
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
  const history = db_('ApprovalHistory')
    .filter((h) => h.entity_type === 'product' && h.entity_id === id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return Object.assign({}, p, { productNo: productNoLabel(p.product_no), variants, requests, history });
}

function listProducts_(f) {
  const brands = {};
  db_('Brands').rows().forEach((b) => (brands[b.id] = b));
  const cats = {};
  db_('Categories').rows().forEach((c) => (cats[c.id] = c));
  const variantsBy = {};
  db_('Variants').rows().forEach((v) => v.status !== 'archived' && (variantsBy[v.product_id] = (variantsBy[v.product_id] || 0) + 1));
  const skusBy = {};
  const skuText = {};
  db_('SKUs').rows().forEach((s) => {
    if (s.status === 'archived') return;
    skusBy[s.product_id] = (skusBy[s.product_id] || 0) + 1;
    skuText[s.product_id] = (skuText[s.product_id] || '') + ' ' + (s.sku_code || '');
  });
  const bcBy = {};
  const internalBy = {};
  const bcType = {};
  db_('Barcodes').rows().forEach((b) => (bcType[b.code] = b.barcode_type));
  db_('BarcodeAssignments')
    .filter((a) => !a.unassigned_at && a.variant_id)
    .forEach((a) => {
      bcBy[a.product_id] = (bcBy[a.product_id] ? bcBy[a.product_id] + ', ' : '') + a.code;
      if (bcType[a.code] === 'internal') internalBy[a.product_id] = true;
    });
  const q = String(f.search || '').trim();
  const qn = normalizeName(q);
  const qu = q.toUpperCase();
  let rows = db_('Products')
    .rows()
    .filter((p) => (f.status === 'all' ? true : f.status ? p.status === f.status : p.status !== 'archived'))
    .filter((p) => (!f.brandId || p.brand_id === f.brandId) && (!f.categoryId || p.category_id === f.categoryId))
    .filter((p) => {
      if (f.barcode === 'none') return (variantsBy[p.id] || 0) > (bcBy[p.id] ? bcBy[p.id].split(', ').length : 0);
      if (f.barcode === 'internal_only') return !!internalBy[p.id];
      return true;
    })
    .filter((p) => {
      if (!q) return true;
      return (
        p.name_norm.indexOf(qn) >= 0 ||
        p.product_code.indexOf(qu) >= 0 ||
        (skuText[p.id] || '').toUpperCase().indexOf(qu) >= 0 ||
        (bcBy[p.id] || '').indexOf(q) >= 0 ||
        productNoLabel(p.product_no) === qu
      );
    })
    .map((p) => ({
      id: p.id,
      product_no: p.product_no,
      productNo: productNoLabel(p.product_no),
      product_code: p.product_code,
      name: p.name,
      status: p.status,
      product_type: p.product_type,
      is_legacy: p.is_legacy,
      updated_at: p.updated_at,
      brand_name: (brands[p.brand_id] || {}).name,
      category_name: (cats[p.category_id] || {}).name,
      variant_count: variantsBy[p.id] || 0,
      sku_count: skusBy[p.id] || 0,
      barcodes: bcBy[p.id] || '',
      has_internal_barcode: !!internalBy[p.id],
    }));
  const key = { name: 'name', brand: 'brand_name', category: 'category_name', status: 'status', product_no: 'product_no', sku_count: 'sku_count' }[f.sort] || 'updated_at';
  const dir = f.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
  return paginate_(rows, f.page, 25);
}

// --------------------------------------------------------------------------- SKU & harga

function generateSkuCode_(p, variantCode, barcode, qty) {
  return buildSku(getSettings_().sku_template, { brand: p.brand_code, category: p.category_code, product: p.product_code, variant: variantCode, barcode: barcode || '', qty });
}

function assertSkuFree_(code, path, exceptSkuId) {
  const ex = db_('SKUs').find((s) => s.sku_code && s.sku_code.toUpperCase() === code.toUpperCase() && s.id !== exceptSkuId);
  if (ex) {
    const p = db_('Products').byId(ex.product_id) || {};
    throw new AppError(`SKU ${code} sudah dipakai`, [{ path, message: `SKU ${code} sudah dipakai oleh ${p.name} (${ex.status})`, code: 'SKU_IN_USE' }], 'SKU_IN_USE');
  }
}

function setPrice_(user, skuId, type, amount, reason) {
  const s = db_('SKUs').byId(skuId);
  if (!s) throw new AppError('SKU tidak ditemukan');
  const amt = Number(amount);
  if (!(amt >= 0)) throw new AppError('Nominal harga tidak valid');
  const col = type === 'purchase' ? 'purchase_price' : 'selling_price';
  if (s[col] !== null && Number(s[col]) === amt) return false;
  const cur = db_('Prices').find((x) => x.sku_id === skuId && x.price_type === type && !x.effective_to);
  if (cur) db_('Prices').update(cur, { effective_to: now_() });
  db_('Prices').insert({ id: uuid_(), sku_id: skuId, price_type: type, amount: amt, effective_from: now_(), reason: reason || '', created_by: user.email });
  db_('SKUs').update(s, { [col]: amt, updated_at: now_() });
  return true;
}

function insertSku_(user, p, variant, variantBarcode, sku, opts) {
  const path = opts.path;
  const qty = Number(sku.packQty);
  if (SALES_UNITS.indexOf(sku.salesUnit) < 0) throw new AppError('Satuan tidak valid', [{ path, message: 'Satuan' }]);
  if (p.product_type === 'bundle' && sku.skuType !== 'bundle') throw new AppError('Produk bundle hanya boleh SKU bertipe bundle', [{ path, message: 'Tipe SKU' }]);
  if (p.product_type === 'standard' && sku.skuType === 'bundle') throw new AppError('SKU bundle harus didaftarkan sebagai produk bertipe Bundle', [{ path, message: 'Tipe produk' }]);
  if (sku.skuType === 'single' && qty !== 1) throw new AppError('SKU satuan harus berisi 1', [{ path, message: 'Isi harus 1' }]);
  if (sku.skuType === 'multipack' && !(qty >= 2)) throw new AppError('Multipack minimal isi 2', [{ path, message: 'Isi minimal 2' }]);
  if (sku.skuType === 'bundle' && !(sku.components || []).length) throw new AppError('Bundle wajib memiliki daftar komponen (BOM)', [{ path, message: 'Tambahkan komponen' }]);
  if (!(qty >= 1 && qty <= 1000 && Number.isInteger(qty))) throw new AppError('Isi kemasan tidak valid', [{ path, message: 'Isi' }]);

  const packRec = resolveBarcodeInput_(user, sku.packBarcode, { path: path + '.packBarcode', ownerProductId: p.id });
  let code = sku.skuCodeOverride ? String(sku.skuCodeOverride).trim().toUpperCase() : null;
  const source = code ? 'manual' : opts.source || 'generated';
  if (!code) {
    const gen = generateSkuCode_(p, variant.variant_code, packRec ? packRec.code : variantBarcode, qty);
    if (gen.ok) code = gen.sku;
    else if (opts.strict) throw new AppError('SKU tidak dapat dibuat', [{ path, message: gen.missing.map((m) => 'data ' + m + ' belum ada').concat(gen.errors).join('; ') }]);
  } else if (!/^[A-Z0-9][A-Z0-9\-_.\/]*$/.test(code)) throw new AppError('Format SKU override tidak valid', [{ path, message: 'Huruf besar, angka, - _ . /' }]);
  if (code) assertSkuFree_(code, path);
  const base = cleanText([opts.productName, variant.name].filter(Boolean).join(' - '));
  const rec = db_('SKUs').insert({
    id: uuid_(),
    sku_no: nextSeq_('sku_no'),
    sku_code: code || '',
    product_id: p.id,
    variant_id: variant.id,
    sku_type: sku.skuType,
    pack_qty: qty,
    sales_unit: sku.salesUnit,
    display_name: opts.displayName || packDisplayName(base, qty, sku.skuType === 'bundle' ? 'SET' : 'PCS'),
    status: opts.status,
    sku_source: source,
    created_by: user.email,
    created_at: now_(),
    updated_at: now_(),
  });
  if (packRec) assignBarcode_(user, packRec, { productId: p.id, skuId: rec.id });
  if (sku.purchasePrice !== null && sku.purchasePrice !== undefined && sku.purchasePrice !== '') setPrice_(user, rec.id, 'purchase', sku.purchasePrice, opts.priceReason || 'harga awal');
  if (sku.sellingPrice !== null && sku.sellingPrice !== undefined && sku.sellingPrice !== '') setPrice_(user, rec.id, 'selling', sku.sellingPrice, opts.priceReason || 'harga awal');
  if (sku.skuType === 'bundle') {
    const seen = {};
    (sku.components || []).forEach((c, i) => {
      const cp = path + '.components.' + i;
      if (seen[c.skuId]) throw new AppError('Komponen ganda', [{ path: cp, message: 'Komponen sudah ada' }]);
      seen[c.skuId] = 1;
      const cs = db_('SKUs').byId(c.skuId);
      if (!cs) throw new AppError('Komponen tidak ditemukan', [{ path: cp, message: 'SKU komponen tidak ada' }]);
      if (cs.sku_type === 'bundle') throw new AppError('Bundle tidak boleh berisi bundle lain', [{ path: cp, message: cs.sku_code }]);
      if (cs.status !== 'active') throw new AppError('Komponen harus SKU aktif', [{ path: cp, message: `${cs.sku_code} berstatus ${cs.status}` }]);
      const qn = Number(c.quantity);
      if (!(qn >= 1 && Number.isInteger(qn))) throw new AppError('Jumlah komponen tidak valid', [{ path: cp, message: 'Jumlah' }]);
      db_('Components').insert({ id: uuid_(), bundle_sku_id: rec.id, component_sku_id: c.skuId, quantity: qn });
    });
  }
  return rec;
}

function insertVariantTree_(user, p, v, opts) {
  const path = 'variants.' + opts.index;
  const attrs = (v.attributes || []).filter((a) => cleanText(a.value));
  attrs.forEach((a) => {
    if (!ATTRIBUTE_TYPES[a.type]) throw new AppError('Jenis atribut tidak dikenal', [{ path: path + '.attributes', message: a.type }]);
  });
  const types = attrs.map((a) => a.type);
  if (new Set(types).size !== types.length) throw new AppError('Jenis atribut ganda dalam satu varian', [{ path: path + '.attributes', message: 'Atribut ganda' }]);
  const sig = attributeSignature(attrs);
  const vcode = normalizeCode(v.variantCode || '');
  if (vcode.length > 12) throw new AppError('Kode varian maks. 12 karakter', [{ path: path + '.variantCode', message: 'Terlalu panjang' }]);
  const siblings = db_('Variants').filter((x) => x.product_id === p.id && x.status !== 'archived');
  if (siblings.some((x) => x.signature === sig)) throw new AppError('Kombinasi atribut varian sudah ada pada produk ini', [{ path: path + '.attributes', message: 'Kombinasi atribut sama dengan varian lain' }]);
  if (siblings.some((x) => x.variant_code === vcode)) throw new AppError('Kode varian sudah dipakai', [{ path: path + '.variantCode', message: `Kode ${vcode || '(kosong)'} ganda` }]);
  const name = cleanText(v.name) || attrs.map((a) => cleanText(a.value)).join(' / ');
  const variant = db_('Variants').insert({
    id: uuid_(),
    variant_no: nextSeq_('variant_no'),
    product_id: p.id,
    variant_code: vcode,
    name,
    attributes_json: attrs.map((a) => ({ type: a.type, value: cleanText(a.value) })),
    signature: sig,
    is_default: !!opts.isDefault,
    status: 'active',
    sort_order: opts.index,
    created_by: user.email,
    created_at: now_(),
  });
  const bc = resolveBarcodeInput_(user, v.barcode, { path: path + '.barcode', ownerProductId: p.id, notes: 'Registrasi: ' + p.name });
  if (bc) assignBarcode_(user, bc, { productId: p.id, variantId: variant.id });
  const skus = v.skus || [];
  if (!skus.length) throw new AppError('Minimal satu SKU per varian', [{ path: path + '.skus', message: 'Tambahkan kemasan' }]);
  const qtys = skus.filter((s) => s.skuType !== 'bundle').map((s) => Number(s.packQty));
  const dup = qtys.find((x, i) => qtys.indexOf(x) !== i);
  if (dup) throw new AppError(`Isi kemasan ${dup} terdaftar lebih dari sekali`, [{ path: path + '.skus', message: `Isi ${dup} ganda` }]);
  skus.forEach((s, si) => {
    const existsQty = s.skuType !== 'bundle' && db_('SKUs').find((x) => x.variant_id === variant.id && x.pack_qty === Number(s.packQty) && x.status !== 'archived');
    if (existsQty) throw new AppError(`Varian sudah memiliki kemasan isi ${s.packQty}`, [{ path: `${path}.skus.${si}`, message: 'Isi ganda' }]);
    insertSku_(user, p, variant, bc ? bc.code : null, s, { status: opts.skuStatus, path: `${path}.skus.${si}`, strict: opts.strict, productName: opts.productName });
  });
  return variant;
}

// --------------------------------------------------------------------------- Draft registrasi

function validateRegistration_(input) {
  const d = [];
  const brand = db_('Brands').byId(input.brandId);
  const cat = db_('Categories').byId(input.categoryId);
  if (!brand || ['rejected', 'inactive'].indexOf(brand.status) >= 0) d.push({ path: 'brandId', message: 'Brand wajib dipilih (aktif/usulan)' });
  if (!cat || ['rejected', 'inactive'].indexOf(cat.status) >= 0) d.push({ path: 'categoryId', message: 'Kategori wajib dipilih (aktif/usulan)' });
  const code = normalizeCode(input.productCode);
  if (!/^[A-Z0-9]{2,16}$/.test(code)) d.push({ path: 'productCode', message: 'Kode produk 2–16 huruf/angka' });
  if (cleanText(input.name).length < 3) d.push({ path: 'name', message: 'Nama produk minimal 3 karakter' });
  if (['standard', 'bundle'].indexOf(input.productType || 'standard') < 0) d.push({ path: 'productType', message: 'Tipe tidak valid' });
  const variants = input.variants || [];
  if (!variants.length) d.push({ path: 'variants', message: 'Minimal satu varian' });
  if (!input.hasVariants && variants.length !== 1) d.push({ path: 'variants', message: 'Produk tanpa varian harus tepat satu varian default' });
  if (input.hasVariants) {
    const codes = [];
    const sigs = [];
    variants.forEach((v, i) => {
      const c = normalizeCode(v.variantCode);
      if (!c) d.push({ path: `variants.${i}.variantCode`, message: 'Kode varian wajib' });
      else if (codes.indexOf(c) >= 0) d.push({ path: `variants.${i}.variantCode`, message: `Kode ${c} ganda` });
      codes.push(c);
      const sig = attributeSignature(v.attributes || []);
      if (!sig) d.push({ path: `variants.${i}.attributes`, message: 'Isi minimal satu atribut' });
      else if (sigs.indexOf(sig) >= 0) d.push({ path: `variants.${i}.attributes`, message: 'Kombinasi atribut sama dengan varian lain' });
      sigs.push(sig);
    });
  }
  if (d.length) throw new AppError('Periksa kembali isian registrasi', d, 'VALIDATION_FAILED');
  return { brand, cat, code };
}

function saveDraft_(user, input, productId) {
  const { code } = validateRegistration_(input);
  const name = cleanText(input.name);
  const P = db_('Products');
  const clash = P.find((p) => p.brand_id === input.brandId && p.product_code === code && p.status !== 'archived' && p.id !== productId);
  if (clash) throw new AppError(`Kode produk ${code} sudah dipakai untuk brand ini (${clash.name})`, [{ path: 'productCode', message: 'Kode produk sudah dipakai' }], 'DUPLICATE');
  let before = null;
  let p;
  const fields = {
    brand_id: input.brandId,
    category_id: input.categoryId,
    product_code: code,
    name,
    name_norm: normalizeName(name),
    token_key: tokenKey(name),
    product_type: input.productType || 'standard',
    description: cleanText(input.description),
    base_unit: input.baseUnit || 'PCS',
    has_variants: !!input.hasVariants,
    updated_by: user.email,
    updated_at: now_(),
  };
  if (productId) {
    p = P.byId(productId);
    if (!p) throw new AppError('Produk tidak ditemukan');
    if (p.status !== 'draft') throw new AppError('Hanya produk berstatus Draft yang dapat diedit langsung. Gunakan Ajukan Perubahan untuk produk yang sudah disetujui.');
    if (input.version !== undefined && input.version !== null && Number(input.version) !== p.version)
      throw new AppError('Data sudah diubah oleh pengguna lain. Muat ulang halaman lalu ulangi.', [], 'STALE_VERSION');
    before = productDetail_(productId);
    // draft belum pernah dipakai di luar sistem → anak-anaknya dibangun ulang dari input
    releaseDraftAssignments_(productId);
    const skuIds = db_('SKUs').filter((s) => s.product_id === productId).map((s) => s.id);
    db_('Prices').deleteWhere((x) => skuIds.indexOf(x.sku_id) >= 0);
    db_('Components').deleteWhere((x) => skuIds.indexOf(x.bundle_sku_id) >= 0);
    db_('SKUs').deleteWhere((s) => s.product_id === productId);
    db_('Variants').deleteWhere((v) => v.product_id === productId);
    P.update(p, Object.assign(fields, { version: p.version + 1 }));
  } else {
    p = P.insert(Object.assign(fields, { id: uuid_(), product_no: nextSeq_('product_no'), status: 'draft', is_legacy: false, version: 1, created_by: user.email, created_at: now_() }));
  }
  const ctx = productCtx_(p.id);
  input.variants.forEach((v, i) => insertVariantTree_(user, ctx, v, { index: i, skuStatus: 'draft', strict: false, productName: name, isDefault: !input.hasVariants }));
  const after = productDetail_(p.id);
  audit_(user.email, productId ? 'product.update_draft' : 'product.create_draft', 'product', p.id, before, after);
  return after;
}

function completeness_(productId) {
  const d = productDetail_(productId);
  const issues = [];
  if (d.brand_status !== 'active') issues.push({ path: 'brandId', message: `Brand ${d.brand_name} belum aktif/disetujui` });
  if (d.category_status !== 'active') issues.push({ path: 'categoryId', message: `Kategori ${d.category_name} belum aktif/disetujui` });
  if (!d.variants.length) issues.push({ path: 'variants', message: 'Belum ada varian' });
  d.variants.forEach((v, i) => {
    const label = v.name || 'Varian ' + (i + 1);
    if (!v.barcode) issues.push({ path: `variants.${i}.barcode`, message: `${label}: barcode belum diisi (GTIN resmi atau internal)` });
    if (!v.skus.length) issues.push({ path: `variants.${i}.skus`, message: `${label}: belum ada SKU` });
    if (d.product_type === 'standard' && v.skus.length && !v.skus.some((s) => s.sku_type === 'single'))
      issues.push({ path: `variants.${i}.skus`, message: `${label}: multipack wajib memiliki SKU satuan (isi 1)` });
    v.skus.forEach((s, si) => {
      const sl = `${label} isi ${s.pack_qty}`;
      if (!s.sku_code) issues.push({ path: `variants.${i}.skus.${si}`, message: `${sl}: kode SKU belum terbentuk (lengkapi barcode)` });
      if (s.selling_price === null) issues.push({ path: `variants.${i}.skus.${si}.sellingPrice`, message: `${sl}: harga jual belum diisi` });
      if (s.purchase_price === null && s.sku_type !== 'bundle') issues.push({ path: `variants.${i}.skus.${si}.purchasePrice`, message: `${sl}: harga beli belum diisi` });
    });
  });
  return issues;
}

function skuList_(f) {
  const q = String(f.search || '').toUpperCase();
  const prods = {};
  db_('Products').rows().forEach((p) => (prods[p.id] = p));
  const brands = {};
  db_('Brands').rows().forEach((b) => (brands[b.id] = b.name));
  return db_('SKUs')
    .filter((s) => (f.status === 'all' ? s.status !== 'archived' : s.status === (f.status || 'active')))
    .filter((s) => !f.type || s.sku_type === f.type)
    .filter((s) => !q || (s.sku_code || '').toUpperCase().indexOf(q) >= 0 || String(s.display_name).toUpperCase().indexOf(q) >= 0)
    .slice(0, Number(f.limit) || 200)
    .map((s) => {
      const p = prods[s.product_id] || {};
      return Object.assign({}, s, { productNo: productNoLabel(p.product_no), brand_name: brands[p.brand_id] });
    });
}

function skuHistory_(skuId) {
  return {
    prices: db_('Prices')
      .filter((x) => x.sku_id === skuId)
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from))),
    codeHistory: db_('SkuCodeHistory').filter((x) => x.sku_id === skuId),
  };
}

function skuPreview_(p) {
  const brand = db_('Brands').byId(p.brandId);
  const cat = db_('Categories').byId(p.categoryId);
  if (!brand || !cat) return { template: getSettings_().sku_template, items: [] };
  const tpl = getSettings_().sku_template;
  const seen = {};
  const items = (p.items || []).map((it) => {
    const gen = it.override
      ? { ok: true, sku: String(it.override).toUpperCase(), missing: [], errors: [] }
      : buildSku(tpl, { brand: brand.code, category: cat.code, product: normalizeCode(p.productCode), variant: normalizeCode(it.variantCode), barcode: it.barcode || '', qty: it.qty });
    let conflict = null;
    if (gen.sku) {
      const ex = db_('SKUs').find((s) => s.sku_code && s.sku_code.toUpperCase() === gen.sku.toUpperCase() && s.product_id !== p.productId);
      if (ex) conflict = 'Sudah dipakai oleh ' + ((db_('Products').byId(ex.product_id) || {}).name || '-') + ' (' + ex.status + ')';
      else if (seen[gen.sku]) conflict = 'Ganda di formulir ini';
      seen[gen.sku] = 1;
    }
    return Object.assign({ key: it.key, conflict }, gen);
  });
  return { template: tpl, items };
}
