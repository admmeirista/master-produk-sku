/**
 * Entry point Web App + dispatcher API.
 * Browser memanggil: google.script.run.api(token, action, payload) → { ok, data } | { ok:false, error }.
 * Hak akses (RBAC) dicek DI SERVER untuk setiap aksi; validasi data juga selalu di server.
 */

/** Ikon aplikasi di-hosting di GitHub Pages (apps-script/pages). */
const PAGES_BASE_ = 'https://admmeirista.github.io/master-produk-sku/';

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_NAME)
    .setFaviconUrl(PAGES_BASE_ + 'favicon.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * API JSON untuk frontend di luar Apps Script (mis. GitHub Pages).
 * Body (text/plain agar tidak memicu CORS preflight): {"token": "...", "action": "...", "payload": {...}}
 */
function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = api(body.token || null, String(body.action || ''), body.payload === undefined ? null : body.payload);
  } catch (err) {
    out = { ok: false, error: { message: 'Permintaan tidak valid', code: 'BAD_REQUEST', details: [] } };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** perm: hak minimal; write: dijalankan di dalam lock + staging + jurnal (atomik). */
const ROUTES = {
  'dashboard.get': { perm: 'product.read', fn: () => dashboard_() },

  'brand.list': { perm: 'product.read', fn: (u, p) => brandList_(p) },
  'brand.preview': { perm: 'product.read', fn: (u, p) => brandPreview_(p.name) },
  'brand.create': { perm: 'master.write', write: true, fn: (u, p) => brandCreate_(u, p) },
  'brand.createMany': { perm: 'master.write', write: true, fn: (u, p) => brandCreateMany_(u, p) },
  'brand.rename': { perm: 'master.write', write: true, fn: (u, p) => brandRename_(u, p) },
  'brand.setStatus': { perm: 'master.write', write: true, fn: (u, p) => brandSetStatus_(u, p) },
  'brand.delete': { perm: 'master.write', write: true, fn: (u, p) => brandDelete_(u, p) },
  'brand.deleteMany': { perm: 'master.write', write: true, fn: (u, p) => masterDeleteMany_(u, 'brand', p.ids) },
  'brand.importPreview': { perm: 'master.write', fn: (u, p) => masterImport_(u, 'brand', p, { dryRun: true }) },
  'brand.import': { perm: 'master.write', write: true, fn: (u, p) => masterImport_(u, 'brand', p) },

  'category.list': { perm: 'product.read', fn: (u, p) => categoryList_(p) },
  'category.preview': { perm: 'product.read', fn: (u, p) => categoryPreview_(p.name) },
  'category.create': { perm: 'master.write', write: true, fn: (u, p) => categoryCreate_(u, p) },
  'category.createMany': { perm: 'master.write', write: true, fn: (u, p) => categoryCreateMany_(u, p) },
  'category.rename': { perm: 'master.write', write: true, fn: (u, p) => categoryRename_(u, p) },
  'category.setStatus': { perm: 'master.write', write: true, fn: (u, p) => categorySetStatus_(u, p) },
  'category.delete': { perm: 'master.write', write: true, fn: (u, p) => categoryDelete_(u, p) },
  'category.deleteMany': { perm: 'master.write', write: true, fn: (u, p) => masterDeleteMany_(u, 'category', p.ids) },
  'category.importPreview': { perm: 'master.write', fn: (u, p) => masterImport_(u, 'category', p, { dryRun: true }) },
  'category.import': { perm: 'master.write', write: true, fn: (u, p) => masterImport_(u, 'category', p) },

  'product.list': { perm: 'product.read', fn: (u, p) => productList_(p) },
  'product.search': { perm: 'product.read', fn: (u, p) => productSearch_(p.q) },
  'product.get': { perm: 'product.read', fn: (u, p) => productDetail_(p.id) },
  'product.check': { perm: 'product.read', fn: (u, p) => productCheck_(p) },
  'product.parentPreview': { perm: 'product.read', fn: (u, p) => parentPreview_(p) },
  'photo.upload': { perm: 'product.write', write: true, fn: (u, p) => photoUpload_(u, p) },
  'product.validate': { perm: 'product.write', fn: (u, p) => productSave_(u, p.input, { dryRun: true }) },
  'product.save': { perm: 'product.write', write: true, fn: (u, p) => productSave_(u, p.input) },
  'product.setStatus': { perm: 'product.write', write: true, fn: (u, p) => productSetStatus_(u, p) },
  'product.delete': { perm: 'product.write', write: true, fn: (u, p) => productDelete_(u, p) },
  'product.audit': { perm: 'product.read', fn: (u, p) => productAudit_(p.id) },
  'product.lifecycle': { perm: 'product.read', fn: (u, p) => lifecycleHistory_(p.id) },
  'variant.deprecate': { perm: 'product.write', write: true, fn: (u, p) => variantDeprecate_(u, p) },
  'gtin.lookup': { perm: 'product.write', fn: (u, p) => gtinLookup_(u, p) },
  'gtin.cache': { perm: 'product.read', fn: () => gtinCacheList_() },

  'supplier.list': { perm: 'product.read', fn: (u, p) => supplierList_(p) },
  'supplier.save': { perm: 'master.write', write: true, fn: (u, p) => supplierSave_(u, p) },
  'supplier.setStatus': { perm: 'master.write', write: true, fn: (u, p) => supplierSetStatus_(u, p) },
  'supplierMap.list': { perm: 'product.read', fn: (u, p) => supplierMapList_(p) },
  'supplierMap.lookup': { perm: 'product.read', fn: (u, p) => supplierCodeLookup_(p.code) },
  'supplierMap.save': { perm: 'mapping.write', write: true, fn: (u, p) => supplierMapSave_(u, p) },
  'supplierMap.setStatus': { perm: 'mapping.write', write: true, fn: (u, p) => supplierMapSetStatus_(u, p) },

  'bundle.list': { perm: 'product.read', fn: (u, p) => bundleList_(p) },
  'bundle.get': { perm: 'product.read', fn: (u, p) => bundleGet_(p.id) },
  'bundle.validate': { perm: 'product.write', fn: (u, p) => bundleSave_(u, p, { dryRun: true }) },
  'bundle.save': { perm: 'product.write', write: true, fn: (u, p) => bundleSave_(u, p) },
  'bundle.setStatus': { perm: 'product.write', write: true, fn: (u, p) => bundleSetStatus_(u, p) },
  'bundle.resolve': { perm: 'product.read', fn: (u, p) => bundleResolve_(p) },

  'quality.get': { perm: 'product.read', fn: () => dataQuality_() },
  'attribute.list': { perm: 'product.read', fn: (u, p) => attributeValues_(p) },
  'attribute.save': { perm: 'master.write', write: true, fn: (u, p) => attributeValueSave_(u, p) },
  'attribute.delete': { perm: 'master.write', write: true, fn: (u, p) => attributeValueDelete_(u, p) },
  'variant.setStatus': { perm: 'product.write', write: true, fn: (u, p) => variantSetStatus_(u, p) },
  'unit.convert': { perm: 'product.read', fn: (u, p) => unitConvert_(p) },

  'barcode.allocate': { perm: 'barcode.allocate', write: true, fn: (u, p) => allocateInternal_(u, p.count, p.requestKey, p.notes).map((b) => b.Code) },
  'barcode.validate': { perm: 'product.read', fn: (u, p) => barcodeValidate_(p) },
  'barcode.lookup': { perm: 'product.read', fn: (u, p) => barcodeLookup_(p.code) },
  'barcode.list': { perm: 'product.read', fn: (u, p) => barcodeList_(p) },
  'barcode.history': { perm: 'product.read', fn: (u, p) => barcodeHistory_(p.code) },
  'barcode.void': { perm: 'barcode.allocate', write: true, fn: (u, p) => barcodeVoid_(u, p.code, p.reason) },
  'barcode.verify': { perm: 'product.write', write: true, fn: (u, p) => barcodeVerify_(u, p.code, p.note) },

  'mapping.list': { perm: 'product.read', fn: (u, p) => mappingList_(p) },
  'mapping.unmapped': { perm: 'product.read', fn: (u, p) => unmappedSkus_(p.system, p.search) },
  'mapping.create': { perm: 'mapping.write', write: true, fn: (u, p) => createMapping_(u, p) },
  'mapping.action': { perm: 'mapping.write', write: true, fn: (u, p) => mappingAction_(u, p.id, p.action, p.note) },
  'mapping.summary': { perm: 'product.read', fn: () => mappingSummary_() },
  'sku.search': { perm: 'product.read', fn: (u, p) => skuSearch_(p.q, p.kinds) },

  'export.data': { perm: 'export.run', write: true, fn: (u, p) => exportData_(u, p) },
  'export.toSheet': { perm: 'export.run', write: true, fn: (u, p) => exportToSheet_(u, p) },

  'import.preview': { perm: 'import.run', fn: (u, p) => importRun_(u, p, { dryRun: true }) },
  'import.commit': { perm: 'import.run', write: true, fn: (u, p) => importRun_(u, p) },
  'import.history': { perm: 'import.run', fn: () => importHistory_() },
  'import.errors': { perm: 'import.run', fn: (u, p) => importErrors_(p.batchId) },

  'user.list': { perm: 'user.manage', fn: () => userList_() },
  'user.create': { perm: 'user.manage', write: true, fn: (u, p) => createUser_(p, u) },
  'user.update': { perm: 'user.manage', write: true, fn: (u, p) => userUpdate_(u, p.id, p) },
  'user.changePassword': { perm: 'product.read', write: true, fn: (u, p) => changeOwnPassword_(u, p.oldPassword, p.newPassword) },
  'settings.get': { perm: 'product.read', fn: () => getSettings_() },
  'settings.save': { perm: 'settings.manage', write: true, fn: (u, p) => settingsSave_(u, p) },
  'audit.list': { perm: 'audit.read', fn: (u, p) => auditList_(p) },
};

function api(token, action, payload) {
  try {
    resetDbCache_();
    if (action === 'ping') return { ok: true, data: { pong: true } };
    autoSchema_();
    resetDbCache_();
    if (action === 'auth.login') return { ok: true, data: login_(payload && payload.email, payload && payload.password) };
    if (action === 'auth.logout') return { ok: true, data: logout_(token) };
    const user = sessionUser_(token);
    if (action === 'auth.me') return { ok: true, data: meInfo_(user) };
    const route = ROUTES[action];
    if (!route) throw new AppError('Aksi tidak dikenal: ' + action);
    assertPerm_(user, route.perm);
    const p = payload || {};
    if (!route.write) {
      const out = route.fn(user, p);
      return { ok: true, data: JSON.parse(JSON.stringify(out === undefined ? null : out)) };
    }
    // Idempotency key: klik ganda / kirim ulang dengan requestKey yang sama → hasil pertama dikembalikan, tidak disimpan dua kali.
    // Pengecekan & penyimpanan hasil terjadi DI DALAM lock sehingga dua permintaan bersamaan tetap aman.
    const idem = p.requestKey ? 'idem:' + user.id + ':' + action + ':' + String(p.requestKey).slice(0, 80) : null;
    const cache = CacheService.getScriptCache();
    let replay = null;
    const data = withLock_(
      () => {
        const hit = idem && cache.get(idem);
        if (hit) {
          replay = JSON.parse(hit);
          return replay;
        }
        return route.fn(user, p);
      },
      (out) => {
        if (!idem || replay) return;
        const json = JSON.stringify(out === undefined ? null : out);
        if (json.length < 90000) cache.put(idem, json, 21600);
      },
    );
    return { ok: true, data: JSON.parse(JSON.stringify(data === undefined ? null : data)), replayed: !!replay };
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: { message: e instanceof AppError ? e.message : 'Terjadi kesalahan pada server: ' + (e && e.message), code: e.code || 'ERROR', details: e.details || [] } };
  }
}

