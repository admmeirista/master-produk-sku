/**
 * Data Quality — deteksi masalah master data. Exact matching untuk identifier unik, normalisasi + fuzzy untuk nama.
 * Hanya MENAMPILKAN temuan & rekomendasi; tidak pernah merge/ubah data otomatis.
 * Tindakan lanjut: edit produk, nonaktifkan, atau controlled deprecation (variant.deprecate).
 */

function dataQuality_() {
  const P = db_('MASTER_PRODUCTS').rows();
  const V = db_('PRODUCT_VARIANTS').rows();
  const pById = indexBy_(P, 'ProductID');
  const vById = indexBy_(V, 'VariantID');
  const brands = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const live = (s) => s !== STATUS.ARCHIVED && s !== STATUS.DELETED;
  const vLabel = (v) => {
    const p = pById[v.ProductID] || {};
    return { productId: p.ProductID, productCode: p.ProductCode, product: p.ProductName, variant: v.IsDefault ? '' : v.VariantName, sku: v.SKU, status: v.Status };
  };
  const dupBy = (rows, keyFn) => {
    const g = {};
    rows.forEach((r) => {
      const k = keyFn(r);
      if (k) (g[k] = g[k] || []).push(r);
    });
    return Object.keys(g)
      .filter((k) => g[k].length > 1)
      .map((k) => ({ key: k, items: g[k] }));
  };
  const sections = [];
  const add = (key, label, severity, rows, recommendation) => sections.push({ key, label, severity, count: rows.length, rows: rows.slice(0, 200), recommendation });

  // ---- identitas unik (exact)
  add('dup_parent_code', 'Parent SKU / kode produk ganda', 'error', dupBy(P, (p) => String(p.ProductCode || '').toUpperCase()).map((d) => ({ code: d.key, products: d.items.map((p) => p.ProductName).join(' | '), productId: d.items[0].ProductID })), 'Kode produk harus unik. Hubungi admin — perbaiki lewat migrasi terkontrol, jangan menimpa kode yang sudah dipakai.');
  const skuRows = V.filter((v) => v.SKU).map((v) => ({ sku: v.SKU, label: vLabel(v) })).concat(db_('UNIT_CONVERSIONS').filter((c) => c.SKU).map((c) => ({ sku: c.SKU, label: { productId: c.ProductID, product: (pById[c.ProductID] || {}).ProductName, variant: 'kemasan ' + c.UnitName } })));
  add('dup_child_sku', 'Child SKU ganda', 'error', dupBy(skuRows, (r) => r.sku.toUpperCase()).map((d) => ({ sku: d.key, productId: d.items[0].label.productId, products: d.items.map((x) => x.label.product + ' ' + (x.label.variant || '')).join(' | ') })), 'SKU tidak boleh dipakai dua kali. Nonaktifkan salah satu lewat controlled deprecation.');
  add('dup_gtin', 'GTIN / barcode aktif konflik', 'error', dupBy(db_('VARIANT_BARCODES').filter((b) => b.Status === 'ACTIVE'), (b) => b.Code).map((d) => ({ barcode: d.key, owners: d.items.map((b) => (ownerInfo_(b) || {}).label).join(' | ') })), 'Satu barcode = satu barang fisik. Periksa kemasan fisik, lalu ganti barcode yang salah (wajib alasan).');
  const combos = [];
  Object.values(groupBy_(V.filter((v) => live(v.Status)), 'ProductID')).forEach((list) => dupBy(list, (v) => v.AttributeKey || '(tanpa atribut)').forEach((d) => combos.push({ productId: d.items[0].ProductID, product: (pById[d.items[0].ProductID] || {}).ProductName, combination: d.key, skus: d.items.map((v) => v.SKU).join(', ') })));
  add('dup_variant_combo', 'Kombinasi varian ganda dalam satu produk', 'error', combos, 'Koreksi atribut salah satu varian, atau deprecate SKU duplikatnya.');
  ['brand', 'category'].forEach((kind) => {
    const k = MASTER_KIND[kind];
    add('dup_' + kind, k.label + ' ganda (nama sama setelah normalisasi)', 'error', dupBy(db_(k.table).filter((r) => r.Status !== STATUS.DELETED), (r) => r.NameKey).map((d) => ({ name: d.items.map((r) => r[k.name] + ' (' + r[k.code] + ')').join(' | ') })), 'Nonaktifkan duplikat yang tidak dipakai; kode yang sudah dipakai tetap dipertahankan.');
  });
  add('dup_supplier_map', 'Mapping supplier ganda', 'error', dupBy(db_('SUPPLIER_PRODUCT_MAPPING').filter((m) => m.Status === STATUS.ACTIVE), (m) => m.SupplierID + '|' + m.SupplierCodeKey).map((d) => ({ supplierCode: d.items[0].SupplierProductCode, skus: d.items.map((m) => (vById[m.VariantID] || {}).SKU).join(', ') })), 'Satu kode produk supplier hanya boleh menunjuk satu Child SKU. Nonaktifkan mapping yang salah.');
  const ch = db_('EXTERNAL_SKU_MAPPINGS').filter((m) => m.IsActive && m.System !== 'legacy');
  add('dup_channel_map', 'Mapping kanal ganda', 'error', dupBy(ch, (m) => (MARKETPLACES[m.System] ? m.System + '|' + String(m.StoreAccount || '').toUpperCase() + '|' + m.ExternalProductId + '|' + (m.ExternalVariationId || '') : m.System + '|' + String(m.StoreAccount || '').toUpperCase() + '|' + String(m.ExternalSku).toUpperCase())).map((d) => ({ channel: CHANNEL_LABEL[d.items[0].System], listing: d.key.split('|').slice(2).join(' / '), skus: d.items.map((m) => mappingTarget_(m).internalSku).join(', ') })), 'Satu listing/variasi hanya boleh menunjuk satu SKU internal. Nonaktifkan mapping yang salah.');

  // ---- konsistensi
  const convIssues = [];
  Object.values(groupBy_(db_('UNIT_CONVERSIONS').filter((c) => !c.IsBaseUnit && c.Status === STATUS.ACTIVE), 'VariantID')).forEach((list) => {
    const v = vById[list[0].VariantID];
    const p = v && pById[v.ProductID];
    if (!p) return;
    const sorted = list.slice().sort((a, b) => a.SortOrder - b.SortOrder);
    const calc = computeConversions(p.BaseUnit, sorted.map((c) => ({ unitName: c.UnitName, factor: c.ConversionFactor, containsUnit: c.ContainsUnit })));
    sorted.forEach((c, i) => {
      const e = calc.errors.find((x) => x.index === i);
      if (e || calc.rows[i].baseUnitEquivalent !== c.BaseUnitEquivalent) convIssues.push(Object.assign(vLabel(v), { unit: c.UnitName, stored: c.BaseUnitEquivalent, expected: calc.rows[i].baseUnitEquivalent, problem: e ? e.message : 'Ekuivalen tersimpan tidak sesuai perhitungan' }));
    });
  });
  add('conversion_inconsistent', 'Konversi satuan tidak konsisten', 'error', convIssues, 'Buka Edit produk → Kemasan, simpan ulang agar ekuivalen dihitung ulang (perubahan tercatat di histori kemasan).');
  const inactiveUse = [];
  const notActive = (v) => !v || v.Status !== STATUS.ACTIVE || (pById[v.ProductID] || {}).Status !== STATUS.ACTIVE;
  ch.forEach((m) => {
    if (m.BundleID) {
      const b = db_('BUNDLE_MASTERS').byId(m.BundleID);
      if (b && b.Status !== STATUS.ACTIVE) inactiveUse.push({ sku: b.BundleSKU, product: b.BundleName, status: b.Status, usedBy: CHANNEL_LABEL[m.System] + ' ' + (m.ExternalProductId || m.ExternalSku) });
      return;
    }
    const conv = m.ConversionID ? db_('UNIT_CONVERSIONS').byId(m.ConversionID) : null;
    const v = vById[m.VariantID || (conv && conv.VariantID)];
    if (notActive(v)) inactiveUse.push(Object.assign(v ? vLabel(v) : {}, { usedBy: CHANNEL_LABEL[m.System] + ' ' + (m.ExternalProductId || m.ExternalSku) }));
  });
  db_('SUPPLIER_PRODUCT_MAPPING')
    .filter((m) => m.Status === STATUS.ACTIVE)
    .forEach((m) => notActive(vById[m.VariantID]) && inactiveUse.push(Object.assign(vLabel(vById[m.VariantID] || {}), { usedBy: 'Supplier ' + m.SupplierProductCode })));
  const bundles = db_('BUNDLE_MASTERS').filter((b) => b.Status === STATUS.ACTIVE);
  bundles.forEach((b) => db_('BUNDLE_COMPONENTS').filter((c) => c.BundleID === b.BundleID && c.Status === STATUS.ACTIVE).forEach((c) => notActive(vById[c.VariantID]) && inactiveUse.push(Object.assign(vLabel(vById[c.VariantID] || {}), { usedBy: 'Bundle ' + b.BundleSKU }))));
  add('inactive_in_use', 'SKU tidak aktif masih dipakai mapping / bundle aktif', 'warn', inactiveUse, 'Pindahkan mapping ke SKU pengganti (controlled deprecation) atau nonaktifkan mapping/bundle tersebut.');
  add('parent_without_child', 'Parent tanpa Child SKU yang valid', 'error', P.filter((p) => [STATUS.ACTIVE, STATUS.DRAFT].indexOf(p.Status) >= 0 && !V.some((v) => v.ProductID === p.ProductID && [STATUS.ACTIVE, STATUS.DRAFT].indexOf(v.Status) >= 0)).map((p) => ({ productId: p.ProductID, productCode: p.ProductCode, product: p.ProductName, status: p.Status })), 'Tambahkan / aktifkan Child SKU, atau ubah status produk menjadi Discontinued/Archived.');
  const badBundles = [];
  db_('BUNDLE_MASTERS')
    .filter((b) => [STATUS.ACTIVE, STATUS.DRAFT].indexOf(b.Status) >= 0)
    .forEach((b) => {
      const v = bundleView_(b);
      const probs = [];
      if (!v.components.length) probs.push('tanpa komponen');
      v.components.forEach((c) => {
        if (c.skuStatus !== STATUS.ACTIVE) probs.push(c.sku + ' ' + (STATUS_LABEL[c.skuStatus] || c.skuStatus));
        if (!(c.quantity >= 1)) probs.push(c.sku + ' jumlah tidak valid');
      });
      if (b.BundleType === 'MULTIPACK' && (v.components.length !== 1 || v.components[0].quantity < 2)) probs.push('multipack harus 1 SKU × ≥ 2');
      if (b.BundleType === 'REQUEST_MIX' && v.components.reduce((s, c) => s + c.quantity, 0) < (b.PickQuantity || 0)) probs.push('total pilihan maksimum < jumlah isi');
      if (probs.length) badBundles.push({ sku: b.BundleSKU, product: b.BundleName, status: b.Status, problem: probs.join('; '), bundleId: b.BundleID });
    });
  add('bundle_invalid', 'Bundle dengan komponen tidak valid', 'error', badBundles, 'Ganti komponen yang tidak aktif di menu Packaging & Bundle.');

  // ---- kelengkapan & kemiripan
  add('variant_no_barcode', 'Child SKU aktif tanpa barcode', 'info', V.filter((v) => v.Status === STATUS.ACTIVE && !v.GTIN && !v.InternalBarcode && (pById[v.ProductID] || {}).Status === STATUS.ACTIVE).map(vLabel), 'Scan GTIN produsen di Edit produk, atau alokasikan barcode internal bila tidak ada GTIN.');
  const threshold = Number(getSettings_().fuzzy_threshold) || 0.82;
  const pairs = [];
  Object.values(groupBy_(P.filter((p) => live(p.Status)), 'BrandID')).forEach((list) => {
    for (let i = 0; i < list.length && pairs.length < 300; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const score = a.NameKey === b.NameKey ? 1 : nameSimilarity(a.ProductName, b.ProductName);
        if (score >= threshold) pairs.push({ brand: (brands[a.BrandID] || {}).BrandName, a: a.ProductName + ' (' + a.ProductCode + ')', b: b.ProductName + ' (' + b.ProductCode + ')', score: Math.round(score * 100) + '%', productId: a.ProductID, productId2: b.ProductID });
      }
  });
  add('similar_parents', 'Kandidat Parent ganda (nama mirip)', 'warn', pairs, 'Bandingkan barcode & ukuran. Bila barang sama: pindahkan varian/mapping ke produk utama lalu deprecate duplikatnya. Tidak pernah digabung otomatis.');
  add('supplier_spec', 'Barang supplier dengan spesifikasi berbeda', 'warn', db_('SUPPLIER_PRODUCT_MAPPING').filter((m) => m.Status === STATUS.ACTIVE && m.SpecMismatch).map((m) => Object.assign(vLabel(vById[m.VariantID] || {}), { supplierCode: m.SupplierProductCode, note: m.SpecNote })), 'Evaluasi apakah perlu Child SKU baru (isi/formula/kemasan berbeda = barang berbeda).');

  const summary = { error: 0, warn: 0, info: 0 };
  sections.forEach((s) => (summary[s.severity] += s.count));
  return { summary, sections, checkedAt: now_() };
}
