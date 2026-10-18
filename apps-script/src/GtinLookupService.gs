/**
 * GTIN Product Lookup & Smart Auto-Fill.
 *   1. Validasi format & check digit GTIN (check digit valid ≠ GTIN resmi terdaftar).
 *   2. Cari dulu di database internal (mencegah registrasi ganda).
 *   3. Bila belum ada: cari ke penyedia eksternal resmi & terdokumentasi (Open Beauty Facts — API publik, data ODbL),
 *      lewat abstraksi penyedia agar Verified by GS1 / API komersial bisa ditambahkan di GTIN_PROVIDER_IMPL.
 *   4. Normalisasi ke Master Brand, Master Kategori, atribut (Volume/Berat) & cari Parent yang mirip.
 *   5. Hasil hanya USULAN auto-fill — user memeriksa & mengedit; tidak ada produk/GTIN yang dibuat otomatis.
 * Cache: GTIN_LOOKUP_CACHE (ditemukan 30 hari, tidak ditemukan 7 hari, error 1 jam). Batas laju: 20 panggilan/menit.
 * Tidak ada scraping marketplace.
 */

const GTIN_CACHE_DAYS_ = { FOUND: 30, NOT_FOUND: 7, ERROR: 1 / 24 };
const GTIN_RATE_PER_MIN_ = 20;

