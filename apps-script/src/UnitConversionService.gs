/**
 * Packaging & Unit Conversion — OPSIONAL saat registrasi, berbasis KUANTITAS (bukan volume produk).
 *   Parfum 50 ml dan 100 ml = dua VARIAN berbeda (bukan konversi satuan).
 *   1 BOX parfum 50 ml berisi 24 BOTOL parfum 50 ml = KONVERSI kemasan.
 *
 * Disimpan per varian di UNIT_CONVERSIONS (isi BOX boleh berbeda antar-varian). Representasi utama = kuantitas
 * ekuivalen satuan dasar (BaseUnitEquivalent): 1 BOX = 24 BOTOL, 1 KARTON = 6 BOX → 144 BOTOL.
 * Stok tetap dihitung dalam satuan dasar; satuan kemasan hanya pengali, sehingga tidak ada penggandaan stok.
 *
 * Konversi TIDAK otomatis membuat SKU. Hanya kemasan yang ditandai trade item (dijual / punya GTIN sendiri)
 * yang mendapat SKU internal sendiri (SKU000123) — GTIN unit dasar tidak pernah diganti.
 * Status: ACTIVE · INACTIVE (kemasan ber-SKU yang tidak dipakai) · DELETED (kemasan operasional yang dihapus).
 */

function conversionView_(c) {
  return {
    id: c.ConversionID,
    unitName: c.UnitName,
    factor: c.ConversionFactor,
    containsUnit: c.ContainsUnit,
    baseUnitEquivalent: c.BaseUnitEquivalent,
    isBaseUnit: c.IsBaseUnit,
    isTradeItem: c.IsTradeItem,
    sku: c.SKU || '',
    gtin: c.GTIN || '',
    internalBarcode: c.InternalBarcode || '',
    status: c.Status,
    sortOrder: c.SortOrder,
  };
}

/**
 * Validasi & hitung konversi satu varian. Mengembalikan daftar rencana (urut) untuk disimpan.
 * vp: rencana varian (planVariants_), ctx: { baseUnit, err }
 */
function planConversions_(vp, ctx) {
  const err = ctx.err;
  const dbConvs = vp.dbv ? db_('UNIT_CONVERSIONS').filter((c) => c.VariantID === vp.dbv.VariantID && !c.IsBaseUnit && c.Status !== STATUS.DELETED) : [];
  const input = vp.iv.conversions || [];
  const mentioned = {};
  const items = [];
  input.forEach((ic, j) => {
    const path = `${vp.path}.conversions.${j}`;
    const dbc = ic.id ? dbConvs.find((c) => c.ConversionID === ic.id) : null;
    if (ic.id && !dbc) return err(path, 'Satuan kemasan tidak ditemukan pada varian ini');
    if (ic.id) mentioned[ic.id] = 1;
    let status = [STATUS.INACTIVE, STATUS.DELETED].indexOf(ic.status) >= 0 ? ic.status : STATUS.ACTIVE;
    if (status === STATUS.DELETED && dbc && dbc.IsTradeItem) {
      err(path + '.status', `Kemasan ${dbc.UnitName} punya SKU ${dbc.SKU} — tidak dapat dihapus, hanya dinonaktifkan`);
      status = STATUS.INACTIVE;
    }
    items.push({ j, path, ic, dbc, status });
  });
  // konversi tersimpan yang tidak dikirim formulir dipertahankan apa adanya (ditempatkan lebih dulu)
  const kept = dbConvs
    .filter((c) => !mentioned[c.ConversionID])
    .sort((a, b) => a.SortOrder - b.SortOrder)
    .map((c) => ({ j: -1, path: vp.path + '.conversions', ic: { id: c.ConversionID, unitName: c.UnitName, factor: c.ConversionFactor, containsUnit: c.ContainsUnit, isTradeItem: c.IsTradeItem, status: c.Status }, dbc: c, status: c.Status, kept: true }));
  const all = kept.concat(items);
  const active = all.filter((x) => x.status === STATUS.ACTIVE);
  const calc = computeConversions(ctx.baseUnit, active.map((x) => ({ unitName: x.ic.unitName, factor: x.ic.factor, containsUnit: x.ic.containsUnit })));
  calc.errors.forEach((e) => err(active[e.index].path + '.' + e.field, e.message));
  active.forEach((x, k) => Object.assign(x, calc.rows[k]));
  all
    .filter((x) => x.status !== STATUS.ACTIVE)
    .forEach((x) => Object.assign(x, { unitName: normalizeUnit(x.ic.unitName), factor: Number(x.ic.factor), containsUnit: normalizeUnit(x.ic.containsUnit) || ctx.baseUnit, baseUnitEquivalent: x.dbc ? x.dbc.BaseUnitEquivalent : null }));
  // satuan yang masih menjadi "isi" kemasan aktif lain tidak boleh dinonaktifkan / dihapus
  all
    .filter((x) => x.status !== STATUS.ACTIVE)
    .forEach((x) => {
      if (active.some((a) => a.containsUnit === x.unitName)) err(x.path + '.status', `${x.unitName} masih dipakai sebagai isi kemasan lain`);
    });
  all.forEach((x) => {
    x.isTradeItem = !!x.ic.isTradeItem;
    if (x.dbc && x.dbc.IsTradeItem) {
      // kemasan ber-SKU: identitasnya permanen
      if (!x.isTradeItem) err(x.path + '.isTradeItem', 'Kemasan yang sudah punya SKU tidak dapat dijadikan kemasan biasa. Nonaktifkan bila tidak dipakai.');
      if (x.unitName !== x.dbc.UnitName || x.factor !== x.dbc.ConversionFactor || x.containsUnit !== x.dbc.ContainsUnit)
        err(x.path + '.factor', `Isi kemasan ${x.dbc.UnitName} (SKU ${x.dbc.SKU}) tidak dapat diubah karena SKU-nya permanen. Nonaktifkan lalu buat kemasan baru.`);
      x.sku = x.dbc.SKU;
    } else x.sku = '';
    x.needsSku = x.isTradeItem && x.status === STATUS.ACTIVE && !x.sku;
  });
  return all;
}

/** Kalkulator: kuantitas dalam satuan apa pun → kuantitas ekuivalen satuan dasar. 3 BOX (×24) = 72 BOTOL. */
function unitConvert_(p) {
  const v = db_('PRODUCT_VARIANTS').byId(p.variantId);
  if (!v) throw new AppError('Varian tidak ditemukan', [], 'NOT_FOUND');
  const qty = Number(p.qty);
  if (!(qty >= 0) || !isFinite(qty)) throw new AppError('Jumlah tidak valid');
  const unit = normalizeUnit(p.unit);
  const c = db_('UNIT_CONVERSIONS').find((x) => x.VariantID === v.VariantID && x.UnitName === unit && x.Status === STATUS.ACTIVE);
  if (!c) throw new AppError(`Satuan ${unit} tidak terdaftar untuk varian ini`);
  const base = db_('UNIT_CONVERSIONS').find((x) => x.VariantID === v.VariantID && x.IsBaseUnit);
  return { qty, unit, baseQty: qty * c.BaseUnitEquivalent, baseUnit: base ? base.UnitName : '', factor: c.BaseUnitEquivalent };
}
