/**
 * Migrasi EKSPLISIT dari struktur versi lama (tab Brands, Categories, Products, Variants, SKUs, Barcodes, …)
 * ke struktur revisi (MASTER_*, PRODUCT_VARIANTS, UNIT_CONVERSIONS, …). Dijalankan oleh setup().
 *
 * Prinsip:
 *  - Tab lama TIDAK dihapus / diubah — tetap ada sebagai arsip & bahan cek.
 *  - ID lama dipakai ulang → idempoten (aman dijalankan berkali-kali; baris yang sudah ada dilewati).
 *  - Kode brand/kategori & SKU lama DIPERTAHANKAN apa adanya (tidak dibuat ulang).
 *  - SKU satuan (isi 1) → SKU varian. SKU multipack → satuan kemasan ber-SKU (SKU lama tetap).
 *  - Yang tidak punya padanan di struktur baru (bundle/BOM, harga, approval) tidak dimigrasikan dan dilaporkan.
 */

const LEGACY_ATTR_LABEL_ = { shade: 'Shade', color: 'Warna', size: 'Ukuran', volume: 'Volume', scent: 'Aroma', formula: 'Formulasi', type: 'Tipe', other: 'Lainnya' };

/** Baca tab lama berdasarkan header baris 1 (tidak bergantung pada SCHEMA). */
function legacyRows_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = sh.getLastColumn ? sh.getLastColumn() : sh.getMaxColumns();
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

