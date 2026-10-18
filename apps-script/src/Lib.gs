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

// ---------------------------------------------------------------- Kode master brand / kategori

/** Kunci duplikasi nama: abaikan huruf besar/kecil, spasi, tanda baca, aksen ("Make Over" = "MAKEOVER" = "make-over"). */
function masterNameKey(name) {
  return normalizeName(name).replace(/[^a-z0-9+]/g, '');
}

/** Daftar kandidat kode (urutan prioritas). Default 3 huruf kapital dari nama: Viva→VIV, Body Lotion→BOD. */
function masterCodeCandidates(name, len) {
  len = Math.min(Math.max(Number(len) || 3, 2), 6);
  const up = asciiUpper_(name);
  const words = up.split(/[^A-Z0-9]+/).filter(Boolean);
  const letters = up.replace(/[^A-Z]/g, '');
  let src = letters.length >= len ? letters : up.replace(/[^A-Z0-9]/g, '');
  while (src.length < len) src += 'X';
  const out = [];
  const seen = {};
  const add = (c) => {
    if (c && c.length === len && /^[A-Z0-9]+$/.test(c) && !seen[c] && out.length < 3000) {
      seen[c] = 1;
      out.push(c);
    }
  };
  add(src.slice(0, len));
  const wl = words.map((w) => w.replace(/[^A-Z]/g, '')).filter(Boolean);
  if (wl.length >= len) add(wl.slice(0, len).map((w) => w[0]).join(''));
  else if (wl.length >= 2) {
    add(wl[0][0] + wl[1].slice(0, len - 1));
    add(wl[0].slice(0, len - 1) + wl[1][0]);
  }
  // huruf pertama tetap, sisanya kombinasi huruf berikutnya sesuai urutan: VIVELLE → VIE, VIL, …
  const pick = (start, need, acc) => {
    if (out.length >= 3000) return;
    if (!need) return add(src[0] + acc);
    for (let i = start; i < src.length; i++) pick(i + 1, need - 1, acc + src[i]);
  };
  pick(1, len - 1, '');
  for (let d = 1; d <= 9; d++) add(src.slice(0, len - 1) + d);
  const width = len - 1;
  for (let n = 1; n < Math.pow(10, width); n++) add(src[0] + String(n).padStart(width, '0'));
  return out;
}

