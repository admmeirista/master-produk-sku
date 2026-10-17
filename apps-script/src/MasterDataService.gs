/**
 * Logika bersama Master Brand & Master Kategori.
 *  - User hanya mengisi NAMA; kode dibuat otomatis (default 3 huruf kapital), unik, dan PERMANEN
 *    (tidak berubah ketika nama diperbaiki, tidak pernah dipakai ulang walau datanya dinonaktifkan).
 *  - Duplikasi nama dicek dengan normalisasi (huruf besar/kecil, spasi, tanda baca, aksen) → diblokir.
 *    Nama yang MIRIP (fuzzy) → peringatan yang harus dikonfirmasi.
 *  - Hapus hanya untuk data yang belum dipakai produk; baris disimpan berstatus DELETED agar kodenya tidak dipakai ulang.
 *  - Pembuatan kode berjalan di dalam script lock (withLock_) sehingga dua user yang menyimpan bersamaan
 *    tidak mungkin mendapat kode yang sama.
 */

const MASTER_KIND = {
  brand: { table: 'MASTER_BRANDS', id: 'BrandID', code: 'BrandCode', name: 'BrandName', label: 'Brand' },
  category: { table: 'MASTER_CATEGORIES', id: 'CategoryID', code: 'CategoryCode', name: 'CategoryName', label: 'Kategori' },
};

function masterCfg_(kind) {
  const k = MASTER_KIND[kind];
  if (!k) throw new AppError('Jenis master tidak dikenal: ' + kind);
  return k;
}

function masterView_(k, r, counts) {
  return { id: r[k.id], code: r[k.code], name: r[k.name], status: r.Status, createdAt: r.CreatedAt, createdBy: r.CreatedBy, updatedAt: r.UpdatedAt, productCount: counts ? counts[r[k.id]] || 0 : undefined };
}

