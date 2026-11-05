/**
 * Data Emeron (dari "emeron_produk_dengan_foto.xlsx": 35 listing toko — Yoline 21 dengan kode 13 digit, Watsons 14 tanpa
 * barcode — masing-masing dengan foto utama).
 * - Sudah ada di sistem → hanya dipasang fotonya: Hair Vitamin Soft & Smooth / Black Shine, Hijab Hair Vitamin Clean & Fresh.
 * - Belum ada → dibuat lewat jalur import produk biasa. Kode Yoline (13 digit, lolos cek digit, prefix Gondowangi 8998866)
 *   dipakai sebagai GTIN. Produk Watsons tidak punya barcode → SKU dibuat tanpa GTIN ("GTIN belum didata"), tidak dikarang.
 * - Shampoo Soft & Smooth 340 ml dan Hair Fall Control 340 ml ada di kedua toko → satu SKU (GTIN Yoline); foto Watsons
 *   (800 px) jadi foto utama, foto Yoline jadi foto tambahan.
 * - Penanda "(NA)" di nama Yoline dibuang; salah ketik "CHEERY" → Cherry Blossom.
 * Foto dijemput dari GitHub Pages (foto-import/emeron/NN.png = nomor baris di sheet "Foto produk") lalu disimpan ke
 * Google Drive lewat jalur Foto yang sama (riwayat di PRODUCT_PHOTOS). SKU yang sudah punya foto utama tidak ditimpa.
 */