/** Data awal aplikasi setelah login. */
function meInfo_(user) {
  const s = getSettings_();
  return {
    user,
    permissions: ROLE_PERMISSIONS[user.role] || [],
    appName: APP_NAME,
    config: { photoUpload: PropertiesService.getScriptProperties().getProperty('drive_ok') === '1', childSeqMax: CHILD_SEQ_MAX, maxCombinations: MAX_COMBINATIONS, maxVariants: MAX_VARIANTS, channels: s.channels, channelLabel: CHANNEL_LABEL, lifecycle: LIFECYCLE, statusLabel: STATUS_LABEL, gtinLookup: !!s.gtin_lookup_enabled, baseUnits: s.base_units, packUnits: s.pack_units, attributeTypes: s.attribute_types, codeLength: s.master_code_length, roles: ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r] })) },
  };
}

// ---------------------------------------------------------------------------- Setup & backup (jalankan dari editor Apps Script)

/**
 * Jalankan dari editor Apps Script (aman diulang):
 *  1. membuat / melengkapi tab sesuai SCHEMA (tab lama tidak dihapus),
 *  2. mengisi pengaturan default & nomor urut,
 *  3. memigrasikan data struktur lama ke struktur revisi (lihat MigrationService.gs),
 *  4. membuat akun Admin pertama bila belum ada (password sementara di Log eksekusi).
 */
