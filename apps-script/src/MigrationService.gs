/**
 * Migrasi EKSPLISIT dari struktur lama ke struktur v3. Dijalankan oleh setup() — aman diulang (idempoten).
 *
 *  v2 → v3 : Sequences → SYSTEM_COUNTERS, AuditLog → AUDIT_LOGS, BARCODE_REGISTRY + BARCODE_ASSIGNMENTS → VARIANT_BARCODES,
 *            SKU_MAPPINGS → EXTERNAL_SKU_MAPPINGS, PRODUCT_VARIANTS.VariantAttributes → VARIANT_ATTRIBUTES.
 *            Produk, varian & SKU v2 TIDAK diubah (kode existing tidak diganti otomatis).
 *  v1 → v3 : Brands/Categories (kode lama dipertahankan), Products/Variants/SKUs → produk + varian dengan SKU internal baru;
 *            SKU lama → EXTERNAL_SKU_MAPPINGS (system "legacy") sehingga tetap bisa ditelusuri & dipindai;
 *            multipack → MULTIPACK virtual (SKU MP…, komponen N × Child SKU); barcode paket dipasang ke bundle.
 *  Tab lama tidak pernah dihapus / diubah. Yang tidak punya padanan (bundle/BOM, harga, approval) dilaporkan.
 */

const LEGACY_ATTR_LABEL_ = { shade: 'Shade', color: 'Warna', size: 'Ukuran', volume: 'Volume', scent: 'Aroma', formula: 'Formulasi', type: 'Tipe', other: 'Lainnya' };

/** Baca tab lama berdasarkan header baris 1 (tidak bergantung pada SCHEMA). */
function legacyRows_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = sh.getLastColumn ? sh.getLastColumn() : sh.getMaxColumns();
  if (!width) return [];
  const vals = sh.getRange(1, 1, last, width).getValues();
  const head = vals[0].map((h) => String(h || '').trim());
  return vals
    .slice(1)
    .filter((v) => v.some((x) => x !== '' && x !== null))
    .map((v) => {
      const o = {};
      head.forEach((h, i) => h && (o[h] = rawCell_(v[i])));
      return o;
    });
}