const GTIN_PROVIDER_IMPL = {
  openbeautyfacts: {
    label: 'Open Beauty Facts',
    license: 'Open Database License (ODbL) — openbeautyfacts.org',
    productUrl: (gtin) => 'https://world.openbeautyfacts.org/product/' + gtin,
    fetch(gtin) {
      const url = 'https://world.openbeautyfacts.org/api/v2/product/' + encodeURIComponent(gtin) + '.json?fields=code,product_name,product_name_id,product_name_en,generic_name,brands,categories_tags,quantity,image_front_url';
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': GTIN_LOOKUP_CONTACT, Accept: 'application/json' } });
      const code = res.getResponseCode();
      if (code === 404) return { status: 'NOT_FOUND', message: 'Produk tidak ditemukan di Open Beauty Facts' };
      if (code === 429) return { status: 'ERROR', message: 'Open Beauty Facts membatasi permintaan (429) — coba lagi nanti', transient: true };
      if (code < 200 || code >= 300) return { status: 'ERROR', message: 'Open Beauty Facts HTTP ' + code, transient: true };
      let json;
      try {
        json = JSON.parse(res.getContentText());
      } catch (e) {
        return { status: 'ERROR', message: 'Respon Open Beauty Facts tidak valid', transient: true };
      }
      if (json.status !== 1 || !json.product) return { status: 'NOT_FOUND', message: 'Produk tidak ditemukan di Open Beauty Facts' };
      const pr = json.product;
      return {
        status: 'FOUND',
        result: {
          name: cleanText(pr.product_name_id || pr.product_name || pr.product_name_en || pr.generic_name),
          brand: cleanText(String(pr.brands || '').split(',')[0]),
          categories: (pr.categories_tags || []).map((t) => String(t).replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')).filter((t) => ['non food products', 'open beauty facts', 'beauty'].indexOf(t) < 0),
          quantity: cleanText(pr.quantity),
          imageUrl: /^https:\/\//.test(pr.image_front_url || '') ? pr.image_front_url : '',
        },
      };
    },
  },
};

function gtinCacheGet_(gtin, provider) {
  const row = db_('GTIN_LOOKUP_CACHE').find((r) => r.GTIN === gtin && r.Provider === provider);
  if (!row || !row.ExpiresAt || new Date(row.ExpiresAt) < new Date()) return null;
  return { status: row.Status, result: row.ResultJson, message: row.Message, fetchedAt: row.FetchedAt, cached: true };
}

function gtinCachePut_(gtin, provider, r) {
  withLock_(() => {
    const T = db_('GTIN_LOOKUP_CACHE');
    const exp = new Date(Date.now() + (GTIN_CACHE_DAYS_[r.status] || 1) * 86400000).toISOString();
    const fields = { Status: r.status, FetchedAt: r.fetchedAt, ExpiresAt: exp, ResultJson: r.result || null, Message: r.message || '' };
    const row = T.find((x) => x.GTIN === gtin && x.Provider === provider);
    if (row) T.update(row, fields);
    else T.insert(Object.assign({ GTIN: gtin, Provider: provider }, fields));
  });
}

/** Batas laju sederhana per menit (CacheService). Mengembalikan false bila kuota menit ini habis. */
function gtinRateOk_() {
  const c = CacheService.getScriptCache();
  const key = 'gtin_rl:' + Math.floor(Date.now() / 60000);
  const n = Number(c.get(key) || 0);
  if (n >= GTIN_RATE_PER_MIN_) return false;
  c.put(key, String(n + 1), 120);
  return true;
}

function externalGtinLookup_(gtin, force) {
  for (const id of GTIN_PROVIDERS) {
    const impl = GTIN_PROVIDER_IMPL[id];
    if (!impl) continue;
    const cached = force ? null : gtinCacheGet_(gtin, id);
    if (cached) return Object.assign({ provider: id, providerLabel: impl.label, license: impl.license, url: impl.productUrl(gtin) }, cached);
    if (!gtinRateOk_()) return { provider: id, providerLabel: impl.label, status: 'RATE_LIMITED', message: 'Terlalu banyak pencarian dalam satu menit — coba lagi sebentar lagi, atau isi manual.' };
    let r;
    try {
      r = impl.fetch(gtin);
    } catch (e) {
      r = { status: 'ERROR', message: 'Gagal menghubungi ' + impl.label + ': ' + (e && e.message ? e.message : e), transient: true };
    }
    r.fetchedAt = now_();
    try {
      gtinCachePut_(gtin, id, r);
    } catch (e) {
      console.error('Cache GTIN gagal: ' + e);
    }
    const out = Object.assign({ provider: id, providerLabel: impl.label, license: impl.license, url: impl.productUrl(gtin), cached: false }, r);
    if (r.status === 'FOUND' || !r.transient) return out;
    if (id === GTIN_PROVIDERS[GTIN_PROVIDERS.length - 1]) return out;
  }
  return { status: 'NOT_FOUND', message: 'Tidak ada penyedia GTIN yang aktif' };
}

/** Cocokkan hasil eksternal ke master internal → usulan auto-fill (tidak menyimpan apa pun). */
function gtinSuggestion_(gtin, ext) {
  const r = ext.result || {};
  const brands = db_('MASTER_BRANDS').filter((b) => b.Status === STATUS.ACTIVE);
  const cats = db_('MASTER_CATEGORIES').filter((c) => c.Status === STATUS.ACTIVE && (!catIsShopee_(c) || catIsLeaf_(c)));
  // brand: dari field brand; bila kosong, coba awal nama produk ("Wardah nature daily …")
  let brand = null;
  const tryBrand = (txt) => {
    const key = masterNameKey(txt);
    if (!key) return null;
    return brands.find((b) => b.NameKey === key) || brands.find((b) => nameSimilarity(txt, b.BrandName) >= 0.9) || null;
  };
  brand = tryBrand(r.brand);
  if (!brand && r.name) {
    const words = r.name.split(/\s+/);
    brand = tryBrand(words.slice(0, 2).join(' ')) || tryBrand(words[0]);
  }
  let category = null;
  let best = 0;
  (r.categories || []).forEach((t) => {
    cats.forEach((c) => {
      const sc = masterNameKey(t) === c.NameKey ? 1 : nameSimilarity(t, c.CategoryName);
      if (sc > best && sc >= 0.75) {
        best = sc;
        category = c;
      }
    });
  });
  // ukuran: dari quantity atau nama ("100 ml", "75g")
  const attrs = [];
  const m = /(\d+(?:[.,]\d+)?)\s*(ml|mL|ML|l|L|g|gr|gram|kg|oz)\b/.exec(r.quantity + ' ' + r.name);
  if (m) {
    const unit = m[2].toLowerCase().replace(/^gr$|^gram$/, 'g');
    attrs.push({ name: /^(ml|l)$/.test(unit) ? 'Volume' : 'Berat', value: m[1].replace(',', '.') + ' ' + (unit === 'l' ? 'L' : unit) });
  }
  const name = r.name ? r.name.charAt(0).toUpperCase() + r.name.slice(1) : '';
  return {
    name,
    brand: brand ? { id: brand.BrandID, name: brand.BrandName } : null,
    brandText: r.brand || '',
    category: category ? { id: category.CategoryID, name: category.CategoryName } : null,
    categoryText: (r.categories || []).slice(0, 3).join(', '),
    attributes: standardizeAttributes_(attrs),
    imageUrl: r.imageUrl || '',
    sizeText: r.quantity || (m ? m[0] : ''),
    similarParents: name ? similarProducts_(name, brand ? brand.BrandID : null, null) : [],
    dataSource: ext.provider + ':' + gtin + ' @' + (ext.fetchedAt || now_()).slice(0, 10),
  };
}

/** Endpoint: Scan GTIN → (internal) → (eksternal + cache) → usulan auto-fill. */
function gtinLookup_(user, p) {
  const code = cleanBarcode(p.gtin);
  const internal = barcodeLookup_(code);
  if (internal.found) return { gtin: code, stage: 'internal', internal };
  const v = validateManufacturerGtin(code);
  if (!v.ok) return { gtin: code, stage: 'invalid', valid: false, message: v.message, internal };
  if (!getSettings_().gtin_lookup_enabled) return { gtin: v.code, stage: 'manual', valid: true, external: { status: 'DISABLED', message: 'Pencarian eksternal dimatikan di Pengaturan' } };
  const ext = externalGtinLookup_(v.code, !!p.force);
  const out = { gtin: v.code, stage: ext.status === 'FOUND' ? 'external' : 'manual', valid: true, symbology: v.symbology, external: { provider: ext.provider, providerLabel: ext.providerLabel, license: ext.license, url: ext.url, status: ext.status, message: ext.message || '', fetchedAt: ext.fetchedAt, cached: !!ext.cached } };
  if (ext.status === 'FOUND') out.suggestion = gtinSuggestion_(v.code, ext);
  return out;
}

function gtinCacheList_() {
  return db_('GTIN_LOOKUP_CACHE')
    .rows()
    .slice()
    .reverse()
    .slice(0, 100)
    .map((r) => ({ gtin: r.GTIN, provider: r.Provider, status: r.Status, fetchedAt: r.FetchedAt, expiresAt: r.ExpiresAt, name: (r.ResultJson || {}).name || '', message: r.Message }));
}