function setup() {
  ensureSheets_();
  const out = ensureData_(true);
  // instalasi baru / setup ulang: import data sekali jalan tidak dijalankan otomatis
  DATA_JOBS_.forEach((job) => PropertiesService.getScriptProperties().setProperty(job.id, '1'));
  setSchemaVersion_();
  const m = out.migration;
  console.log(`Migrasi data lama: ${m.brands} brand, ${m.categories} kategori, ${m.products} produk, ${m.variants} varian, ${m.packs} kemasan, ${m.attributes} atribut, ${m.barcodes} barcode, ${m.legacySkus} SKU lama, ${m.mappings} mapping, ${m.audit} log audit, ${m.counters} penghitung.`);
  m.skipped.forEach((x) => console.log('  dilewati: ' + x));
  m.notMigrated.forEach((x) => console.log('  tidak dimigrasikan: ' + x));
  if (out.admin) console.log(`AKUN ADMIN DIBUAT — email: ${out.admin.email} | password sementara: ${out.admin.password}  (segera ganti di menu Profil)`);
  else console.log('Setup selesai. Akun admin sudah ada sebelumnya.');
  return out;
}

/**
 * Pembaruan struktur OTOMATIS: dipanggil di awal setiap permintaan API. Bila SCHEMA / penghitung / pengaturan default
 * berubah (kode baru di-push), permintaan pertama sesudahnya membuat tab & kolom baru, menjalankan migrasi data,
 * dan melengkapi penghitung — tanpa menjalankan setup() manual. Pengecekan cepat lewat cache (± 0 ms).
 * setup() manual tetap diperlukan hanya untuk instalasi pertama (akun admin) atau bila Google meminta izin baru.
 */