function legacyJson_(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

function migrateLegacy_(actor) {
  const r = { brands: 0, categories: 0, products: 0, variants: 0, packs: 0, attributes: 0, barcodes: 0, legacySkus: 0, mappings: 0, audit: 0, counters: 0, skipped: [], notMigrated: [] };
  migrateV2_(r);
  migrateV1_(r, actor);
  const moved = Object.keys(r).filter((k) => typeof r[k] === 'number').reduce((s, k) => s + r[k], 0);
  if (moved || r.skipped.length || r.notMigrated.length) audit_(actor, 'migration.legacy', 'system', '', null, r);
  return r;
}

// ------------------------------------------------------------------ v2 → v3

function migrateV2_(r) {
  // penghitung
  legacyRows_('Sequences').forEach((s) => {
    if (!s.name || db_('SYSTEM_COUNTERS').find((c) => c.CounterName === s.name)) return;
    db_('SYSTEM_COUNTERS').insert({ CounterName: s.name, Value: String(s.value || '1'), UpdatedAt: now_() });
    r.counters++;
  });
  // audit
  const haveLog = {};
  db_('AUDIT_LOGS').rows().forEach((a) => (haveLog[a.LogID] = 1));
  legacyRows_('AuditLog').forEach((a) => {
    if (!a.id || haveLog[a.id]) return;
    db_('AUDIT_LOGS').insert({ LogID: a.id, CreatedAt: a.created_at, Actor: a.actor, Action: a.action, EntityType: a.entity_type, EntityID: a.entity_id, BeforeJson: legacyJson_(a.before_json), AfterJson: legacyJson_(a.after_json), MetaJson: legacyJson_(a.meta_json) });
    r.audit++;
  });
  // atribut varian
  const hasAttr = {};
  db_('VARIANT_ATTRIBUTES').rows().forEach((a) => (hasAttr[a.VariantID] = 1));
  db_('PRODUCT_VARIANTS')
    .rows()
    .forEach((v) => {
      if (hasAttr[v.VariantID] || !(v.VariantAttributes || []).length) return;
      writeAttributes_(v, cleanAttributes_(v.VariantAttributes));
      r.attributes++;
    });
  // barcode
  const reg = legacyRows_('BARCODE_REGISTRY');
  const regBy = indexBy_(reg, 'Code');
  const haveBc = {};
  db_('VARIANT_BARCODES').rows().forEach((b) => (haveBc[b.BarcodeID] = 1));
  const assigned = {};
  legacyRows_('BARCODE_ASSIGNMENTS').forEach((a) => {
    assigned[a.Code] = 1;
    if (!a.AssignmentID || haveBc[a.AssignmentID]) return;
    const g = regBy[a.Code] || {};
    db_('VARIANT_BARCODES').insert({ BarcodeID: a.AssignmentID, Code: a.Code, BarcodeType: String(g.BarcodeType || 'gtin').toUpperCase(), Symbology: g.Symbology || 'EAN13', Status: a.UnassignedAt ? 'RETIRED' : 'ACTIVE', ProductID: a.ProductID, VariantID: a.VariantID, ConversionID: a.ConversionID, VerifiedOfficial: String(g.VerifiedOfficial).toUpperCase() === 'TRUE', RequestKey: g.RequestKey, Notes: g.Notes, CreatedBy: a.AssignedBy, CreatedAt: a.AssignedAt, RetiredBy: a.UnassignedBy, RetiredAt: a.UnassignedAt, Reason: a.Reason });
    r.barcodes++;
  });
  reg.forEach((g) => {
    const id = 'reg-' + g.Code;
    if (assigned[g.Code] || haveBc[id] || !g.Code) return;
    db_('VARIANT_BARCODES').insert({ BarcodeID: id, Code: g.Code, BarcodeType: String(g.BarcodeType || 'internal').toUpperCase(), Symbology: g.Symbology || 'EAN13', Status: String(g.Status || 'allocated').toUpperCase() === 'VOID' ? 'VOID' : 'ALLOCATED', VerifiedOfficial: false, RequestKey: g.RequestKey, Notes: g.Notes, CreatedBy: g.AllocatedBy, CreatedAt: g.AllocatedAt });
    r.barcodes++;
  });
  // mapping BeeCloud / Shopee (berbasis kode SKU)
  const bySku = {};
  db_('PRODUCT_VARIANTS').rows().forEach((v) => v.SKU && (bySku[v.SKU.toUpperCase()] = { p: v.ProductID, v: v.VariantID, c: '' }));
  db_('UNIT_CONVERSIONS').rows().forEach((c) => c.SKU && (bySku[c.SKU.toUpperCase()] = { p: c.ProductID, v: '', c: c.ConversionID }));
  legacyRows_('SKU_MAPPINGS').forEach((m) => {
    if (!m.MappingID || db_('EXTERNAL_SKU_MAPPINGS').byId(m.MappingID)) return;
    const t = bySku[String(m.SKU).toUpperCase()];
    if (!t) return r.skipped.push(`Mapping ${m.System} ${m.ExternalSku}: SKU ${m.SKU} tidak ditemukan`);
    db_('EXTERNAL_SKU_MAPPINGS').insert({ MappingID: m.MappingID, System: m.System, ExternalSku: m.ExternalSku, ProductID: t.p, VariantID: t.v, ConversionID: t.c, InternalSku: m.SKU, ExternalProductId: m.ExternalProductId, ExternalVariationId: m.ExternalVariationId, ListingName: m.ListingName, MappingStatus: m.MappingStatus, IsActive: String(m.IsActive).toUpperCase() === 'TRUE', LastExportedAt: m.LastExportedAt, LastConfirmedAt: m.LastConfirmedAt, LastError: m.LastError, Notes: m.Notes, CreatedBy: m.CreatedBy, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt });
    r.mappings++;
  });
}

// ------------------------------------------------------------------ v1 → v3

function migrateV1_(r, actor) {
  const ts = now_();
  [
    ['Brands', 'brand'],
    ['Categories', 'category'],
  ].forEach(([tab, kind]) => {
    const k = MASTER_KIND[kind];
    const T = db_(k.table);
    legacyRows_(tab).forEach((o) => {
      if (!o.id || T.byId(o.id)) return;
      const name = cleanText(o.name);
      const code = normalizeCode(o.code);
      if (!name || !code) return r.skipped.push(`${k.label} tanpa nama/kode (id ${o.id})`);
      if (T.find((x) => String(x[k.code]).toUpperCase() === code)) return r.skipped.push(`${k.label} "${name}": kode ${code} sudah dipakai`);
      if (T.find((x) => x.NameKey === masterNameKey(name) && x.Status !== STATUS.DELETED)) return r.skipped.push(`${k.label} "${name}": nama sudah ada`);
      T.insert({ [k.id]: o.id, [k.code]: code, [k.name]: name, NameKey: masterNameKey(name), Status: o.status === 'active' ? STATUS.ACTIVE : STATUS.INACTIVE, CreatedBy: o.proposed_by || 'migrasi', CreatedAt: o.created_at || ts, UpdatedBy: 'migrasi', UpdatedAt: ts });
      r[kind === 'brand' ? 'brands' : 'categories']++;
    });
  });

  const oldProducts = legacyRows_('Products');
  if (!oldProducts.length) return;
  const oldVariants = legacyRows_('Variants');
  const oldSkus = legacyRows_('SKUs');
  const oldAssign = legacyRows_('BarcodeAssignments');
  const bcType = {};
  legacyRows_('Barcodes').forEach((b) => (bcType[b.code] = String(b.barcode_type || 'gtin').toUpperCase()));
  const activeBc = {};
  oldAssign.filter((a) => !a.unassigned_at).forEach((a) => (a.sku_id ? (activeBc['s:' + a.sku_id] = a.code) : (activeBc['v:' + a.variant_id] = a.code)));
  const skuOwner = skuOwnerMap_();
  const legacyTarget = {}; // sku_id lama → { p, v, c }
  let maxNo = 0;
  oldProducts.forEach((o) => (maxNo = Math.max(maxNo, Number(o.product_no) || 0)));
  if (maxNo && nextSeq_('product_no', 0) <= maxNo) setSeq_('product_no', maxNo + 1);
  oldProducts.forEach((o) => {
    if (!o.id || db_('MASTER_PRODUCTS').byId(o.id)) return;
    const brand = db_('MASTER_BRANDS').byId(o.brand_id);
    const cat = db_('MASTER_CATEGORIES').byId(o.category_id);
    if (!brand || !cat) return r.skipped.push(`Produk "${o.name}": brand/kategori tidak ditemukan`);
    const baseUnit = normalizeUnit(o.base_unit) || 'PCS';
    let code = Number(o.product_no) ? padCode_(PRODUCT_CODE_PREFIX, Number(o.product_no)) : '';
    let no = Number(o.product_no) || 0;
    if (!code || db_('MASTER_PRODUCTS').find((p) => p.ProductCode === code)) {
      const pc = allocateProductCode_();
      code = pc.code;
      no = pc.no;
    }
    const variants = oldVariants.filter((v) => v.product_id === o.id).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    const p = db_('MASTER_PRODUCTS').insert({
      ProductID: o.id,
      ProductNo: no,
      BrandID: brand.BrandID,
      CategoryID: cat.CategoryID,
      ProductName: cleanText(o.name),
      NameKey: normalizeName(o.name),
      ProductCode: code,
      BaseUnit: baseUnit,
      HasVariants: variants.length > 1 || String(o.has_variants).toUpperCase() === 'TRUE',
      Status: ['active', 'approved'].indexOf(o.status) >= 0 ? STATUS.ACTIVE : STATUS.INACTIVE,
      CreatedBy: o.created_by || 'migrasi',
      CreatedAt: o.created_at || ts,
      UpdatedBy: 'migrasi',
      UpdatedAt: ts,
      Version: 1,
      LegacyCode: normalizeCode(o.product_code),
    });
    r.products++;
    variants.forEach((ov, vi) => {
      let attrs = (legacyJson_(ov.attributes_json) || []).map((a) => ({ name: LEGACY_ATTR_LABEL_[a.type] || cleanAttrName(a.type), value: cleanText(a.value) })).filter((a) => a.value);
      if (p.HasVariants && !attrs.length) attrs = [{ name: 'Varian', value: cleanText(ov.name) || 'Varian ' + (vi + 1) }];
      const sku = allocateSku_(skuOwner);
      skuOwner[sku] = p.ProductName;
      const vbc = activeBc['v:' + ov.id] || '';
      const v = db_('PRODUCT_VARIANTS').insert({
        VariantID: ov.id,
        ProductID: p.ProductID,
        VariantCode: normalizeCode(ov.variant_code),
        VariantName: cleanText(ov.name) || attrs.map((a) => a.value).join(' ') || 'Standar',
        VariantAttributes: attrs,
        AttributeKey: attributeKey(attrs),
        SKU: sku,
        GTIN: vbc && bcType[vbc] !== 'INTERNAL' ? vbc : '',
        InternalBarcode: vbc && bcType[vbc] === 'INTERNAL' ? vbc : '',
        IsDefault: !attrs.length,
        Status: ov.status === 'archived' ? STATUS.INACTIVE : STATUS.ACTIVE,
        SortOrder: vi + 1,
        CreatedBy: ov.created_by || 'migrasi',
        CreatedAt: ov.created_at || ts,
        UpdatedAt: ts,
      });
      writeAttributes_(v, attrs);
      r.variants++;
      db_('UNIT_CONVERSIONS').insert({ ConversionID: uuid_(), VariantID: v.VariantID, ProductID: p.ProductID, UnitName: baseUnit, ConversionFactor: 1, ContainsUnit: baseUnit, BaseUnitEquivalent: 1, IsBaseUnit: true, IsTradeItem: false, SKU: '', GTIN: '', InternalBarcode: '', Status: STATUS.ACTIVE, SortOrder: 0, CreatedAt: ts, UpdatedAt: ts });
      const skus = oldSkus.filter((s) => s.variant_id === ov.id);
      const usedUnits = {};
      usedUnits[baseUnit] = 1;
      let order = 0;
      skus.forEach((s) => {
        if (s.sku_type === 'bundle') return r.notMigrated.push(`Bundle ${s.sku_code || s.id} (${o.name}) — bundle/BOM tidak ada di struktur v3; data tetap di tab SKUs & Components`);
        let target = { p: p.ProductID, v: v.VariantID, c: '' };
        if (s.sku_type === 'multipack') {
          // paket jual lama → MULTIPACK virtual (SKU MP…), bukan konversi kemasan
          const qty = Number(s.pack_qty);
          const bid = ensureMultipack_({ email: actor }, v.VariantID, qty, ts);
          const pbc = activeBc['s:' + s.id] || '';
          if (pbc && !db_('VARIANT_BARCODES').find((x) => x.Code === pbc && x.Status === 'ACTIVE')) db_('VARIANT_BARCODES').insert({ BarcodeID: uuid_(), Code: pbc, BarcodeType: bcType[pbc] || 'GTIN', Symbology: 'EAN13', Status: 'ACTIVE', ProductID: '', VariantID: '', ConversionID: '', BundleID: bid, VerifiedOfficial: false, CreatedBy: 'migrasi', CreatedAt: ts, Reason: 'migrasi v1' });
          target = { p: '', v: '', c: '', b: bid };
          r.packs++;
        }
        legacyTarget[s.id] = target;
        if (s.sku_code) addLegacySku_(r, String(s.sku_code).toUpperCase(), target, 'migrasi v1');
      });
    });
  });

  // histori pemasangan barcode
  oldAssign.forEach((a) => {
    if (!a.id || db_('VARIANT_BARCODES').byId(a.id)) return;
    const t = a.sku_id ? legacyTarget[a.sku_id] : { p: a.product_id, v: a.variant_id, c: '' };
    if (!t || t.b || (!t.v && !t.c)) return; // barcode paket sudah dipasang ke bundle saat migrasi
    if (t.v && !db_('PRODUCT_VARIANTS').byId(t.v)) return;
    db_('VARIANT_BARCODES').insert({ BarcodeID: a.id, Code: a.code, BarcodeType: bcType[a.code] || 'GTIN', Symbology: 'EAN13', Status: a.unassigned_at ? 'RETIRED' : 'ACTIVE', ProductID: t.p, VariantID: t.v, ConversionID: t.c, VerifiedOfficial: false, CreatedBy: a.assigned_by, CreatedAt: a.assigned_at, RetiredBy: a.unassigned_by, RetiredAt: a.unassigned_at, Reason: a.reason });
    r.barcodes++;
  });

  // mapping BeeCloud / Shopee v1
  legacyRows_('Mappings').forEach((m) => {
    if (!m.id || db_('EXTERNAL_SKU_MAPPINGS').byId(m.id)) return;
    const t = legacyTarget[m.sku_id];
    if (!t) return;
    db_('EXTERNAL_SKU_MAPPINGS').insert({ MappingID: m.id, System: m.system, ExternalSku: m.external_sku, ProductID: t.p, VariantID: t.v, ConversionID: t.c, BundleID: t.b || '', StoreAccount: '', InternalSku: '', ExternalProductId: m.external_product_id, ExternalVariationId: m.external_variation_id, ListingName: m.listing_name, MappingStatus: m.mapping_status, IsActive: String(m.is_active).toUpperCase() === 'TRUE', LastExportedAt: m.last_exported_at, LastConfirmedAt: m.last_confirmed_at, LastError: m.last_error, Notes: m.notes, CreatedBy: m.created_by || actor, CreatedAt: m.created_at || ts, UpdatedAt: m.updated_at || ts });
    r.mappings++;
  });
  if (legacyRows_('Prices').length) r.notMigrated.push('Histori harga (tab Prices) — fitur harga dihapus dari aplikasi; data tetap di tab lama');
  if (legacyRows_('Requests').length) r.notMigrated.push('Permintaan approval (tab Requests/ApprovalHistory) — workflow approval dihapus; data tetap di tab lama');
}

/** Catat SKU lama sebagai pemetaan "legacy" (sekali per kode). */
function addLegacySku_(r, code, t, note) {
  if (!code) return false;
  if (db_('EXTERNAL_SKU_MAPPINGS').find((m) => m.System === 'legacy' && String(m.ExternalSku).toUpperCase() === code)) return false;
  db_('EXTERNAL_SKU_MAPPINGS').insert({ MappingID: uuid_(), System: 'legacy', ExternalSku: code, ProductID: t.p, VariantID: t.c || t.b ? '' : t.v, ConversionID: t.c || '', BundleID: t.b || '', InternalSku: '', MappingStatus: 'legacy', IsActive: true, Notes: note || '', CreatedBy: 'migrasi', CreatedAt: now_(), UpdatedAt: now_() });
  r.legacySkus++;
  return true;
}
