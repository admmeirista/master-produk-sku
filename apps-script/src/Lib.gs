/**
 * Aturan inti (fungsi murni, tanpa akses Sheets): GTIN, normalisasi & kemiripan nama, kode otomatis
 * brand/kategori/produk/varian, SKU, kombinasi varian, dan konversi satuan.
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

// ---------------------------------------------------------------- Kode produk & varian

/** Rekomendasi kode produk: inisial kata + angka ukuran. "Parfum Eau de Parfum" → PEDP, "Air Mawar 100ml" → AM100. */
function suggestProductCode(name) {
  const words = asciiUpper_(name).split(/[^A-Z0-9]+/).filter(Boolean);
  const nums = words.map((w) => (w.match(/^\d+/) || [''])[0]).filter(Boolean);
  const text = words.filter((w) => !/^\d/.test(w));
  let code = text.length >= 2 ? text.slice(0, 4).map((w) => w[0]).join('') : (text[0] || '').slice(0, 4);
  if (code.length < 2) code = (text.join('') + 'PRD').slice(0, 3);
  return (code + nums.join('').slice(0, 5)).slice(0, 12);
}

const UNIT_WORDS_ = { ML: 1, L: 1, LT: 1, LTR: 1, G: 1, GR: 1, GRAM: 1, KG: 1, MG: 1, OZ: 1, CC: 1, PCS: 1, PC: 1 };

/** "Ocean Blue" → OB, "Rose" → RO, "50 ml" → 50, "Shade 01" → S01, "1,5 L" → 15. */
function attrValueCode_(v) {
  const up = asciiUpper_(v);
  const num = up.match(/\d+(?:[.,]\d+)?/g);
  if (num) {
    const lead = up
      .replace(/\d+(?:[.,]\d+)?[A-Z]*/g, ' ')
      .split(/[^A-Z]+/)
      .filter((w) => w && !UNIT_WORDS_[w])
      .slice(0, 2)
      .map((w) => w[0])
      .join('');
    return lead + num.join('').replace(/[.,]/g, '');
  }
  const words = up.split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 2);
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('');
}

/** Kode varian dari nilai atribut: [Ocean Blue, 50 ml] → OB50. */
function suggestVariantCode(attrs) {
  return (attrs || [])
    .map((a) => attrValueCode_(a.value))
    .join('')
    .slice(0, 12);
}

/** Jadikan kode unik di dalam satu produk: OB50, OB502, OB503 … */
function uniquifyCode(code, isUsed) {
  if (!isUsed(code)) return code;
  for (let i = 2; i < 1000; i++) {
    const c = code.slice(0, 12 - String(i).length) + i;
    if (!isUsed(c)) return c;
  }
  throw new AppError('Tidak menemukan kode varian unik untuk ' + code);
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

// ---------------------------------------------------------------- SKU

const SKU_TOKENS = ['BRAND', 'CATEGORY', 'PRODUCT', 'VARIANT'];

/** SKU varian dari identitas varian (bukan hanya product family). Token kosong & pemisah ganda dibuang. */
function buildSku(template, p) {
  const map = { BRAND: normalizeCode(p.brand), CATEGORY: normalizeCode(p.category), PRODUCT: normalizeCode(p.product), VARIANT: normalizeCode(p.variant) };
  const missing = [];
  const sku = String(template || DEFAULT_SETTINGS.sku_template)
    .replace(/\{([A-Z]+)\}/g, (_, t) => {
      if (map[t] === undefined) {
        missing.push('{' + t + '}');
        return '';
      }
      if (!map[t] && t !== 'VARIANT') missing.push(t);
      return map[t];
    })
    .replace(/([-_.\/])[-_.\/]+/g, '$1')
    .replace(/^[-_.\/]+|[-_.\/]+$/g, '');
  const errors = [];
  if (sku.length > 64) errors.push('SKU terlalu panjang (> 64 karakter)');
  if (sku && !/^[A-Z0-9][A-Z0-9\-_.\/]*$/.test(sku)) errors.push('SKU hanya boleh huruf besar, angka, - _ . /');
  return { ok: !missing.length && !errors.length, sku, missing, errors };
}

function validateSkuTemplate(t) {
  const errs = [];
  const tokens = (String(t).match(/\{([A-Z]+)\}/g) || []).map((x) => x.slice(1, -1));
  tokens.forEach((x) => SKU_TOKENS.indexOf(x) < 0 && errs.push('Token {' + x + '} tidak dikenal'));
  ['BRAND', 'PRODUCT', 'VARIANT'].forEach((x) => tokens.indexOf(x) < 0 && errs.push('Template wajib memuat {' + x + '}'));
  if (/[^A-Z0-9{}\-_.\/]/.test(t)) errs.push('Template hanya boleh token dan pemisah - _ . /');
  return errs;
}

/** SKU kemasan yang menjadi trade item sendiri: SKU varian + satuan + isi dasar. VIV-PAR-PEDP-OB50-BOX24 */
function packSku(variantSku, unit, baseEquivalent) {
  return variantSku + '-' + normalizeCode(unit) + baseEquivalent;
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
    if (!(Number.isInteger(f) && f >= 2 && f <= 100000)) errors.push({ index: i, field: 'factor', message: 'Isi harus bilangan bulat 2–100.000' });
    if (eq[cu] === undefined) errors.push({ index: i, field: 'containsUnit', message: 'Satuan isi ' + cu + ' belum didefinisikan di atasnya' });
    else if (Number.isInteger(f) && f >= 2) e = f * eq[cu];
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
