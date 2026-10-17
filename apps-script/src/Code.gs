/**
 * Entry point Web App + dispatcher API.
 * Browser memanggil: google.script.run.api(token, action, payload) → { ok, data } | { ok:false, error }.
 * Hak akses (RBAC) dicek DI SERVER untuk setiap aksi; validasi data juga selalu di server.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
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
  'brand.importPreview': { perm: 'master.write', fn: (u, p) => masterImport_(u, 'brand', p, { dryRun: true }) },
  'brand.import': { perm: 'master.write', write: true, fn: (u, p) => masterImport_(u, 'brand', p) },

  'category.list': { perm: 'product.read', fn: (u, p) => categoryList_(p) },
  'category.preview': { perm: 'product.read', fn: (u, p) => categoryPreview_(p.name) },
  'category.create': { perm: 'master.write', write: true, fn: (u, p) => categoryCreate_(u, p) },
  'category.createMany': { perm: 'master.write', write: true, fn: (u, p) => categoryCreateMany_(u, p) },
  'category.rename': { perm: 'master.write', write: true, fn: (u, p) => categoryRename_(u, p) },
  'category.setStatus': { perm: 'master.write', write: true, fn: (u, p) => categorySetStatus_(u, p) },
  'category.delete': { perm: 'master.write', write: true, fn: (u, p) => categoryDelete_(u, p) },
  'category.importPreview': { perm: 'master.write', fn: (u, p) => masterImport_(u, 'category', p, { dryRun: true }) },
  'category.import': { perm: 'master.write', write: true, fn: (u, p) => masterImport_(u, 'category', p) },

  'product.list': { perm: 'product.read', fn: (u, p) => productList_(p) },
  'product.search': { perm: 'product.read', fn: (u, p) => productSearch_(p.q) },
  'product.get': { perm: 'product.read', fn: (u, p) => productDetail_(p.id) },
  'product.check': { perm: 'product.read', fn: (u, p) => productCheck_(p) },
  'product.parentPreview': { perm: 'product.read', fn: (u, p) => parentPreview_(p) },
  'product.validate': { perm: 'product.write', fn: (u, p) => productSave_(u, p.input, { dryRun: true }) },
  'product.save': { perm: 'product.write', write: true, fn: (u, p) => productSave_(u, p.input) },
  'product.setStatus': { perm: 'product.write', write: true, fn: (u, p) => productSetStatus_(u, p) },
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
    config: { parentCodeDigits: PARENT_CODE_DIGITS, maxCombinations: MAX_COMBINATIONS, maxVariants: MAX_VARIANTS, channels: s.channels, channelLabel: CHANNEL_LABEL, lifecycle: LIFECYCLE, statusLabel: STATUS_LABEL, gtinLookup: !!s.gtin_lookup_enabled, baseUnits: s.base_units, packUnits: s.pack_units, attributeTypes: s.attribute_types, codeLength: s.master_code_length, roles: ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r] })) },
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
  const out = withLock_(() => {
    const st = db_('Settings');
    Object.keys(DEFAULT_SETTINGS).forEach((k) => {
      if (!st.find((r) => r.key === k)) st.insert({ key: k, value: JSON.stringify(DEFAULT_SETTINGS[k]), updated_by: 'setup', updated_at: now_() });
    });
    // migrasi dulu (menyalin penghitung lama), baru penghitung yang belum ada dibuat
    const migration = migrateLegacy_('setup');
    const seq = db_('SYSTEM_COUNTERS');
    ['parent_no', 'product_no', 'sku_no', 'internal_barcode', 'multipack_no', 'bundle_no', 'supplier_no'].forEach((n) => !seq.find((r) => r.CounterName === n) && seq.insert({ CounterName: n, Value: '1', UpdatedAt: now_() }));
    let admin = null;
    if (!db_('Users').rows().length) {
      const email = (Session.getEffectiveUser().getEmail() || 'admin@toko.local').toLowerCase();
      const password = Utilities.getUuid().replace(/-/g, '').slice(0, 14);
      createUser_({ email, fullName: 'Administrator', role: 'admin', password }, null);
      admin = { email, password };
    }
    return { admin, migration };
  });
  const m = out.migration;
  console.log(`Migrasi data lama: ${m.brands} brand, ${m.categories} kategori, ${m.products} produk, ${m.variants} varian, ${m.packs} kemasan, ${m.attributes} atribut, ${m.barcodes} barcode, ${m.legacySkus} SKU lama, ${m.mappings} mapping, ${m.audit} log audit, ${m.counters} penghitung.`);
  m.skipped.forEach((s) => console.log('  dilewati: ' + s));
  m.notMigrated.forEach((s) => console.log('  tidak dimigrasikan: ' + s));
  if (out.admin) console.log(`AKUN ADMIN DIBUAT — email: ${out.admin.email} | password sementara: ${out.admin.password}  (segera ganti di menu Profil)`);
  else console.log('Setup selesai. Akun admin sudah ada sebelumnya.');
  return out;
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