const EMERON_ROWS_ = [
  ['No', 'Brand', 'Nama Produk Induk', 'Kategori', 'Jenis Variasi 1', 'Pilihan Variasi 1', 'Jenis Variasi 2', 'Pilihan Variasi 2', 'GTIN / Barcode', 'Satuan Terkecil', 'Isi per BOX (pcs)'],
  ['2', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Anti Dandruff', 'Volume', '170 ml', '8998866103121', 'PCS', ''],
  ['3', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Black & Shine', 'Volume', '170 ml', '8998866100564', 'PCS', ''],
  ['6', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Soft & Smooth', 'Volume', '170 ml', '8998866100649', 'PCS', ''],
  ['7', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Hair Fall Control', 'Volume', '170 ml', '8998866100601', 'PCS', ''],
  ['15', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Dandruff Control', 'Volume', '340 ml', '8998866106252', 'PCS', ''],
  ['16', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Soft & Smooth', 'Volume', '340 ml', '8998866106245', 'PCS', ''],
  ['18', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Hair Fall Control', 'Volume', '340 ml', '8998866106221', 'PCS', ''],
  ['20', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Black & Shine', 'Volume', '340 ml', '8998866106214', 'PCS', ''],
  ['28', 'Emeron', 'Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Black & Shine', 'Volume', '450 ml', '', 'PCS', ''],
  ['31', 'Emeron', 'Hijab Shampoo', 'Perawatan Rambut > Shampo', 'Tipe', 'Clean & Fresh', 'Volume', '340 ml', '', 'PCS', ''],
  ['1', 'Emeron', 'Conditioner', 'Perawatan Rambut > Kondisioner Rambut dan Kulit Kepala', 'Tipe', 'Soft & Smooth', 'Volume', '170 ml', '8998866106993', 'PCS', ''],
  ['8', 'Emeron', 'Lovely Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Healthy White', 'Volume', '100 ml', '8998866105484', 'PCS', ''],
  ['13', 'Emeron', 'Lovely Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Healthy White', 'Volume', '200 ml', '8998866105637', 'PCS', ''],
  ['17', 'Emeron', 'Lovely Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Healthy White', 'Volume', '500 ml', '8998866105668', 'PCS', ''],
  ['14', 'Emeron', 'Lovely Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Smooth White', 'Volume', '200 ml', '8998866105644', 'PCS', ''],
  ['10', 'Emeron', 'Lovely Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Smooth White', 'Volume', '500 ml', '8998866105675', 'PCS', ''],
  ['12', 'Emeron', 'Lovely Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Silky White', 'Volume', '200 ml', '8998866105651', 'PCS', ''],
  ['11', 'Emeron', 'Lovely Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Silky White', 'Volume', '500 ml', '8998866105682', 'PCS', ''],
  ['4', 'Emeron', 'Lovely Naturals Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Aroma', 'Honey Avocado', 'Volume', '400 ml', '8998866109444', 'PCS', ''],
  ['5', 'Emeron', 'Lovely Naturals Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Aroma', 'Sakura', 'Volume', '400 ml', '8998866109109', 'PCS', ''],
  ['9', 'Emeron', 'Lovely Naturals Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Aroma', 'Green Tea', 'Volume', '400 ml', '8998866109086', 'PCS', ''],
  ['19', 'Emeron', 'Lovely Naturals Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Aroma', 'Pink', 'Volume', '100 ml', '8998866106504', 'PCS', ''],
  ['21', 'Emeron', 'Lovely Naturals Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Aroma', 'Cherry Blossom', 'Volume', '200 ml', '8998866106542', 'PCS', ''],
  ['27', 'Emeron', 'Lovely White UV Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Glowy Bright', 'Volume', '500 ml', '', 'PCS', ''],
  ['34', 'Emeron', 'Lovely White UV Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Radiant Bright', 'Volume', '500 ml', '', 'PCS', ''],
  ['35', 'Emeron', 'Lovely White UV Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Nutrient Bright', 'Volume', '500 ml', '', 'PCS', ''],
  ['23', 'Emeron', 'Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Nourish & Bright Bengkoang', 'Volume', '500 ml', '', 'PCS', ''],
  ['32', 'Emeron', 'Hand & Body Lotion', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Tipe', 'Moisture & Bright White Pearl', 'Volume', '500 ml', '', 'PCS', ''],
  ['25', 'Emeron', 'Naturals Body Serum', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Aroma', 'Apple Orange', 'Volume', '400 ml', '', 'PCS', ''],
  ['33', 'Emeron', 'Naturals Body Serum', 'Perawatan Tubuh > Body Cream, Body Lotion & Body Butter', 'Aroma', 'Banana Strawberry', 'Volume', '400 ml', '', 'PCS', ''],
];

/**
 * Foto per SKU. f = nomor file (foto-import/emeron/NN.png). SKU dicari lewat: gtin, sku (SKU yang sudah ada), atau
 * product + attrs (produk Watsons tanpa barcode). kind EXTRA = foto tambahan.
 */
const EMERON_PHOTOS_ = [
  { f: 22, gtin: '8998866107044' },
  { f: 24, gtin: '8998866107037' },
  { f: 26, gtin: '8998866109291' },
  { f: 1, gtin: '8998866106993' },
  { f: 2, gtin: '8998866103121' },
  { f: 3, gtin: '8998866100564' },
  { f: 4, gtin: '8998866109444' },
  { f: 5, gtin: '8998866109109' },
  { f: 6, gtin: '8998866100649' },
  { f: 7, gtin: '8998866100601' },
  { f: 8, gtin: '8998866105484' },
  { f: 9, gtin: '8998866109086' },
  { f: 10, gtin: '8998866105675' },
  { f: 11, gtin: '8998866105682' },
  { f: 12, gtin: '8998866105651' },
  { f: 13, gtin: '8998866105637' },
  { f: 14, gtin: '8998866105644' },
  { f: 15, gtin: '8998866106252' },
  { f: 29, gtin: '8998866106245' },
  { f: 16, gtin: '8998866106245', kind: 'EXTRA' },
  { f: 17, gtin: '8998866105668' },
  { f: 30, gtin: '8998866106221' },
  { f: 18, gtin: '8998866106221', kind: 'EXTRA' },
  { f: 19, gtin: '8998866106504' },
  { f: 20, gtin: '8998866106214' },
  { f: 21, gtin: '8998866106542' },
  { f: 28, product: 'Shampoo', attrs: ['Black & Shine', '450 ml'] },
  { f: 31, product: 'Hijab Shampoo', attrs: ['Clean & Fresh', '340 ml'] },
  { f: 27, product: 'Lovely White UV Hand & Body Lotion', attrs: ['Glowy Bright', '500 ml'] },
  { f: 34, product: 'Lovely White UV Hand & Body Lotion', attrs: ['Radiant Bright', '500 ml'] },
  { f: 35, product: 'Lovely White UV Hand & Body Lotion', attrs: ['Nutrient Bright', '500 ml'] },
  { f: 23, product: 'Hand & Body Lotion', attrs: ['Nourish & Bright Bengkoang', '500 ml'] },
  { f: 32, product: 'Hand & Body Lotion', attrs: ['Moisture & Bright White Pearl', '500 ml'] },
  { f: 25, product: 'Naturals Body Serum', attrs: ['Apple Orange', '400 ml'] },
  { f: 33, product: 'Naturals Body Serum', attrs: ['Banana Strawberry', '400 ml'] },
];
const EMERON_PHOTO_BASE_ = 'https://admmeirista.github.io/master-produk-sku/foto-import/emeron/';

/**
 * Pasang foto dari daftar (sekali jalan, dipanggil runDataJobs_). Foto disimpan ke Drive lewat photoSave_; bila Drive
 * belum diizinkan, link foto langsung (GitHub Pages) dipakai sebagai foto utama. Mengembalikan ringkasan untuk log.
 */
function importPhotoList_(user, brandName, list, base) {
  const brand = db_('MASTER_BRANDS').find((b) => b.Status !== STATUS.DELETED && masterNameKey(b.BrandName) === masterNameKey(brandName));
  const prods = brand ? db_('MASTER_PRODUCTS').filter((p) => p.BrandID === brand.BrandID && p.Status !== STATUS.DELETED) : [];
  const pids = {};
  prods.forEach((p) => (pids[p.ProductID] = p));
  const live = (v) => v.Status !== STATUS.DELETED && pids[v.ProductID];
  const V = db_('PRODUCT_VARIANTS');
  const vals = (v) => {
    try {
      const at = typeof v.VariantAttributes === 'string' ? JSON.parse(v.VariantAttributes || '[]') : v.VariantAttributes || [];
      return at.map((a) => String(a.value).toLowerCase());
    } catch (e) {
      return [];
    }
  };
  const out = { saved: 0, linked: 0, skipped: 0, missing: [] };
  list.forEach((it) => {
    const v = V.rows().find((v) => {
      if (!live(v)) return false;
      if (it.sku) return v.SKU === it.sku;
      if (it.gtin) return v.GTIN === it.gtin;
      const want = it.attrs.map((a) => a.toLowerCase());
      const have = vals(v);
      return pids[v.ProductID].ProductName === it.product && want.length === have.length && want.every((a, i) => a === have[i]);
    });
    if (!v) return out.missing.push(it.f);
    const kind = it.kind === 'EXTRA' ? 'EXTRA' : 'MAIN';
    if (kind === 'MAIN' && v.ImageUrl) return out.skipped++; // foto yang sudah ada tidak ditimpa
    const url = base + ('0' + it.f).slice(-2) + '.png';
    let bytes = null;
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() === 200) bytes = res.getContent();
    } catch (e) {
      bytes = null;
    }
    if (!bytes) return out.missing.push(it.f);
    try {
      photoSave_(user, { variantId: v.VariantID, dataUrl: 'data:image/png;base64,' + Utilities.base64Encode(bytes), kind, expectFileId: v.ImageFileId || '' });
      out.saved++;
    } catch (e) {
      if (kind !== 'MAIN') return out.skipped++;
      // Drive belum diizinkan → link langsung
      const ts = now_();
      V.update(v, { ImageUrl: url, ImageFileId: '', PhotoStatus: 'APPROVED', PhotoNote: '', PhotoBy: user.email, PhotoAt: ts, UpdatedAt: ts });
      db_('PRODUCT_PHOTOS').insert({ PhotoID: uuid_(), VariantID: v.VariantID, ProductID: v.ProductID, Kind: 'MAIN', FileId: '', Url: url, Status: 'APPROVED', Note: 'Link foto dari file import', UploadedBy: user.email, UploadedAt: ts, ReviewedBy: '', ReviewedAt: '', ReplacedAt: '' });
      audit_(user.email, 'photo.save', 'variant', v.VariantID, null, { ImageUrl: url, sku: v.SKU });
      out.linked++;
    }
  });
  return out;
}
