/**
 * Master nilai atribut (opsional) — warna, shade, aroma, volume, berat, ukuran — agar penulisan seragam
 * ("100ML", "100 ml" → "100 ml"). Generator varian menyarankan nilai dari sini; saat produk disimpan, nilai
 * yang cocok (setelah normalisasi) otomatis memakai ejaan standar.
 */

function attributeValues_(f) {
  f = f || {};
  return db_('ATTRIBUTE_VALUES')
    .filter((a) => a.Status === STATUS.ACTIVE && (!f.name || a.AttributeName === cleanAttrName(f.name)))
    .map((a) => ({ id: a.AttributeValueID, name: a.AttributeName, value: a.Value }))
    .sort((a, b) => a.name.localeCompare(b.name, 'id') || a.value.localeCompare(b.value, 'id', { numeric: true }));
}

function attributeValueSave_(user, input) {
  const name = cleanAttrName(input.name);
  const value = cleanText(input.value).slice(0, 40);
  if (!name || !value) throw new AppError('Jenis atribut & nilai wajib diisi', [], 'VALIDATION_FAILED');
  const key = normalizeName(name) + '=' + normalizeName(value);
  const T = db_('ATTRIBUTE_VALUES');
  const ex = T.find((a) => a.ValueKey === key && a.Status === STATUS.ACTIVE);
  if (ex) throw new AppError(`Nilai "${ex.Value}" sudah ada untuk ${name}`, [], 'DUPLICATE');
  const rec = T.insert({ AttributeValueID: uuid_(), AttributeName: name, Value: value, ValueKey: key, Status: STATUS.ACTIVE, CreatedBy: user.email, CreatedAt: now_() });
  audit_(user.email, 'attribute.create', 'attribute', rec.AttributeValueID, null, { name, value });
  return { id: rec.AttributeValueID, name, value };
}

function attributeValueDelete_(user, input) {
  const rec = db_('ATTRIBUTE_VALUES').byId(input.id);
  if (!rec || rec.Status !== STATUS.ACTIVE) throw new AppError('Nilai tidak ditemukan', [], 'NOT_FOUND');
  db_('ATTRIBUTE_VALUES').update(rec, { Status: STATUS.INACTIVE });
  audit_(user.email, 'attribute.deactivate', 'attribute', rec.AttributeValueID, { name: rec.AttributeName, value: rec.Value }, null);
  return true;
}

/** Ejaan standar dari master atribut (bila ada). */
function standardizeAttributes_(attrs) {
  const map = {};
  db_('ATTRIBUTE_VALUES')
    .filter((a) => a.Status === STATUS.ACTIVE)
    .forEach((a) => (map[a.ValueKey] = a.Value));
  return attrs.map((a) => {
    const std = map[normalizeName(a.name) + '=' + normalizeName(a.value)];
    return std ? { name: a.name, value: std } : a;
  });
}