function schemaFingerprint_() {
  const src = JSON.stringify([SCHEMA, COUNTER_NAMES_, Object.keys(DEFAULT_SETTINGS), SHOPEE_CATEGORY_VERSION, DATA_MIGRATION_VERSION_]);
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, src, Utilities.Charset.UTF_8));
}
function setSchemaVersion_() {
  const fp = schemaFingerprint_();
  PropertiesService.getScriptProperties().setProperty('schema_fp', fp);
  CacheService.getScriptCache().put('schema_fp', fp, 21600);
}
function autoSchema_() {
  const fp = schemaFingerprint_();
  const cache = CacheService.getScriptCache();
  if (cache.get('schema_fp') === fp) return false;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('schema_fp') === fp) {
    cache.put('schema_fp', fp, 21600);
    return false;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new AppError('Aplikasi sedang memperbarui struktur database. Coba lagi beberapa detik lagi.', [], 'BUSY');
  try {
    if (props.getProperty('schema_fp') === fp) return false;
    ensureSheets_();
  } finally {
    lock.releaseLock();
  }
  ensureData_(false);
  runDataJobs_();
  setSchemaVersion_();
  console.log('Struktur database diperbarui otomatis (' + fp + ')');
  return true;
}

/** Naikkan bila ensureData_ / DATA_JOBS_ membawa migrasi data baru (memicu pembaruan otomatis sekali). */
const DATA_MIGRATION_VERSION_ = 7;