/** Kode unik pertama yang belum dipakai. isUsed(code) → boolean. */
function generateMasterCode(name, isUsed, len) {
  const list = masterCodeCandidates(name, len);
  for (let i = 0; i < list.length; i++) if (!isUsed(list[i])) return list[i];
  throw new AppError('Tidak menemukan kode unik untuk "' + name + '". Perbesar panjang kode di Pengaturan.');
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
  let s = cleanText(v);
  s = s.replace(/(\d)\s*([a-zA-Z]+)\b/g, (m, d, u) => {
    const hit = ATTR_UNIT_FORMAT_.find((x) => x[0].test(u));
    return hit ? d + ' ' + hit[1] : m;
  });
  // satuan berulang: "50 ml ml" → "50 ml"
  s = s.replace(/\b(ml|L|g|kg|mg|oz|pcs)(\s+\1\b)+/gi, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** Urutkan atribut sesuai urutan jenis atribut di Pengaturan (Warna, Shade, Aroma, Ukuran, Volume, …); sisanya di belakang. */
function orderAttributes(attrs, types) {
  const pos = {};
  (types || []).forEach((t, i) => (pos[normalizeName(t)] = i));
  return (attrs || [])
    .map((a, i) => ({ a, i, p: pos[normalizeName(a.name)] === undefined ? 1000 + i : pos[normalizeName(a.name)] }))
    .sort((x, y) => x.p - y.p || x.i - y.i)
    .map((x) => x.a);
}

/**
 * Nama Produk SKU = NAMA BRAND + NAMA PARENT + NILAI ATRIBUT (urut sesuai Pengaturan).
 * Kata/atribut yang sudah ada tidak diulang (brand di awal nama parent, "50 ml" yang sudah ada di nama, satuan ganda),
 * tanpa spasi ganda. Contoh: Hanasui + Pelembab Wajah + [Red, 50ml] → "Hanasui Pelembab Wajah Red 50 ml".
 */
function buildSkuName(brandName, parentName, attrs, types) {
  const brand = cleanText(brandName);
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

const PARENT_CODE_STOPWORDS_ = { DAN: 1, AND: 1, WITH: 1, UNTUK: 1, FOR: 1, THE: 1, OF: 1, DENGAN: 1, DI: 1, KE: 1, YANG: 1, ISI: 1, NEW: 1 };

/**
 * Usulan Kode Produk Parent dari nama: huruf awal tiap kata (tanpa kata brand & kata sambung, maks. 3 huruf)
 * + angka ukuran bila ada di nama. Contoh: "Johnny Andrean Styling Cream Natural & Moisture" → SCN,
 * "Gatsby Pomade Supreme Grease 30 g" → PSG30, "Air Mawar 100 ml" → AM100. Hanya usulan — user boleh mengubah.
 */
function suggestParentCode(name, brandName) {
  const up = asciiUpper_(formatAttrValue(name));
  let words = up.split(/[^A-Z0-9,.]+/).filter(Boolean);
  const bw = asciiUpper_(brandName).split(/[^A-Z0-9]+/).filter(Boolean);
  if (bw.length && bw.every((w, i) => words[i] === w)) words = words.slice(bw.length);
  let size = '';
  const sized = [];
  words.forEach((w, i) => {
    const unit = words[i + 1] || '';
    if (/^\d+([.,]\d+)?$/.test(w) && /^(ML|L|G|KG|MG|OZ|PCS|GR|GRAM|LITER)$/.test(unit)) {
      if (!size) size = w.replace(/[.,]/g, '');
      sized.push(i, i + 1);
    } else if (/^\d+([.,]\d+)?(ML|L|G|KG|MG|OZ|GR)$/.test(w)) {
      if (!size) size = w.replace(/[^0-9]/g, '');
      sized.push(i);
    }
  });
  const letters = words.filter((w, i) => sized.indexOf(i) < 0 && /[A-Z]/.test(w) && !PARENT_CODE_STOPWORDS_[w.replace(/[^A-Z]/g, '')]).map((w) => w.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  let code = letters.map((w) => w[0]).join('').slice(0, 3);
  if (code.length < 2 && letters.length) code = letters[0].replace(/[^A-Z]/g, '').slice(0, 3);
  if (!code) code = 'PRD';
  return (code + size).slice(0, 10);
}

/** Validasi Kode Produk Parent: 2–10 huruf/angka, minimal satu huruf (bukan hanya angka). */
function cleanParentCode(code) {
  return normalizeCode(code).slice(0, 10);
}
function parentCodeError(code) {
  if (!code) return 'Kode produk parent wajib diisi';
  if (code.length < 2) return 'Kode produk parent minimal 2 karakter';
  if (!/[A-Z]/.test(code)) return 'Kode produk parent harus mengandung huruf (tidak boleh hanya angka)';
  return '';
}

/** Parent SKU = KODE BRAND-KODE KATEGORI-KODE PRODUK PARENT (data lama: nomor 0001 tetap berlaku). */
function buildParentSku(brandCode, categoryCode, parentCode) {
  const pc = typeof parentCode === 'number' ? String(parentCode).padStart(PARENT_CODE_DIGITS, '0') : cleanParentCode(parentCode);
  return [normalizeCode(brandCode), normalizeCode(categoryCode), pc].join('-');
}

/** Child SKU = Parent SKU + "-" + barcode (GTIN atau barcode internal). */
function buildChildSku(parentSku, barcode) {
  return String(parentSku || '') + '-' + cleanBarcode(barcode);
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
