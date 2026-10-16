/**
 * Deteksi duplikasi.
 *  - EXACT (blokir): kode produk per brand, barcode, SKU.
 *  - FUZZY (peringatan): nama identik setelah normalisasi / mirip. Tidak pernah digabung otomatis.
 */

function productSummary_(id) {
  const p = db_('Products').byId(id);
  if (!p) return null;
  const b = db_('Brands').byId(p.brand_id) || {};
  const c = db_('Categories').byId(p.category_id) || {};
  return {
    id: p.id,
    productNo: productNoLabel(p.product_no),
    name: p.name,
    brandName: b.name,
    categoryName: c.name,
    status: p.status,
    productCode: p.product_code,
    skuCodes: db_('SKUs').filter((s) => s.product_id === id && s.sku_code && s.status !== 'archived').map((s) => s.sku_code),
    barcodes: db_('BarcodeAssignments').filter((a) => a.product_id === id && !a.unassigned_at && a.variant_id).map((a) => a.code),
  };
}

function dismissedFor_(id) {
  const out = {};
  db_('Dismissals').rows().forEach((d) => {
    if (d.entity_a === id) out[d.entity_b] = 1;
    if (d.entity_b === id) out[d.entity_a] = 1;
  });
  return out;
}

function checkDuplicates_(input) {
  const out = [];
  const self = input.productId || null;
  const threshold = Number(getSettings_().fuzzy_threshold) || 0.82;
  const code = normalizeCode(input.productCode);
  if (input.brandId && code) {
    db_('Products')
      .filter((p) => p.brand_id === input.brandId && p.product_code === code && p.status !== 'archived' && p.id !== self)
      .forEach((p) =>
        out.push({ kind: 'product_code', severity: 'block', message: `Kode produk ${code} sudah dipakai produk lain pada brand yang sama`, existing: productSummary_(p.id), recommendation: 'Gunakan kode lain, atau buka produk yang sudah ada bila barangnya sama.' }),
      );
  }
  (input.barcodes || []).forEach((raw) => {
    const c = cleanBarcode(raw);
    if (!c || !validateGtin(c).ok) return;
    const a = activeAssignment_(c);
    if (a && a.product_id !== self)
      out.push({ kind: 'barcode', severity: 'block', message: `Barcode ${c} sudah dipakai oleh ${(ownerInfo_(a) || {}).label}`, existing: productSummary_(a.product_id), recommendation: 'Satu barcode = satu barang fisik. Bila barang sama, tambahkan kemasan/paket pada produk yang sudah ada — jangan buat master baru.' });
  });
  (input.skuCodes || []).forEach((sku) => {
    if (!sku) return;
    const s = db_('SKUs').find((x) => x.sku_code && x.sku_code.toUpperCase() === String(sku).toUpperCase() && x.product_id !== self);
    if (s) out.push({ kind: 'sku', severity: 'block', message: `SKU ${sku} sudah dipakai`, existing: productSummary_(s.product_id), recommendation: 'SKU tidak boleh dipakai ulang, termasuk SKU yang sudah diarsipkan.' });
  });
  if (input.name && cleanText(input.name).length >= 3) {
    const norm = normalizeName(input.name);
    const tk = tokenKey(input.name);
    const dismissed = self ? dismissedFor_(self) : {};
    db_('Products')
      .filter((p) => p.status !== 'archived' && p.id !== self && !dismissed[p.id] && (!input.brandId || p.brand_id === input.brandId))
      .map((p) => {
        const exact = p.name_norm === norm || p.token_key === tk;
        return { p, exact, score: exact ? 1 : nameSimilarity(input.name, p.name) };
      })
      .filter((x) => x.exact || x.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .forEach((x) =>
        out.push({
          kind: x.exact ? 'same_name' : 'similar_name',
          severity: 'warn',
          score: x.score,
          message: x.exact ? `Nama identik setelah normalisasi dengan "${x.p.name}"` : `Nama mirip (${Math.round(x.score * 100)}%) dengan "${x.p.name}"`,
          existing: productSummary_(x.p.id),
          recommendation: x.exact
            ? 'Kemungkinan besar produk yang sama didaftarkan ulang. Periksa barcode & ukuran; bila sama, batalkan dan tambahkan varian/kemasan pada produk lama.'
            : 'Periksa apakah produk berbeda (ukuran/varian) atau ejaan lain dari produk yang sama.',
        }),
      );
  }
  return out;
}

function checkSavedProduct_(id) {
  const p = db_('Products').byId(id);
  return checkDuplicates_({
    productId: id,
    brandId: p.brand_id,
    name: p.name,
    productCode: p.product_code,
    barcodes: db_('BarcodeAssignments').filter((a) => a.product_id === id && !a.unassigned_at).map((a) => a.code),
    skuCodes: db_('SKUs').filter((s) => s.product_id === id && s.sku_code).map((s) => s.sku_code),
  });
}

/** Pasangan nama mirip di seluruh master (per brand). */
function similarPairs_(limit) {
  const threshold = Number(getSettings_().fuzzy_threshold) || 0.82;
  const dismissed = {};
  db_('Dismissals').rows().forEach((d) => (dismissed[d.entity_a + '|' + d.entity_b] = dismissed[d.entity_b + '|' + d.entity_a] = 1));
  const brands = {};
  db_('Brands').rows().forEach((b) => (brands[b.id] = b.name));
  const byBrand = {};
  db_('Products')
    .filter((p) => p.status !== 'archived')
    .forEach((p) => (byBrand[p.brand_id] = (byBrand[p.brand_id] || []).concat([p])));
  const pairs = [];
  Object.keys(byBrand).forEach((bid) => {
    const list = byBrand[bid];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (dismissed[a.id + '|' + b.id]) continue;
        const exact = a.token_key === b.token_key;
        const score = exact ? 1 : nameSimilarity(a.name, b.name);
        if (exact || score >= threshold)
          pairs.push({ score, exact, brandName: brands[bid], a: { id: a.id, productNo: productNoLabel(a.product_no), name: a.name, status: a.status }, b: { id: b.id, productNo: productNoLabel(b.product_no), name: b.name, status: b.status } });
      }
  });
  return pairs.sort((x, y) => y.score - x.score).slice(0, limit || 300);
}

function dismissPair_(user, a, b, reason) {
  if (!reason || cleanText(reason).length < 5) throw new AppError('Alasan minimal 5 karakter');
  const exists = db_('Dismissals').find((d) => (d.entity_a === a && d.entity_b === b) || (d.entity_a === b && d.entity_b === a));
  if (!exists) db_('Dismissals').insert({ id: uuid_(), entity_a: a, entity_b: b, reason, dismissed_by: user.email, created_at: now_() });
  audit_(user.email, 'duplicate.dismiss', 'product', a, null, { a, b, reason });
  return true;
}