/**
 * Import data sekali jalan (mis. katalog pemasok) lewat jalur import produk biasa: tercatat di Riwayat import & audit
 * atas nama admin. Penanda Script Property dicek di dalam kunci → tidak pernah jalan dua kali; import ulang pun aman.
 */
const DATA_JOBS_ = [
  { id: 'job_mandom_2026', fileName: 'Import_Produk_Mandom_2026.xlsx', rows: () => MANDOM_2026_ROWS_ },
  // ulang (aman): melengkapi SKU yang barcode internalnya diganti GTIN pabrik — sisanya dilewati
  { id: 'job_mandom_2026b', fileName: 'Import_Produk_Mandom_2026.xlsx (ulang)', rows: () => MANDOM_2026_ROWS_ },
];
function runDataJobs_() {
  const props = PropertiesService.getScriptProperties();
  DATA_JOBS_.forEach((job) => {
    if (props.getProperty(job.id) === '1') return;
    withLock_(
      () => {
        if (props.getProperty(job.id) === '1') return null;
        const admin = db_('Users').rows().find((u) => u.role === 'admin' && u.is_active);
        if (!admin) return null;
        return importRun_({ id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role }, { type: 'products', rows: job.rows(), fileName: job.fileName });
      },
      (rep) => {
        if (!rep) return;
        props.setProperty(job.id, '1'); // hanya setelah data tersimpan
        bumpDataVersion_();
        console.log(job.id + ': ' + JSON.stringify({ created: rep.created, skipped: rep.skipped, errors: rep.errorCount }));
      }
    );
  });
}
const OLD_ATTRIBUTE_TYPES_ = [
  JSON.stringify(['Warna', 'Shade', 'Aroma', 'Ukuran', 'Volume', 'Isi', 'Jenis', 'Tipe']),
  JSON.stringify(['Warna', 'Shade', 'Aroma', 'Ukuran', 'Volume', 'Isi', 'Berat', 'Jenis Produk', 'Jenis', 'Tipe']),
  JSON.stringify(['Warna', 'Aroma', 'Ukuran', 'Berat Isi', 'Volume']),
];
const COUNTER_NAMES_ = ['parent_no', 'product_no', 'sku_no', 'internal_barcode', 'multipack_no', 'bundle_no', 'supplier_no'];

