/**
 * Dimensi & berat per Child SKU per satuan (PRODUCT_DIMENSIONS) — informasi logistik, opsional.
 *   - Disimpan TERPISAH per satuan: PCS (satuan dasar), BOX, KARTON, … Dimensi/berat BOX tidak pernah dihitung dari PCS
 *     (susunan & material kemasan berbeda).
 *   - Berat = berat KOTOR (barang + kemasannya) untuk kebutuhan pengiriman, disimpan dalam gram. Input boleh gram / kg.
 *   - Perubahan dimensi/berat tidak pernah mengubah SKU.
 * "Data kemasan lengkap" = satuan dasar punya panjang, lebar, tinggi, dan berat.
 */

const DIM_FIELDS_ = ['LengthCm', 'WidthCm', 'HeightCm', 'GrossWeightGrams'];
const DIM_MAX_CM_ = 1000;
const DIM_MAX_GRAMS_ = 1000000;

function dimensionView_(d) {
  return { id: d.DimensionID, unit: d.PackagingUnit, lengthCm: d.LengthCm, widthCm: d.WidthCm, heightCm: d.HeightCm, grossWeightGrams: d.GrossWeightGrams, updatedAt: d.UpdatedAt, updatedBy: d.UpdatedBy };
}

function dimensionsByVariant_(productId) {
  const out = {};
  db_('PRODUCT_DIMENSIONS')
    .filter((d) => (!productId || d.ProductID === productId) && DIM_FIELDS_.some((k) => d[k] !== null && d[k] !== ''))
    .forEach((d) => (out[d.VariantID] = out[d.VariantID] || []).push(dimensionView_(d)));
  return out;
}

/** Status kelengkapan data kemasan satu Child SKU. */
function packagingComplete_(baseUnit, dims) {
  const b = (dims || []).find((d) => d.unit === baseUnit);
  return !!(b && b.lengthCm && b.widthCm && b.heightCm && b.grossWeightGrams);
}

function dimNumber_(raw, max, path, label, err) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!(isFinite(n) && n > 0 && n <= max)) {
    err(path, `${label} harus angka lebih dari 0 (maks. ${max.toLocaleString('id-ID')})`);
    return null;
  }
  return Math.round(n * 100) / 100;
}

/**
 * Validasi input dimensi satu Child SKU. units = satuan yang sah (satuan dasar + kemasan aktif varian ini).
 * input: [{ unit, lengthCm, widthCm, heightCm, weight, weightUnit: 'g'|'kg' }]
 */
function planDimensions_(vp, units, err) {
  const list = vp.iv.dimensions;
  if (!Array.isArray(list)) return null; // tidak dikirim → data tersimpan dipertahankan
  const seen = {};
  return list
    .map((d, j) => {
      const path = `${vp.path}.dimensions.${j}`;
      const unit = normalizeUnit(d && d.unit);
      if (!unit) return null;
      if (seen[unit]) return err(path + '.unit', `Dimensi ${unit} diisi dua kali`), null;
      seen[unit] = 1;
      const wu = String((d && d.weightUnit) || 'g').toLowerCase();
      if (['g', 'kg'].indexOf(wu) < 0) err(path + '.weight', 'Satuan berat harus gram atau kg');
      const row = {
        unit,
        LengthCm: dimNumber_(d.lengthCm, DIM_MAX_CM_, path + '.lengthCm', 'Panjang', err),
        WidthCm: dimNumber_(d.widthCm, DIM_MAX_CM_, path + '.widthCm', 'Lebar', err),
        HeightCm: dimNumber_(d.heightCm, DIM_MAX_CM_, path + '.heightCm', 'Tinggi', err),
        GrossWeightGrams: null,
      };
      const w = dimNumber_(d.weight, wu === 'kg' ? DIM_MAX_GRAMS_ / 1000 : DIM_MAX_GRAMS_, path + '.weight', 'Berat', err);
      if (w !== null) row.GrossWeightGrams = Math.round((wu === 'kg' ? w * 1000 : w) * 100) / 100;
      const filled = DIM_FIELDS_.some((k) => row[k] !== null);
      if (filled && units.indexOf(unit) < 0) err(path + '.unit', `Satuan ${unit} belum didefinisikan untuk Child SKU ini`);
      return row;
    })
    .filter(Boolean);
}

/** Tulis rencana dimensi (upsert per VariantID + satuan). Baris yang dikosongkan dipertahankan dengan nilai kosong. */
function writeDimensions_(user, variant, plan, ts) {
  if (!plan) return false;
  const T = db_('PRODUCT_DIMENSIONS');
  const rows = T.filter((d) => d.VariantID === variant.VariantID);
  let changed = false;
  plan.forEach((p) => {
    const cur = rows.find((d) => d.PackagingUnit === p.unit);
    const vals = {};
    DIM_FIELDS_.forEach((k) => (vals[k] = p[k] === null ? '' : p[k]));
    if (!cur) {
      if (!DIM_FIELDS_.some((k) => vals[k] !== '')) return;
      T.insert(Object.assign({ DimensionID: uuid_(), VariantID: variant.VariantID, ProductID: variant.ProductID, PackagingUnit: p.unit, UpdatedBy: user.email, UpdatedAt: ts }, vals));
      changed = true;
    } else if (DIM_FIELDS_.some((k) => (cur[k] === null ? '' : cur[k]) !== vals[k])) {
      T.update(cur, Object.assign({ UpdatedBy: user.email, UpdatedAt: ts }, vals));
      changed = true;
    }
  });
  return changed;
}
