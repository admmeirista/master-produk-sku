/**
 * Entry point Web App + dispatcher API untuk google.script.run.
 * Semua pemanggilan dari browser: api(token, action, payload) -> { ok, data } | { ok:false, error }.
 * Hak akses (RBAC) dicek DI SERVER untuk setiap aksi.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** perm: hak minimal; write: dijalankan di dalam lock + buffer tulis (atomik). */
const ROUTES = {
  'dashboard.get': { perm: 'product.read', fn: () => dashboard_() },
  'quality.get': { perm: 'product.read', fn: () => dataQuality_() },
  'quality.dismiss': { perm: 'product.read', write: true, fn: (u, p) => (assertAny_(u, ['product.review', 'product.write']), dismissPair_(u, p.a, p.b, p.reason)) },

  'ref.list': { perm: 'reference.read', fn: (u, p) => refList_(p.kind) },
  'ref.save': { perm: 'reference.read', write: true, fn: (u, p) => refSave_(u, p.kind, p.input) },
  'ref.status': { perm: 'reference.manage', write: true, fn: (u, p) => refStatus_(u, p.kind, p.id, p.action, p.reason) },

  'product.list': { perm: 'product.read', fn: (u, p) => listProducts_(p || {}) },
  'product.get': { perm: 'product.read', fn: (u, p) => productDetail_(p.id) },
  'product.completeness': { perm: 'product.read', fn: (u, p) => completeness_(p.id) },
  'product.save': { perm: 'product.write', write: true, fn: (u, p) => saveDraft_(u, p.input, p.id) },
  'product.workflow': { perm: 'product.read', write: true, fn: (u, p) => transitionProduct_(u, p.id, p.action, p) },
  'product.changeRequest': { perm: 'product.write', write: true, fn: (u, p) => createChangeRequest_(u, p.id, p.input) },
  'product.audit': { perm: 'product.read', fn: (u, p) => auditList_({ entityId: p.id, page: 1 }).rows },
  'duplicates.check': { perm: 'product.read', fn: (u, p) => checkDuplicates_(p) },
  'sku.preview': { perm: 'product.read', fn: (u, p) => skuPreview_(p) },
  'sku.list': { perm: 'product.read', fn: (u, p) => skuList_(p || {}) },
  'sku.history': { perm: 'product.read', fn: (u, p) => skuHistory_(p.id) },
  'sku.setPrice': {
    perm: 'price.write',
    write: true,
    fn: (u, p) => {
      if (!cleanText(p.reason)) throw new AppError('Alasan perubahan harga wajib diisi');
      const s = db_('SKUs').byId(p.id);
      if (!s || s.status === 'archived') throw new AppError('SKU tidak ditemukan / diarsipkan');
      const changed = setPrice_(u, p.id, p.priceType, p.amount, p.reason);
      if (changed) audit_(u.email, 'price.set', 'sku', p.id, null, { type: p.priceType, amount: p.amount, reason: p.reason });
      return { changed };
    },
  },

  'request.list': { perm: 'product.read', fn: (u, p) => listRequests_(u, p || {}) },
  'request.decide': { perm: 'product.read', write: true, fn: (u, p) => decideChangeRequest_(u, p.id, p.decision, p.reason) },

  'barcode.allocate': { perm: 'barcode.allocate', write: true, fn: (u, p) => allocateInternal_(u, p.count, p.requestKey, p.notes) },
  'barcode.validate': { perm: 'product.read', fn: (u, p) => barcodeValidate_(p) },
  'barcode.list': { perm: 'product.read', fn: (u, p) => barcodeList_(p || {}) },
  'barcode.history': { perm: 'product.read', fn: (u, p) => barcodeHistory_(p.code) },
  'barcode.void': { perm: 'barcode.allocate', write: true, fn: (u, p) => barcodeVoid_(u, p.code, p.reason) },
  'barcode.verify': { perm: 'product.review', write: true, fn: (u, p) => barcodeVerify_(u, p.code, p.note) },

  'mapping.list': { perm: 'product.read', fn: (u, p) => mappingList_(p || {}) },
  'mapping.unmapped': { perm: 'product.read', fn: (u, p) => unmappedSkus_(p.system) },
  'mapping.create': { perm: 'mapping.write', write: true, fn: (u, p) => createMapping_(u, p) },
  'mapping.action': { perm: 'mapping.write', write: true, fn: (u, p) => mappingAction_(u, p.id, p.action, p.note) },

  'export.beecloud': { perm: 'export.run', write: true, fn: (u, p) => exportBeecloud_(u, p || {}) },
  'export.master': { perm: 'export.run', fn: () => exportMaster_() },
  'export.mappings': { perm: 'export.run', fn: (u, p) => exportMappings_(p.system) },
  'export.toSheet': { perm: 'export.run', write: true, fn: (u, p) => exportToSheet_(u, p) },

  'import.types': { perm: 'import.run', fn: () => importTypes_() },
  'import.prepare': { perm: 'import.run', fn: (u, p) => importPrepare_(p) },
  'import.validate': { perm: 'import.run', fn: (u, p) => importValidate_(p) },
  'import.commit': { perm: 'import.run', write: true, fn: (u, p) => importCommit_(u, p) },
  'import.history': { perm: 'import.run', fn: () => importHistory_() },

  'user.list': { perm: 'user.manage', fn: () => userList_() },
  'user.create': { perm: 'user.manage', write: true, fn: (u, p) => createUser_(p, u) },
  'user.update': { perm: 'user.manage', write: true, fn: (u, p) => userUpdate_(u, p.id, p) },
  'user.changePassword': { perm: 'product.read', write: true, fn: (u, p) => changeOwnPassword_(u, p.oldPassword, p.newPassword) },
  'settings.get': { perm: 'product.read', fn: () => getSettings_() },
  'settings.save': { perm: 'settings.manage', write: true, fn: (u, p) => settingsSave_(u, p) },
  'audit.list': { perm: 'audit.read', fn: (u, p) => auditList_(p || {}) },
};