/** Tab & header sesuai SCHEMA (aman diulang; tab berisi data dengan kolom berbeda → dihentikan, data tidak disentuh). */
function ensureSheets_() {
  const ss = ss_();
  Object.keys(SCHEMA).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const cols = SCHEMA[name];
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    if (sh.getLastRow() > 1) {
      // tab berisi data: header lama harus cocok (boleh hanya kurang kolom di ujung kanan)
      const head = sh.getRange(1, 1, 1, cols.length).getValues()[0].map((h) => String(h || '').trim());
      const bad = head.findIndex((h, i) => h && h !== cols[i]);
      if (bad >= 0) throw new Error(`Tab "${name}" berisi data dengan kolom berbeda (kolom ${bad + 1}: "${head[bad]}" ≠ "${cols[bad]}"). Setup dihentikan agar data tidak rusak.`);
    }
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#f1efe8');
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.setFrozenRows(1);
    const prot = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (!prot.length) sh.protect().setDescription('Diubah hanya lewat aplikasi Master Produk').setWarningOnly(true);
  });
  let about = ss.getSheetByName('Tentang');
  if (!about) about = ss.insertSheet('Tentang', 0);
  about.clear();
  const legacy = LEGACY_TABS.filter((n) => ss.getSheetByName(n));
  const info = [
    ['Database Master Produk & SKU', ''],
    ['Isi dan ubah data HANYA melalui aplikasi web agar validasi dan audit trail tetap berjalan. Jangan mengganti nama tab atau urutan kolom.', ''],
    ['Hierarki: Brand + Kategori → Parent SKU (MASTER_PRODUCTS) → Child SKU (PRODUCT_VARIANTS) → Barcode (VARIANT_BARCODES) & Kemasan (UNIT_CONVERSIONS); Bundle (BUNDLE_*), Supplier (SUPPLIER_*), Kanal (EXTERNAL_SKU_MAPPINGS)', ''],
    ['', ''],
    ['Tab', 'Isi'],
  ]
    .concat(Object.keys(SCHEMA).map((n) => [n, TAB_DESCRIPTION[n] || '']))
    .concat(legacy.length ? [['', ''], ['Tab versi lama (arsip)', 'Tidak dipakai aplikasi. Datanya sudah dimigrasikan oleh setup(); dapat dihapus manual setelah dicek.']].concat(legacy.map((n) => [n, 'LEGACY'])) : []);
  about.getRange(1, 1, info.length, 2).setValues(info);
  about.getRange(1, 1).setFontWeight('bold');
  about.getRange(5, 1, 1, 2).setFontWeight('bold').setBackground('#f1efe8');
  // hapus tab bawaan yang masih kosong (Sheet1 / Lembar1)
  ss.getSheets().forEach((sh) => {
    const n = sh.getName();
    if (!SCHEMA[n] && n !== 'Tentang' && LEGACY_TABS.indexOf(n) < 0 && n.indexOf('Ekspor ') !== 0 && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  resetDbCache_();
}

/** Pengaturan default, migrasi data lama, penghitung; akun admin pertama hanya dari setup() manual. */
function ensureData_(createAdmin) {
  return withLock_(() => {
    const st = db_('Settings');
    Object.keys(DEFAULT_SETTINGS).forEach((k) => {
      if (!st.find((r) => r.key === k)) st.insert({ key: k, value: JSON.stringify(DEFAULT_SETTINGS[k]), updated_by: 'setup', updated_at: now_() });
    });
    // jenis variasi: ganti daftar bawaan lama dengan daftar baru (daftar yang sudah diubah user tidak disentuh)
    const at = st.find((r) => r.key === 'attribute_types');
    if (at && OLD_ATTRIBUTE_TYPES_.indexOf(at.value) >= 0) st.update(at, { value: JSON.stringify(DEFAULT_SETTINGS.attribute_types), updated_by: 'setup', updated_at: now_() });
    // satuan: daftar bawaan lama → PCS & BOX; satuan terkecil yang dipakai produk selalu ada di daftar
    const bu = st.find((r) => r.key === 'base_units');
    if (bu) {
      let cur = [];
      try { cur = JSON.parse(bu.value); } catch (e) { cur = []; }
      const oldDefault = bu.value === JSON.stringify(['PCS', 'BOTOL', 'TUBE', 'SACHET', 'JAR', 'PACK', 'POT', 'STICK']);
      const units = oldDefault ? ['PCS'] : cur.slice();
      db_('MASTER_PRODUCTS').rows().forEach((p) => p.BaseUnit && units.indexOf(p.BaseUnit) < 0 && units.push(p.BaseUnit));
      db_('PRODUCT_VARIANTS').rows().forEach((v) => v.BaseUnit && units.indexOf(v.BaseUnit) < 0 && units.push(v.BaseUnit));
      if (JSON.stringify(units) !== JSON.stringify(cur)) st.update(bu, { value: JSON.stringify(units), updated_by: 'setup', updated_at: now_() });
    }
    const pu = st.find((r) => r.key === 'pack_units');
    if (pu && pu.value === JSON.stringify(['BOX', 'KARTON', 'PACK', 'LUSIN', 'INNER', 'DUS', 'BAL', 'SET'])) st.update(pu, { value: JSON.stringify(['BOX']), updated_by: 'setup', updated_at: now_() });
    // migrasi dulu (menyalin penghitung lama), baru penghitung yang belum ada dibuat
    const migration = migrateLegacy_('setup');
    // kategori standar Shopee (Perawatan & Kecantikan) disalin/diperbarui setelah migrasi — tidak menghapus kategori apa pun
    syncShopeeCategories_();
    const seq = db_('SYSTEM_COUNTERS');
    // penghitung baru dimulai setelah nomor urut tertinggi yang sudah dipakai (tidak pernah dialokasikan ulang)
    const maxParent = db_('MASTER_PRODUCTS').rows().reduce((m, p) => Math.max(m, Number(p.ProductNo) || 0, Number(p.ParentCode) || 0), 0);
    COUNTER_NAMES_.forEach((n) => !seq.find((r) => r.CounterName === n) && seq.insert({ CounterName: n, Value: String(n === 'parent_no' ? maxParent + 1 : 1), UpdatedAt: now_() }));
    let admin = null;
    if (createAdmin && !db_('Users').rows().length) {
      const email = (Session.getEffectiveUser().getEmail() || 'admin@toko.local').toLowerCase();
      const password = Utilities.getUuid().replace(/-/g, '').slice(0, 14);
      createUser_({ email, fullName: 'Administrator', role: 'admin', password }, null);
      admin = { email, password };
    }
    migrateGramUnit_();
    // data bisa berubah di luar alur biasa → cache direktori dimulai ulang
    bumpDataVersion_();
    return { admin, migration };
  });
}

/**
 * Satuan berat ditulis "gr": nilai variasi "10 g" → "10 gr" (PRODUCT_VARIANTS & VARIANT_ATTRIBUTES), lalu nama SKU
 * produk otomatis disusun ulang. Kode SKU, GTIN & nama yang diubah manual tidak tersentuh. Sekali jalan.
 */
function migrateGramUnit_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('mig_gram_gr') === '1') return 0;
  const fix = (val) => String(val || '').replace(/(\d)\s*(g|gram|grams)$/i, '$1 gr');
  let n = 0;
  db_('PRODUCT_VARIANTS').rows().forEach((v) => {
    const attrs = Array.isArray(v.VariantAttributes) ? v.VariantAttributes : [];
    const next = attrs.map((a) => Object.assign({}, a, { value: fix(a.value) }));
    if (JSON.stringify(next) !== JSON.stringify(attrs)) {
      db_('PRODUCT_VARIANTS').update(v, { VariantAttributes: next });
      n++;
    }
  });
  db_('VARIANT_ATTRIBUTES').rows().forEach((a) => {
    const f = fix(a.AttributeValue);
    if (f !== a.AttributeValue) db_('VARIANT_ATTRIBUTES').update(a, { AttributeValue: f });
  });
  let names = 0;
  db_('MASTER_BRANDS').rows().forEach((b) => (names += refreshSkuNames_(b.BrandID)));
  props.setProperty('mig_gram_gr', '1');
  if (n || names) audit_('setup', 'migration.gramUnit', 'system', '', null, { variants: n, skuNames: names });
  return n;
}

/** Backup: salin seluruh spreadsheet ke Drive (berisi semua tab/tabel). */
function backupNow() {
  const ss = ss_();
  const name = `${ss.getName()} - backup ${Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HHmm')}`;
  const copy = ss.copy(name);
  console.log('Backup dibuat: ' + copy.getUrl());
  return copy.getUrl();
}

function installDailyBackup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'backupNow')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(1).create();
  console.log('Backup harian aktif (sekitar pukul 01.00).');
}
