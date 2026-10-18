/**
 * Aturan inti (fungsi murni, tanpa akses Sheets): GTIN, normalisasi & kemiripan nama, kode otomatis
 * brand/kategori, kombinasi varian, dan konversi satuan.
 */

// ---------------------------------------------------------------- GTIN / barcode
function cleanBarcode(input) {
  if (input === null || input === undefined) return '';
  const s = typeof input === 'number' ? (Number.isInteger(input) ? input.toFixed(0) : String(input)) : String(input);
  return s.trim().replace(/[\s-]/g, '').replace(/^'/, '');
}

function computeCheckDigit(body) {
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10;
}

const SYMBOLOGY_BY_LEN = { 8: 'EAN8', 12: 'UPCA', 13: 'EAN13', 14: 'GTIN14' };

/** Check digit valid ≠ GTIN resmi. Keaslian diverifikasi manual (kemasan fisik / GS1) -> flag verified_official. */
function validateGtin(input) {
  const code = cleanBarcode(input);
  const warnings = [];
  if (!code) return { ok: false, code, errorCode: 'EMPTY', message: 'Barcode wajib diisi', warnings };
  if (!/^\d+$/.test(code)) return { ok: false, code, errorCode: 'NON_NUMERIC', message: 'Barcode hanya boleh angka', warnings };
  const symbology = SYMBOLOGY_BY_LEN[code.length];
  if (!symbology) return { ok: false, code, errorCode: 'BAD_LENGTH', message: `Panjang ${code.length} digit tidak valid (harus 8, 12, 13, atau 14)`, warnings };
  const expected = computeCheckDigit(code.slice(0, -1));
  if (expected !== Number(code[code.length - 1]))
    return { ok: false, code, symbology, errorCode: 'BAD_CHECK_DIGIT', message: `Check digit salah: digit terakhir seharusnya ${expected}`, expectedCheckDigit: expected, warnings };
  if (symbology === 'EAN13') {
    const p3 = Number(code.slice(0, 3));
    if (code.startsWith('99') || (p3 >= 981 && p3 <= 984))
      return { ok: false, code, symbology, errorCode: 'COUPON_PREFIX', message: 'Prefix 98x/99 adalah rentang kupon GS1, bukan GTIN produk', warnings };
    if (code[0] === '2' || code.startsWith('02') || code.startsWith('04'))
      warnings.push('Prefix sirkulasi terbatas (kode internal) — bukan GTIN resmi produsen');
  }
  return { ok: true, code, symbology, warnings };
}

function validateManufacturerGtin(input) {
  const r = validateGtin(input);
  if (r.ok && r.symbology === 'EAN13' && (r.code[0] === '2' || r.code.startsWith('02') || r.code.startsWith('04')))
    return Object.assign({}, r, { ok: false, errorCode: 'RESTRICTED_PREFIX', message: 'Barcode berawalan 2/02/04 adalah kode internal, tidak boleh didaftarkan sebagai GTIN produsen' });
  return r;
}

function buildInternalBarcode(prefix, seq) {
  const s = String(seq);
  const width = 12 - prefix.length;
  if (s.length > width) throw new AppError('Namespace barcode internal sudah penuh');
  const body = prefix + s.padStart(width, '0');
  return body + computeCheckDigit(body);
}

// ---------------------------------------------------------------- Normalisasi & fuzzy
function normalizeCode(c) {
  return String(c === null || c === undefined ? '' : c).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function cleanText(s) {
  return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();
}
const UNIT_ALIASES_ = [
  [/\b(mililiter|milliliter|mls?)\b/g, 'ml'],
  [/\b(liter|litre|ltr|lt)\b/g, 'l'],
  [/\b(grams?|gram|grm|gr|grs|g)\b/g, 'g'],
  [/\b(kilograms?|kgs?)\b/g, 'kg'],
  [/\b(pieces?|pcs?|pc)\b/g, 'pcs'],
];
function normalizeName(name) {
  let s = String(name === null || name === undefined ? '' : name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[’'`]/g, '').replace(/[^a-z0-9+]+/g, ' ').replace(/(\d)([a-z])/g, '$1 $2');
  UNIT_ALIASES_.forEach(([re, rep]) => (s = s.replace(re, rep)));
  s = s.replace(/(\d)\s+(ml|l|g|kg|pcs)\b/g, '$1$2');
  return s.replace(/\s+/g, ' ').trim();
}
function tokenKey(name) {
  return Array.from(new Set(normalizeName(name).split(' ').filter(Boolean))).sort().join(' ');
}
function levenshtein_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function ratio_(a, b) {
  const m = Math.max(a.length, b.length);
  return m ? 1 - levenshtein_(a, b) / m : 1;
}
function extractSizes_(name) {
  return (normalizeName(name).match(/\b\d+(?:[.,]\d+)?(ml|l|g|kg)\b/g) || []).sort().join(',');
}
/** Skor 0..1. Ukuran berbeda (100ml vs 200ml) menurunkan skor. Hanya untuk PERINGATAN, tidak pernah auto-merge. */
function nameSimilarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  let inter = 0;
  ta.forEach((t) => tb.has(t) && inter++);
  const jaccard = inter / (ta.size + tb.size - inter);
  let score = Math.max(jaccard, ratio_(Array.from(ta).sort().join(' '), Array.from(tb).sort().join(' ')), ratio_(na, nb));
  const sa = extractSizes_(a), sb = extractSizes_(b);
  if (sa && sb && sa !== sb) score *= 0.75;
  return Math.round(score * 1000) / 1000;
}

function asciiUpper_(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

// ---------------------------------------------------------------- Master brand / kategori

/** Kunci duplikasi nama: abaikan huruf besar/kecil, spasi, tanda baca, aksen ("Make Over" = "MAKEOVER" = "make-over"). */
function masterNameKey(name) {
  return normalizeName(name).replace(/[^a-z0-9+]/g, '');
}

// ---------------------------------------------------------------- Atribut & kombinasi varian

function cleanAttrName(n) {
  return cleanText(n)
    .toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase())
    .slice(0, 30);
}

/** Identitas kombinasi atribut (urutan & penulisan diabaikan). Dipakai untuk mencegah varian identik ganda. */
function attributeKey(attrs) {
  return (attrs || [])
    .filter((a) => cleanText(a.value))
    .map((a) => normalizeName(a.name) + '=' + normalizeName(a.value))
    .sort()
    .join('|');
}

/** Kombinasi (cartesian) dari [{name, values:[]}] → [[{name, value}, …], …]. */
function variantCombinations(attrs) {
  return (attrs || [])
    .filter((a) => cleanText(a.name) && (a.values || []).some((v) => cleanText(v)))
    .reduce(
      (acc, a) => {
        const vals = a.values.map(cleanText).filter(Boolean);
        const next = [];
        acc.forEach((c) => vals.forEach((v) => next.push(c.concat([{ name: cleanAttrName(a.name), value: v }]))));
        return next;
      },
      [[]],
    )
    .filter((c) => c.length);
}

// ---------------------------------------------------------------- Nama Produk SKU (v5)

const ATTR_UNIT_FORMAT_ = [
  [/^(ml|mls|mililiter|milliliter)$/i, 'ml'],
  [/^(l|lt|ltr|liter|litre)$/i, 'L'],
  [/^(g|gr|grs|grm|gram|grams)$/i, 'g'],
  [/^(kg|kgs|kilogram|kilograms)$/i, 'kg'],
  [/^(mg|miligram|milligram)$/i, 'mg'],
  [/^(oz)$/i, 'oz'],
  [/^(pcs|pc|pieces?)$/i, 'pcs'],
];

/** Format standar nilai atribut: "50ml" / "50 ML" / "50 ml ml" → "50 ml", "1,5L" → "1,5 L". Teks lain hanya dirapikan. */
function formatAttrValue(v) {
  let s = properCase(v); // diketik huruf kecil semua → huruf awal kapital (satuan tetap kecil)
  s = s.replace(/(\d)\s*([a-zA-Z]+)\b/g, (m, d, u) => {
    const hit = ATTR_UNIT_FORMAT_.find((x) => x[0].test(u));
    return hit ? d + ' ' + hit[1] : m;
  });
  // satuan berulang: "50 ml ml" → "50 ml"
  s = s.replace(/\b(ml|L|g|kg|mg|oz|pcs)(\s+\1\b)+/gi, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Huruf awal kapital untuk tiap kata yang diketik huruf kecil: "purbasari pelembab wajah" → "Purbasari Pelembab Wajah".
 * Kata yang sudah mengandung huruf kapital (mis. "BB", "SPF") tidak diubah; satuan (ml, g, kg) & angka tetap.
 */
const PROPER_KEEP_ = /^(ml|g|gr|kg|mg|oz|pcs|x)$/;
const PROPER_SMALL_ = /^(de|du|la|le|et|of|the|and|with|for|dan|di|ke|untuk|dengan)$/;
function properCase(text) {
  const s = cleanText(text);
  if (!s) return s;
  // per kata: kata yang diketik huruf kecil semua → huruf awal kapital; kata yang sudah berhuruf besar (BB, SPF, iPhone) dibiarkan;
  // kata sambung (de, dan, of, …) tetap kecil kecuali di awal
  return s
    .split(' ')
    .map((t, i) => (/[A-Z]/.test(t) || PROPER_KEEP_.test(t) || /^\d/.test(t) || (i > 0 && PROPER_SMALL_.test(t)) ? t : t.replace(/(^|[-/(&+.])([a-z])/g, (m, p, c) => p + c.toUpperCase())))
    .join(' ');
}

/** Urutkan atribut sesuai urutan jenis atribut di Pengaturan (Warna, Shade, Aroma, Ukuran, Volume, …); sisanya di belakang. */
const SIZE_ATTRS_ = ['ukuran', 'berat isi', 'volume', 'isi', 'berat', 'berat bersih', 'netto'];
function orderAttributes(attrs, types) {
  const pos = {};
  (types || []).forEach((t, i) => (pos[normalizeName(t)] = i));
  // jenis variasi lain (Tipe, Motif, …) diletakkan sebelum ukuran/berat/volume: "Water Gloss Hyper Solid 30 g"
  const firstSize = (types || []).findIndex((t) => SIZE_ATTRS_.indexOf(normalizeName(t)) >= 0);
  const other = (firstSize < 0 ? (types || []).length : firstSize) - 0.5;
  return (attrs || [])
    .map((a, i) => ({ a, i, p: pos[normalizeName(a.name)] !== undefined ? pos[normalizeName(a.name)] : SIZE_ATTRS_.indexOf(normalizeName(a.name)) >= 0 ? 1000 + i : other }))
    .sort((x, y) => x.p - y.p || x.i - y.i)
    .map((x) => x.a);
}

/**
 * Nama Produk SKU = NAMA BRAND + NAMA PARENT + NILAI ATRIBUT (urut sesuai Pengaturan).
 * Kata/atribut yang sudah ada tidak diulang (brand di awal nama parent, "50 ml" yang sudah ada di nama, satuan ganda),
 * tanpa spasi ganda. Contoh: Hanasui + Pelembab Wajah + [Red, 50ml] → "Hanasui Pelembab Wajah Red 50 ml".
 */
function buildSkuName(brandName, parentName, attrs, types) {
  const brand = properCase(brandName);
  const parent = formatAttrValue(parentName);
  const parts = [];
  const contains = (txt) => {
    const k = normalizeName(txt);
    return !!k && (' ' + normalizeName(parts.join(' ')) + ' ').indexOf(' ' + k + ' ') >= 0;
  };
  const nb = normalizeName(brand);
  const np = normalizeName(parent);
  if (brand && !(np === nb || np.indexOf(nb + ' ') === 0)) parts.push(brand);
  if (parent && !contains(parent)) parts.push(parent);
  orderAttributes(attrs, types).forEach((a) => {
    const val = formatAttrValue(a && a.value !== undefined ? a.value : a);
    if (val && !contains(val)) parts.push(val);
  });
  return parts
    .join(' ')
    .replace(/\b(\S+)(\s+\1\b)+/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ---------------------------------------------------------------- Satuan & konversi

function normalizeUnit(u) {
  return asciiUpper_(u).replace(/[^A-Z0-9]/g, '');
}

/**
 * Hitung kuantitas ekuivalen dalam satuan dasar. Konversi bertingkat: satuan isi boleh satuan dasar atau
 * satuan kemasan yang didefinisikan SEBELUMNYA (mis. KARTON berisi 6 BOX, BOX berisi 24 BOTOL → KARTON = 144 BOTOL).
 * rows: [{unitName, factor, containsUnit}] → { rows: [...+baseUnitEquivalent], errors: [{index, field, message}] }
 */
function computeConversions(baseUnit, rows) {
  const base = normalizeUnit(baseUnit);
  const eq = {};
  eq[base] = 1;
  const errors = [];
  const seen = {};
  seen[base] = 1;
  const out = (rows || []).map((r, i) => {
    const unit = normalizeUnit(r.unitName);
    const f = Number(r.factor);
    const cu = normalizeUnit(r.containsUnit) || base;
    let e = null;
    if (!/^[A-Z][A-Z0-9]{1,11}$/.test(unit)) errors.push({ index: i, field: 'unitName', message: 'Nama satuan 2–12 huruf/angka, diawali huruf' });
    else if (unit === base) errors.push({ index: i, field: 'unitName', message: unit + ' adalah satuan dasar' });
    else if (seen[unit]) errors.push({ index: i, field: 'unitName', message: 'Satuan ' + unit + ' ganda' });
    if (!(Number.isInteger(f) && f >= 1 && f <= 100000)) errors.push({ index: i, field: 'factor', message: 'Isi harus bilangan bulat lebih dari 0 (1–100.000)' });
    if (eq[cu] === undefined) errors.push({ index: i, field: 'containsUnit', message: 'Satuan isi ' + cu + ' belum didefinisikan di atasnya' });
    else if (Number.isInteger(f) && f >= 1) e = f * eq[cu];
    if (e !== null && e > 10000000) {
      errors.push({ index: i, field: 'factor', message: 'Kuantitas ekuivalen terlalu besar' });
      e = null;
    }
    if (unit && !seen[unit]) {
      seen[unit] = 1;
      if (e !== null) eq[unit] = e;
    }
    return { unitName: unit, factor: f, containsUnit: cu, baseUnitEquivalent: e };
  });
  return { rows: out, errors };
}

// ---------------------------------------------------------------- Error
class AppError extends Error {
  constructor(message, details, code) {
    super(message);
    this.details = details || [];
    this.code = code || 'ERROR';
  }
}