function assertAny_(user, perms) {
  if (!perms.some((p) => can_(user, p))) throw new AppError('Anda tidak memiliki hak akses untuk tindakan ini', [], 'FORBIDDEN');
}

function api(token, action, payload) {
  try {
    resetDbCache_();
    if (action === 'auth.login') return { ok: true, data: login_(payload.email, payload.password) };
    if (action === 'auth.logout') return { ok: true, data: logout_(token) };
    const user = sessionUser_(token);
    if (action === 'auth.me') return { ok: true, data: { user, permissions: ROLE_PERMISSIONS[user.role], appName: APP_NAME } };
    const route = ROUTES[action];
    if (!route) throw new AppError('Aksi tidak dikenal: ' + action);
    assertPerm_(user, route.perm);
    const data = route.write ? withLock_(() => route.fn(user, payload || {})) : route.fn(user, payload || {});
    return { ok: true, data: JSON.parse(JSON.stringify(data === undefined ? null : data)) };
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: { message: e instanceof AppError ? e.message : 'Terjadi kesalahan pada server: ' + (e && e.message), code: e.code || 'ERROR', details: e.details || [] } };
  }
}

// ---------------------------------------------------------------------------- Setup & backup (jalankan dari editor Apps Script)

/**
 * Jalankan SEKALI dari editor Apps Script setelah DB_SPREADSHEET_ID diisi: memeriksa/melengkapi struktur tab
 * di file database, mengisi pengaturan default, dan membuat akun Admin pertama (password sementara di Log eksekusi).
 */
function setup() {
  const ss = ss_();
  Object.keys(SCHEMA).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const cols = SCHEMA[name];
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#e8eef7');
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.setFrozenRows(1);
    const prot = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (!prot.length) sh.protect().setDescription('Diubah hanya lewat aplikasi Master Produk').setWarningOnly(true);
  });
  let about = ss.getSheetByName('Tentang');
  if (!about) about = ss.insertSheet('Tentang', 0);
  about.clear();
  const info = [['Database Master Produk & SKU', ''], ['Isi dan ubah data HANYA melalui aplikasi web agar validasi, persetujuan, dan audit trail tetap berjalan. Jangan mengganti nama tab atau urutan kolom.', ''], ['', ''], ['Tab', 'Isi']].concat(Object.keys(SCHEMA).map((n) => [n, TAB_DESCRIPTION[n] || '']));
  about.getRange(1, 1, info.length, 2).setValues(info);
  about.getRange(1, 1).setFontWeight('bold');
  about.getRange(4, 1, 1, 2).setFontWeight('bold').setBackground('#e8eef7');
  // hapus tab bawaan yang masih kosong (Sheet1 / Lembar1)
  ss.getSheets().forEach((sh) => {
    const n = sh.getName();
    if (!SCHEMA[n] && n !== 'Tentang' && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  resetDbCache_();
  const out = withLock_(() => {
    const st = db_('Settings');
    Object.keys(DEFAULT_SETTINGS).forEach((k) => {
      if (!st.find((r) => r.key === k)) st.insert({ key: k, value: JSON.stringify(DEFAULT_SETTINGS[k]), updated_by: 'setup', updated_at: now_() });
    });
    const seq = db_('Sequences');
    ['product_no', 'variant_no', 'sku_no', 'request_no', 'batch_no', 'internal_barcode'].forEach((n) => !seq.find((r) => r.name === n) && seq.insert({ name: n, value: 1 }));
    if (!db_('Users').rows().length) {
      const email = (Session.getEffectiveUser().getEmail() || 'admin@toko.local').toLowerCase();
      const password = Utilities.getUuid().replace(/-/g, '').slice(0, 14);
      createUser_({ email, fullName: 'Administrator', role: 'admin', password }, null);
      return { email, password };
    }
    return null;
  });
  if (out) console.log(`AKUN ADMIN DIBUAT — email: ${out.email} | password sementara: ${out.password}  (segera ganti di menu Profil)`);
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
