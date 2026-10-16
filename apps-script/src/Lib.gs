/**
 * Aturan inti (port dari packages/shared): GTIN, normalisasi nama & fuzzy, SKU, signature varian.
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
function attributeSignature(attrs) {
  return (attrs || [])
    .filter((a) => cleanText(a.value))
    .map((a) => `${normalizeCode(a.type).toLowerCase()}=${normalizeName(a.value)}`)
    .sort()
    .join('|');
}

// ---------------------------------------------------------------- SKU
function buildSku(template, p) {
  const map = {
    BRAND: (p.brand || '').toUpperCase(),
    CATEGORY: (p.category || '').toUpperCase(),
    PRODUCT: (p.product || '').toUpperCase(),
    VARIANT: (p.variant || '').toUpperCase(),
    BARCODE: p.barcode || '',
    QTY: p.qty ? String(p.qty) : '',
  };
  const missing = [];
  const sku = template
    .replace(/\{([A-Z]+)\}/g, (_, t) => {
      if (map[t] === undefined) {
        missing.push(`{${t}}`);
        return '';
      }
      if (!map[t] && t !== 'VARIANT') missing.push(t);
      return map[t];
    })
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  const errors = [];
  if (sku.length > 64) errors.push('SKU terlalu panjang (> 64 karakter)');
  if (sku && !/^[A-Z0-9][A-Z0-9\-_.\/]*$/.test(sku)) errors.push('SKU hanya boleh huruf besar, angka, - _ . /');
  return { ok: !missing.length && !errors.length, sku, missing, errors };
}
function validateSkuTemplate(t) {
  const errs = [];
  const tokens = (t.match(/\{([A-Z]+)\}/g) || []).map((x) => x.slice(1, -1));
  tokens.forEach((x) => ['BRAND', 'CATEGORY', 'PRODUCT', 'VARIANT', 'BARCODE', 'QTY'].indexOf(x) < 0 && errs.push(`Token {${x}} tidak dikenal`));
  ['BRAND', 'PRODUCT', 'QTY'].forEach((x) => tokens.indexOf(x) < 0 && errs.push(`Template wajib memuat {${x}}`));
  if (/[^A-Z0-9{}\-_.\/]/.test(t)) errs.push('Template hanya boleh token dan pemisah - _ . /');
  return errs;
}
function packDisplayName(base, qty, unit) {
  return qty > 1 ? `${base} - ${qty} ${unit || 'PCS'}` : base;
}

// ---------------------------------------------------------------- Error
class AppError extends Error {
  constructor(message, details, code) {
    super(message);
    this.details = details || [];
    this.code = code || 'ERROR';
  }
}