function migrateLegacy_(user) {
  const r = { brands: 0, categories: 0, products: 0, variants: 0, packs: 0, barcodes: 0, assignments: 0, mappings: 0, skipped: [], notMigrated: [] };
  const ts = now_();
  const S = getSettings_();

  // ---- brand & kategori (kode lama dipertahankan)
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
      if (T.find((x) => x.NameKey === masterNameKey(name))) return r.skipped.push(`${k.label} "${name}": nama sudah ada`);
      T.insert({ [k.id]: o.id, [k.code]: code, [k.name]: name, NameKey: masterNameKey(name), Status: o.status === 'active' ? STATUS.ACTIVE : STATUS.INACTIVE, CreatedBy: o.proposed_by || 'migrasi', CreatedAt: o.created_at || ts, UpdatedBy: 'migrasi', UpdatedAt: ts });
      r[kind === 'brand' ? 'brands' : 'categories']++;
    });
  });

  // ---- registry barcode
  const oldBarcodes = legacyRows_('Barcodes');
  const bcType = {};
  oldBarcodes.forEach((b) => {
    bcType[b.code] = b.barcode_type;
    if (!b.code || findBarcode_(b.code)) return;
    db_('BARCODE_REGISTRY').insert({ Code: b.code, BarcodeType: b.barcode_type, Symbology: b.symbology, Status: b.status, VerifiedOfficial: String(b.verified_official).toUpperCase() === 'TRUE', RequestKey: b.request_key, Notes: b.notes, AllocatedBy: b.allocated_by, AllocatedAt: b.allocated_at });
    r.barcodes++;
  });

  // ---- produk, varian, SKU
  const oldProducts = legacyRows_('Products');
  const oldVariants = legacyRows_('Variants');
  const oldSkus = legacyRows_('SKUs');
  const oldAssign = legacyRows_('BarcodeAssignments');
  const activeBc = {};
  oldAssign.filter((a) => !a.unassigned_at).forEach((a) => (a.sku_id ? (activeBc['s:' + a.sku_id] = a.code) : (activeBc['v:' + a.variant_id] = a.code)));
  const skuOwner = skuOwnerMap_(null);
  const skuToConv = {};
  const skuToVariant = {};
  let maxNo = 0;
  oldProducts.forEach((o) => {
    maxNo = Math.max(maxNo, Number(o.product_no) || 0);
    if (!o.id || db_('MASTER_PRODUCTS').byId(o.id)) return;
    const brand = db_('MASTER_BRANDS').byId(o.brand_id);
    const cat = db_('MASTER_CATEGORIES').byId(o.category_id);
    if (!brand || !cat) return r.skipped.push(`Produk "${o.name}": brand/kategori tidak ditemukan`);
    const baseUnit = normalizeUnit(o.base_unit) || 'PCS';
    const hasVariants = String(o.has_variants).toUpperCase() === 'TRUE';
    const p = db_('MASTER_PRODUCTS').insert({
      ProductID: o.id,
      ProductNo: Number(o.product_no) || nextSeq_('product_no'),
      BrandID: brand.BrandID,
      CategoryID: cat.CategoryID,
      ProductName: cleanText(o.name),
      NameKey: normalizeName(o.name),
      ProductCode: normalizeCode(o.product_code),
      BaseUnit: baseUnit,
      HasVariants: hasVariants,
      Status: ['active', 'approved'].indexOf(o.status) >= 0 ? STATUS.ACTIVE : STATUS.INACTIVE,
      CreatedBy: o.created_by || 'migrasi',
      CreatedAt: o.created_at || ts,
      UpdatedBy: 'migrasi',
      UpdatedAt: ts,
      Version: 1,
    });
    r.products++;
    oldVariants
      .filter((v) => v.product_id === o.id)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
      .forEach((ov, vi) => {
        const attrs = (legacyJson_(ov.attributes_json) || []).map((a) => ({ name: LEGACY_ATTR_LABEL_[a.type] || cleanAttrName(a.type), value: cleanText(a.value) })).filter((a) => a.value);
        const skus = oldSkus.filter((s) => s.variant_id === ov.id);
        const single = skus.find((s) => s.sku_type === 'single' && s.sku_code);
        let sku = single ? String(single.sku_code).toUpperCase() : '';
        if (!sku) {
          const gen = buildSku(S.sku_template, { brand: brand.BrandCode, category: cat.CategoryCode, product: p.ProductCode, variant: ov.variant_code });
          sku = gen.sku;
          for (let n = 2; skuOwner[sku]; n++) sku = gen.sku + '-M' + n;
          r.skipped.push(`Varian "${o.name} ${ov.name}": belum punya SKU satuan → SKU baru ${sku}`);
        } else if (skuOwner[sku]) {
          r.skipped.push(`Varian "${o.name} ${ov.name}": SKU ${sku} bentrok dengan ${skuOwner[sku]} — tidak dimigrasikan`);
          return;
        }
        skuOwner[sku] = p.ProductName;
        const vcode = bcOf_(activeBc['v:' + ov.id], bcType);
        const v = db_('PRODUCT_VARIANTS').insert({
          VariantID: ov.id,
          ProductID: p.ProductID,
          VariantCode: normalizeCode(ov.variant_code),
          VariantName: cleanText(ov.name) || attrs.map((a) => a.value).join(' ') || 'Standar',
          VariantAttributes: attrs,
          AttributeKey: attributeKey(attrs),
          SKU: sku,
          GTIN: vcode.gtin,
          InternalBarcode: vcode.internal,
          IsDefault: !attrs.length,
          Status: ov.status === 'archived' ? STATUS.INACTIVE : STATUS.ACTIVE,
          SortOrder: vi + 1,
          CreatedBy: ov.created_by || 'migrasi',
          CreatedAt: ov.created_at || ts,
          UpdatedAt: ts,
        });
        r.variants++;
        if (single) skuToVariant[single.id] = v.VariantID;
        db_('UNIT_CONVERSIONS').insert({ ConversionID: uuid_(), VariantID: v.VariantID, ProductID: p.ProductID, UnitName: baseUnit, ConversionFactor: 1, ContainsUnit: baseUnit, BaseUnitEquivalent: 1, IsBaseUnit: true, IsTradeItem: false, SKU: '', GTIN: '', InternalBarcode: '', Status: STATUS.ACTIVE, SortOrder: 0, CreatedAt: ts, UpdatedAt: ts });
        const usedUnits = {};
        usedUnits[baseUnit] = 1;
        let order = 0;
        skus
          .filter((s) => s.sku_type === 'multipack')
          .sort((a, b) => Number(a.pack_qty) - Number(b.pack_qty))
          .forEach((s) => {
            const qty = Number(s.pack_qty);
            let unit = normalizeUnit(s.sales_unit) || 'PACK';
            if (usedUnits[unit]) unit = (unit + qty).slice(0, 12);
            usedUnits[unit] = 1;
            let psku = String(s.sku_code || '').toUpperCase() || packSku(sku, unit, qty);
            if (skuOwner[psku]) {
              r.skipped.push(`Kemasan ${psku} bentrok dengan ${skuOwner[psku]} — tidak dimigrasikan`);
              return;
            }
            skuOwner[psku] = p.ProductName;
            const pc = bcOf_(activeBc['s:' + s.id], bcType);
            const c = db_('UNIT_CONVERSIONS').insert({ ConversionID: s.id, VariantID: v.VariantID, ProductID: p.ProductID, UnitName: unit, ConversionFactor: qty, ContainsUnit: baseUnit, BaseUnitEquivalent: qty, IsBaseUnit: false, IsTradeItem: true, SKU: psku, GTIN: pc.gtin, InternalBarcode: pc.internal, Status: ['active', 'draft'].indexOf(s.status) >= 0 ? STATUS.ACTIVE : STATUS.INACTIVE, SortOrder: ++order, CreatedAt: s.created_at || ts, UpdatedAt: ts });
            skuToConv[s.id] = c.ConversionID;
            r.packs++;
          });
        skus.filter((s) => s.sku_type === 'bundle').forEach((s) => r.notMigrated.push(`Bundle ${s.sku_code || s.id} (${o.name}) — bundle/BOM tidak ada di struktur revisi; data tetap di tab SKUs & Components`));
      });
  });
  if (maxNo) setSeq_('product_no', Math.max(nextSeq_('product_no', 0), maxNo + 1));

  // ---- histori pemasangan barcode
  oldAssign.forEach((a) => {
    if (!a.id || db_('BARCODE_ASSIGNMENTS').byId(a.id)) return;
    const conv = a.sku_id ? skuToConv[a.sku_id] : '';
    const variant = a.sku_id ? skuToVariant[a.sku_id] || '' : a.variant_id;
    if (!conv && !variant) return;
    if (!conv && !db_('PRODUCT_VARIANTS').byId(variant)) return;
    db_('BARCODE_ASSIGNMENTS').insert({ AssignmentID: a.id, Code: a.code, ProductID: a.product_id, VariantID: conv ? '' : variant, ConversionID: conv || '', AssignedBy: a.assigned_by, AssignedAt: a.assigned_at, UnassignedBy: a.unassigned_by, UnassignedAt: a.unassigned_at, Reason: a.reason });
    r.assignments++;
  });

  // ---- mapping BeeCloud / Shopee (berbasis kode SKU)
  const skuCode = indexBy_(oldSkus, 'id');
  legacyRows_('Mappings').forEach((m) => {
    if (!m.id || db_('SKU_MAPPINGS').byId(m.id)) return;
    const s = skuCode[m.sku_id];
    if (!s || !s.sku_code) return;
    db_('SKU_MAPPINGS').insert({ MappingID: m.id, SKU: String(s.sku_code).toUpperCase(), System: m.system, ExternalSku: m.external_sku, ExternalProductId: m.external_product_id, ExternalVariationId: m.external_variation_id, ListingName: m.listing_name, MappingStatus: m.mapping_status, IsActive: String(m.is_active).toUpperCase() === 'TRUE', LastExportedAt: m.last_exported_at, LastConfirmedAt: m.last_confirmed_at, LastError: m.last_error, Notes: m.notes, CreatedBy: m.created_by, CreatedAt: m.created_at, UpdatedAt: m.updated_at });
    r.mappings++;
  });

  if (legacyRows_('Prices').length) r.notMigrated.push('Histori harga (tab Prices) — fitur harga dihapus dari aplikasi; data tetap di tab lama');
  if (legacyRows_('Requests').length) r.notMigrated.push('Permintaan approval (tab Requests/ApprovalHistory) — workflow approval dihapus; data tetap di tab lama');
  const moved = r.brands + r.categories + r.products + r.variants + r.packs + r.barcodes + r.assignments + r.mappings;
  if (moved || r.skipped.length || r.notMigrated.length) audit_(user, 'migration.legacy', 'system', '', null, r);
  return r;
}

function bcOf_(code, types) {
  if (!code) return { gtin: '', internal: '' };
  return types[code] === 'internal' ? { gtin: '', internal: code } : { gtin: code, internal: '' };
}