function masterList_(kind, f) {
  const k = masterCfg_(kind);
  f = f || {};
  const counts = {};
  db_('MASTER_PRODUCTS')
    .rows()
    .forEach((p) => (counts[p[k.id]] = (counts[p[k.id]] || 0) + 1));
  return db_(k.table)
    .rows()
    .filter((r) => r.Status !== STATUS.DELETED && (!f.activeOnly || r.Status === STATUS.ACTIVE))
    .map((r) => masterView_(k, r, counts))
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

function masterCleanName_(k, name) {
  const n = cleanText(name);
  if (n.length < 2) throw new AppError('Nama ' + k.label.toLowerCase() + ' minimal 2 karakter', [{ path: 'name', message: 'Minimal 2 karakter' }], 'VALIDATION_FAILED');
  if (n.length > 60) throw new AppError('Nama ' + k.label.toLowerCase() + ' maksimal 60 karakter', [{ path: 'name', message: 'Maksimal 60 karakter' }], 'VALIDATION_FAILED');
  if (!/[A-Za-z0-9]/.test(n)) throw new AppError('Nama harus mengandung huruf atau angka', [{ path: 'name', message: 'Nama tidak valid' }], 'VALIDATION_FAILED');
  return n;
}

/** Duplikasi persis (blokir) & nama mirip (peringatan). */
function masterNameCheck_(k, name, exceptId) {
  const key = masterNameKey(name);
  const others = db_(k.table).filter((r) => r[k.id] !== exceptId && r.Status !== STATUS.DELETED);
  const exact = others.find((r) => r.NameKey === key);
  const similar = exact
    ? []
    : others
        .map((r) => ({ r, s: nameSimilarity(name, r[k.name]) }))
        .filter((x) => x.s >= 0.85)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map((x) => ({ id: x.r[k.id], name: x.r[k.name], code: x.r[k.code], status: x.r.Status, score: x.s }));
  return { key, exact, similar };
}

function masterDuplicateError_(k, ex) {
  const inactive = ex.Status !== STATUS.ACTIVE ? ' (nonaktif — aktifkan kembali bila diperlukan)' : '';
  return new AppError(`${k.label} "${ex[k.name]}" sudah terdaftar dengan kode ${ex[k.code]}${inactive}`, [{ path: 'name', message: 'Nama sudah terdaftar', code: 'DUPLICATE', data: { id: ex[k.id], code: ex[k.code], name: ex[k.name], status: ex.Status } }], 'DUPLICATE');
}

function masterUsedCodes_(k) {
  const used = {};
  db_(k.table)
    .rows()
    .forEach((r) => (used[String(r[k.code]).toUpperCase()] = 1));
  return used;
}

/** Pratinjau (tidak mengikat): kode yang AKAN dibuat + cek duplikasi. Kode final ditentukan saat simpan di dalam lock. */
function masterPreview_(kind, name) {
  const k = masterCfg_(kind);
  const n = cleanText(name);
  if (n.length < 2) return { code: '', exact: null, similar: [] };
  const chk = masterNameCheck_(k, n);
  const used = masterUsedCodes_(k);
  const code = chk.exact ? chk.exact[k.code] : generateMasterCode(n, (c) => !!used[c], getSettings_().master_code_length);
  return { code, exact: chk.exact ? masterView_(k, chk.exact) : null, similar: chk.similar };
}

function masterCreate_(user, kind, input) {
  const k = masterCfg_(kind);
  const name = masterCleanName_(k, input.name);
  const chk = masterNameCheck_(k, name);
  if (chk.exact) throw masterDuplicateError_(k, chk.exact);
  if (chk.similar.length && !input.acknowledgeSimilar)
    throw new AppError(`Ada ${k.label.toLowerCase()} dengan nama mirip. Pastikan bukan duplikat.`, chk.similar.map((s) => ({ path: 'name', message: `${s.name} (${s.code}) — kemiripan ${Math.round(s.score * 100)}%`, data: s })), 'SIMILAR_EXISTS');
  const used = masterUsedCodes_(k);
  const code = generateMasterCode(name, (c) => !!used[c], getSettings_().master_code_length);
  const rec = db_(k.table).insert({
    [k.id]: uuid_(),
    [k.code]: code,
    [k.name]: name,
    NameKey: chk.key,
    Status: STATUS.ACTIVE,
    CreatedBy: user.email,
    CreatedAt: now_(),
    UpdatedBy: user.email,
    UpdatedAt: now_(),
  });
  audit_(user.email, kind + '.create', kind, rec[k.id], null, { code, name });
  return masterView_(k, rec, {});
}

/** Tambah banyak sekaligus (satu nama per baris). Duplikat / mirip dilewati dengan alasan jelas. */
function masterCreateMany_(user, kind, names, acknowledgeSimilar) {
  const k = masterCfg_(kind);
  const list = (names || []).map(cleanText).filter(Boolean);
  if (!list.length) throw new AppError('Isi minimal satu nama');
  if (list.length > 500) throw new AppError('Maksimal 500 nama sekali simpan');
  const created = [];
  const skipped = [];
  list.forEach((n, i) => {
    try {
      created.push(masterCreate_(user, kind, { name: n, acknowledgeSimilar: !!acknowledgeSimilar }));
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      skipped.push({ line: i + 1, name: n, reason: e.message });
    }
  });
  return { created, skipped };
}

function masterRename_(user, kind, id, input) {
  const k = masterCfg_(kind);
  const rec = db_(k.table).byId(id);
  if (!rec) throw new AppError(k.label + ' tidak ditemukan', [], 'NOT_FOUND');
  const name = masterCleanName_(k, input.name);
  if (name === rec[k.name]) return masterView_(k, rec, {});
  const chk = masterNameCheck_(k, name, id);
  if (chk.exact) throw masterDuplicateError_(k, chk.exact);
  if (chk.similar.length && !input.acknowledgeSimilar)
    throw new AppError(`Ada ${k.label.toLowerCase()} dengan nama mirip. Pastikan bukan duplikat.`, chk.similar.map((s) => ({ path: 'name', message: `${s.name} (${s.code}) — kemiripan ${Math.round(s.score * 100)}%`, data: s })), 'SIMILAR_EXISTS');
  const before = { name: rec[k.name], code: rec[k.code] };
  // KODE TIDAK BERUBAH — SKU yang sudah terbit tetap konsisten
  db_(k.table).update(rec, { [k.name]: name, NameKey: chk.key, UpdatedBy: user.email, UpdatedAt: now_() });
  audit_(user.email, kind + '.rename', kind, id, before, { name, code: rec[k.code] });
  // nama Produk SKU otomatis = brand + parent + atribut → ikut diperbarui (SKU tidak berubah)
  if (kind === 'brand') refreshSkuNames_(id);
  return masterView_(k, rec, {});
}

function masterSetStatus_(user, kind, id, status) {
  const k = masterCfg_(kind);
  if ([STATUS.ACTIVE, STATUS.INACTIVE].indexOf(status) < 0) throw new AppError('Status tidak valid');
  const rec = db_(k.table).byId(id);
  if (!rec) throw new AppError(k.label + ' tidak ditemukan', [], 'NOT_FOUND');
  if (rec.Status === STATUS.DELETED) throw new AppError(k.label + ' sudah dihapus', [], 'NOT_FOUND');
  if (rec.Status === status) return masterView_(k, rec, {});
  const before = rec.Status;
  db_(k.table).update(rec, { Status: status, UpdatedBy: user.email, UpdatedAt: now_() });
  audit_(user.email, kind + (status === STATUS.ACTIVE ? '.activate' : '.deactivate'), kind, id, { status: before }, { status });
  return masterView_(k, rec, {});
}

/** Hapus brand/kategori yang BELUM menjadi referensi produk mana pun. Kode tetap dicadangkan (tidak dipakai ulang). */
function masterDelete_(user, kind, id) {
  const k = masterCfg_(kind);
  const rec = db_(k.table).byId(id);
  if (!rec || rec.Status === STATUS.DELETED) throw new AppError(k.label + ' tidak ditemukan', [], 'NOT_FOUND');
  const used = db_('MASTER_PRODUCTS').filter((p) => p[k.id] === id).length;
  if (used) throw new AppError(`${k.label} ${rec[k.name]} dipakai ${used} produk sehingga tidak dapat dihapus. Nonaktifkan saja.`, [], 'IN_USE');
  db_(k.table).update(rec, { Status: STATUS.DELETED, UpdatedBy: user.email, UpdatedAt: now_() });
  audit_(user.email, kind + '.delete', kind, id, { name: rec[k.name], code: rec[k.code], status: 'ACTIVE' }, { status: STATUS.DELETED });
  return true;
}

/**
 * Import Excel Master Brand / Master Kategori. File .xlsx dibaca di browser (SheetJS) — Apps Script tidak membaca
 * XLSX langsung — lalu baris dikirim sebagai teks: [{ row, name, code? }].
 *   Pratinjau (opts.dryRun) tidak menulis apa pun; Import berjalan di dalam lock (kode otomatis dialokasikan aman).
 *   Nama yang sudah terdaftar (normalisasi huruf/spasi/tanda baca) → Dilewati, sehingga import ulang tidak menggandakan.
 *   Kolom kode di file TIDAK menimpa kode existing dan tidak dipakai untuk data baru (kode selalu otomatis);
 *   mempertahankan kode lama = proses migrasi terpisah (Import & Export › Import › Referensi, dengan pratinjau).
 */
function masterImport_(user, kind, p, opts) {
  const k = masterCfg_(kind);
  opts = opts || {};
  const rows = (p && p.rows) || [];
  if (!rows.length) throw new AppError('File tidak berisi baris data');
  if (rows.length > 2000) throw new AppError('Maksimal 2.000 baris per file');
  const used = masterUsedCodes_(k);
  const byKey = {};
  db_(k.table)
    .filter((r) => r.Status !== STATUS.DELETED)
    .forEach((r) => (byKey[r.NameKey] = r));
  const inFile = {};
  const out = rows.map((x) => {
    const row = Number(x.row) || 0;
    const raw = cleanText(x.name);
    const fileCode = normalizeCode(x.code);
    const res = { row, name: raw, fileCode, status: '', code: '', message: '' };
    if (!raw) return Object.assign(res, { status: 'failed', message: 'Nama kosong' });
    let name;
    try {
      name = masterCleanName_(k, raw);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return Object.assign(res, { status: 'failed', message: e.message });
    }
    const key = masterNameKey(name);
    const ex = byKey[key];
    if (ex) {
      const note = fileCode && fileCode !== String(ex[k.code]).toUpperCase() ? ` Kode di file (${fileCode}) diabaikan — kode existing tidak ditimpa.` : '';
      return Object.assign(res, { status: 'skipped', code: ex[k.code], message: `Sudah terdaftar sebagai "${ex[k.name]}" (${ex[k.code]}${ex.Status !== STATUS.ACTIVE ? ', ' + (STATUS_LABEL[ex.Status] || ex.Status) : ''}).${note}` });
    }
    if (inFile[key]) return Object.assign(res, { status: 'skipped', code: inFile[key].code, message: `Duplikat dengan baris ${inFile[key].row} di file ini` });
    const code = generateMasterCode(name, (c) => !!used[c], getSettings_().master_code_length);
    used[code] = 1;
    inFile[key] = { row, code };
    const similar = Object.keys(byKey)
      .map((kk) => byKey[kk])
      .filter((r) => nameSimilarity(name, r[k.name]) >= 0.85)
      .slice(0, 3);
    Object.assign(res, { status: 'new', name, code, message: (similar.length ? 'Mirip: ' + similar.map((r) => `${r[k.name]} (${r[k.code]})`).join(', ') + '. ' : '') + (fileCode && fileCode !== code ? `Kode di file (${fileCode}) tidak dipakai — kode dibuat otomatis.` : '') });
    if (!opts.dryRun) {
      const rec = db_(k.table).insert({ [k.id]: uuid_(), [k.code]: code, [k.name]: name, NameKey: key, Status: STATUS.ACTIVE, CreatedBy: user.email, CreatedAt: now_(), UpdatedBy: user.email, UpdatedAt: now_() });
      byKey[key] = rec;
      res.status = 'success';
    }
    return res;
  });
  const count = (st) => out.filter((r) => r.status === st).length;
  const rep = { kind, label: k.label, fileName: cleanText(p.fileName), dryRun: !!opts.dryRun, rows: out, counts: { success: opts.dryRun ? count('new') : count('success'), skipped: count('skipped'), failed: count('failed') } };
  if (!opts.dryRun) {
    const batchId = uuid_();
    rep.batchId = batchId;
    db_('IMPORT_BATCHES').insert({ BatchID: batchId, ImportType: kind + '_list', FileName: rep.fileName, ContentHash: '', Status: 'COMMITTED', TotalRows: out.length, CreatedRows: rep.counts.success, SkippedRows: rep.counts.skipped, ErrorRows: rep.counts.failed, ReportJson: { counts: rep.counts }, CreatedBy: user.email, CreatedAt: now_() });
    out
      .filter((r) => r.status !== 'success')
      .slice(0, 2000)
      .forEach((r) => db_('IMPORT_ERRORS').insert({ ErrorID: uuid_(), BatchID: batchId, RowNumber: r.row, Severity: r.status === 'failed' ? 'ERROR' : 'SKIPPED', Message: (r.name ? r.name + ': ' : '') + r.message, CreatedAt: now_() }));
    audit_(user.email, kind + '.import', kind, '', null, { file: rep.fileName, counts: rep.counts });
  }
  return rep;
}
