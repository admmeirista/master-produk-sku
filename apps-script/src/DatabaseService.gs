/**
 * Lapisan data di atas Google Sheets.
 *
 *  - Satu tab = satu tabel (SCHEMA di Config.gs). Baris dibaca SEKALI per eksekusi (batch getValues) lalu di-cache.
 *  - Semua operasi tulis lewat withLock_() (LockService script lock): tidak ada dua pengguna yang menulis
 *    bersamaan, sehingga kode brand/kategori, SKU, nomor urut & barcode internal tidak pernah ganda.
 *  - Google Sheets TIDAK punya transaksi. Strategi yang dipakai:
 *      1. STAGING  — semua perubahan dikumpulkan di memori; validasi gagal = tidak ada yang tertulis.
 *      2. JURNAL   — sebelum menulis, rencana tulis (baris yang ditambah + nilai lama baris yang diubah)
 *                    disimpan ke tab TX_JOURNAL berstatus PENDING.
 *      3. COMMIT   — perubahan ditulis per tabel dengan batch setValues, lalu jurnal ditandai COMMITTED.
 *      4. ROLLBACK — bila penulisan gagal di tengah jalan, perubahan dikembalikan dari jurnal (kompensasi).
 *                    Bila eksekusi terputus total (timeout), jurnal PENDING dibatalkan otomatis pada
 *                    penulisan berikutnya (recoverPending_) — produk tidak pernah tersimpan setengah.
 */

let DB_CACHE_ = {};
function db_(name) {
  if (!DB_CACHE_[name]) DB_CACHE_[name] = new Table_(name);
  return DB_CACHE_[name];
}
function resetDbCache_() {
  DB_CACHE_ = {};
}
let SS_ = null;
function ss_() {
  if (!SS_) {
    if (!DB_SPREADSHEET_ID || DB_SPREADSHEET_ID.indexOf('__') === 0) throw new AppError('DB_SPREADSHEET_ID di Config.gs belum diisi dengan ID file database.');
    SS_ = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
  }
  return SS_;
}
function now_() {
  return new Date().toISOString();
}
function uuid_() {
  return Utilities.getUuid();
}

function rawCell_(x) {
  if (x === null || x === undefined) return '';
  if (x instanceof Date) return x.toISOString();
  return typeof x === 'string' ? x : String(x);
}

class Table_ {
  constructor(name) {
    if (!SCHEMA[name]) throw new AppError('Tabel tidak dikenal: ' + name);
    this.name = name;
    this.cols = SCHEMA[name];
    this.idCol = this.cols[0];
    this.sheet = ss_().getSheetByName(name);
    if (!this.sheet) throw new AppError('Tab "' + name + '" belum ada. Jalankan fungsi setup() dari editor Apps Script.');
    this._all = null;
    this._last = null;
    this._origLast = null;
    this._dirty = new Set();
  }
  rows() {
    if (!this._all) {
      const last = this.sheet.getLastRow();
      this._last = this._origLast = Math.max(last, 1);
      const vals = last > 1 ? this.sheet.getRange(2, 1, last - 1, this.cols.length).getValues() : [];
      this._all = [];
      vals.forEach((v, i) => {
        if (v.every((x) => x === '' || x === null)) return;
        const rec = this.toObj_(v, i + 2);
        Object.defineProperty(rec, '_raw', { value: v.map(rawCell_), enumerable: false });
        this._all.push(rec);
      });
    }
    return this._all;
  }
  find(pred) {
    return this.rows().find(pred) || null;
  }
  filter(pred) {
    return this.rows().filter(pred);
  }
  byId(id) {
    if (!id) return null;
    return this.find((r) => r[this.idCol] === id);
  }
  toObj_(v, rowNum) {
    const o = {};
    Object.defineProperty(o, '_r', { value: rowNum, enumerable: false, writable: true });
    this.cols.forEach((c, i) => (o[c] = parseCell_(c, v[i])));
    return o;
  }
  toRow_(o) {
    return this.cols.map((c) => serializeCell_(c, o[c]));
  }
  insert(obj) {
    this.rows();
    const rec = this.toObj_(this.toRow_(obj), ++this._last);
    this._all.push(rec);
    this._dirty.add(rec);
    return rec;
  }
  insertMany(objs) {
    return objs.map((o) => this.insert(o));
  }
  update(rec, patch) {
    Object.assign(rec, patch);
    const norm = this.toObj_(this.toRow_(rec), rec._r); // samakan tipe dengan nilai yang dibaca dari sheet
    this.cols.forEach((k) => (rec[k] = norm[k]));
    this._dirty.add(rec);
    return rec;
  }
  hasChanges() {
    return this._dirty.size > 0;
  }
  /** Rencana tulis untuk jurnal: posisi baris baru + nilai lama baris yang diubah. */
  plan() {
    const dirty = Array.from(this._dirty);
    const appended = dirty.filter((r) => r._r > this._origLast);
    return {
      table: this.name,
      appendStart: this._origLast + 1,
      appendCount: appended.length ? Math.max.apply(null, appended.map((r) => r._r)) - this._origLast : 0,
      updates: dirty.filter((r) => r._r <= this._origLast).map((r) => ({ row: r._r, before: r._raw })),
    };
  }
  flush() {
    if (!this._dirty.size) return;
    const dirty = Array.from(this._dirty);
    const appended = dirty.filter((r) => r._r > this._origLast).sort((a, b) => a._r - b._r);
    dirty
      .filter((r) => r._r <= this._origLast)
      .sort((a, b) => a._r - b._r)
      .forEach((r) => this.sheet.getRange(r._r, 1, 1, this.cols.length).setValues([this.toRow_(r)]));
    if (appended.length) {
      const values = appended.map((r) => this.toRow_(r));
      this.sheet.getRange(appended[0]._r, 1, values.length, this.cols.length).setNumberFormat('@').setValues(values);
    }
    this._dirty.clear();
  }
}

function parseCell_(col, x) {
  if (x === '' || x === null || x === undefined) return BOOL_COLS[col] ? false : null;
  if (x instanceof Date) return x.toISOString();
  if (NUMBER_COLS[col]) return Number(x);
  if (BOOL_COLS[col]) return x === true || String(x).toUpperCase() === 'TRUE';
  if (JSON_COLS[col]) {
    try {
      return JSON.parse(x);
    } catch (e) {
      return null;
    }
  }
  return String(x);
}

function serializeCell_(col, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (JSON_COLS[col]) {
    const s = JSON.stringify(v);
    return s.length > 49000 ? JSON.stringify({ truncated: true, preview: s.slice(0, 48000) }) : s;
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ------------------------------------------------------------------ jurnal transaksi

const JOURNAL_CHUNK_ = 40000;

function journalSheet_() {
  const sh = ss_().getSheetByName('TX_JOURNAL');
  if (!sh) throw new AppError('Tab "TX_JOURNAL" belum ada. Jalankan fungsi setup() dari editor Apps Script.');
  return sh;
}

function journalAppend_(txId, plan) {
  const sh = journalSheet_();
  const s = JSON.stringify(plan);
  const rows = [];
  for (let i = 0, part = 1; i < s.length || part === 1; i += JOURNAL_CHUNK_, part++) rows.push([txId, String(part), 'PENDING', now_(), s.slice(i, i + JOURNAL_CHUNK_)]);
  const start = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(start, 1, rows.length, 5).setNumberFormat('@').setValues(rows);
  return { start, count: rows.length };
}

function journalMark_(ref, status) {
  const sh = journalSheet_();
  sh.getRange(ref.start, 3, ref.count, 1).setValues(Array.from({ length: ref.count }, () => [status]));
}

/** Kembalikan perubahan sesuai rencana (urutan terbalik). Aman diulang. */
function rollbackPlan_(plan) {
  const ss = ss_();
  plan
    .slice()
    .reverse()
    .forEach((t) => {
      const sh = ss.getSheetByName(t.table);
      if (!sh) return;
      if (t.appendCount) {
        const last = sh.getLastRow();
        if (last >= t.appendStart) sh.deleteRows(t.appendStart, Math.min(t.appendCount, last - t.appendStart + 1));
      }
      t.updates.forEach((u) => sh.getRange(u.row, 1, 1, u.before.length).setValues([u.before]));
    });
}

/** Batalkan transaksi yang terputus (status PENDING) — dipanggil di awal setiap penulisan. */
function recoverPending_() {
  const sh = ss_().getSheetByName('TX_JOURNAL');
  if (!sh) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const vals = sh.getRange(2, 1, last - 1, 5).getValues();
  const pending = {};
  vals.forEach((v, i) => {
    if (String(v[2]) !== 'PENDING') return;
    const id = String(v[0]);
    (pending[id] = pending[id] || []).push({ row: i + 2, part: Number(v[1]), chunk: rawCell_(v[4]) });
  });
  const ids = Object.keys(pending);
  ids.reverse().forEach((id) => {
    const parts = pending[id].sort((a, b) => a.part - b.part);
    let plan = null;
    try {
      plan = JSON.parse(parts.map((p) => p.chunk).join(''));
    } catch (e) {
      plan = null;
    }
    if (plan) rollbackPlan_(plan);
    parts.forEach((p) => sh.getRange(p.row, 3).setValues([[plan ? 'ROLLED_BACK' : 'CORRUPT']]));
    console.error('Transaksi terputus dibatalkan: ' + id);
  });
  if (ids.length) SpreadsheetApp.flush();
  return ids.length;
}

/** Tulis seluruh perubahan yang di-staging. Gagal di tengah = dikembalikan (rollback). */
function commitAll_() {
  const tables = Object.keys(DB_CACHE_)
    .map((k) => DB_CACHE_[k])
    .filter((t) => t.hasChanges());
  if (!tables.length) return;
  const plan = tables.map((t) => t.plan());
  const ref = journalAppend_(uuid_(), plan);
  SpreadsheetApp.flush();
  try {
    tables.forEach((t) => t.flush());
    SpreadsheetApp.flush();
  } catch (e) {
    console.error('Penyimpanan gagal, rollback: ' + (e && e.stack ? e.stack : e));
    try {
      rollbackPlan_(plan);
      journalMark_(ref, 'ROLLED_BACK');
      SpreadsheetApp.flush();
    } catch (e2) {
      console.error('Rollback langsung gagal, akan diulang otomatis pada penulisan berikutnya: ' + e2);
    }
    throw new AppError('Penyimpanan ke Google Sheets gagal dan sudah dibatalkan. Tidak ada data yang tersimpan sebagian. Silakan coba lagi.', [], 'WRITE_FAILED');
  }
  journalMark_(ref, 'COMMITTED');
  try {
    journalSheet_().deleteRows(ref.start, ref.count); // jurnal yang sudah selesai tidak perlu disimpan
  } catch (e) {
    console.error('Gagal membersihkan jurnal: ' + e);
  }
}

/** Semua operasi tulis lewat sini: lock -> pulihkan transaksi terputus -> ubah di memori -> commit. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new AppError('Sistem sedang sibuk melayani pengguna lain. Coba lagi beberapa detik lagi.', [], 'BUSY');
  try {
    resetDbCache_();
    recoverPending_();
    resetDbCache_();
    const out = fn();
    commitAll_();
    return out;
  } finally {
    resetDbCache_();
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------ util tabel

function nextSeq_(name, count) {
  const n = count === undefined ? 1 : count;
  const t = db_('Sequences');
  let rec = t.find((r) => r.name === name);
  if (!rec) rec = t.insert({ name, value: '1' });
  const start = Number(rec.value) || 1;
  if (n) t.update(rec, { value: String(start + n) });
  return start;
}

function setSeq_(name, value) {
  const t = db_('Sequences');
  const rec = t.find((r) => r.name === name);
  if (rec) t.update(rec, { value: String(value) });
  else t.insert({ name, value: String(value) });
}

function getSettings_() {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  db_('Settings')
    .rows()
    .forEach((r) => {
      if (!(r.key in DEFAULT_SETTINGS)) return;
      try {
        s[r.key] = JSON.parse(r.value);
      } catch (e) {
        s[r.key] = r.value;
      }
    });
  return s;
}

function audit_(actor, action, entityType, entityId, before, after, meta) {
  db_('AuditLog').insert({
    id: uuid_(),
    created_at: now_(),
    actor: actor || 'system',
    action,
    entity_type: entityType,
    entity_id: entityId || '',
    before_json: before === undefined ? null : before,
    after_json: after === undefined ? null : after,
    meta_json: meta === undefined ? null : meta,
  });
}

function productNoLabel(n) {
  return n ? 'PRD-' + String(n).padStart(6, '0') : '—';
}

function paginate_(rows, page, size) {
  const p = Math.max(Number(page) || 1, 1);
  return { total: rows.length, page: p, pageSize: size, rows: rows.slice((p - 1) * size, p * size) };
}

function indexBy_(rows, key) {
  const out = {};
  rows.forEach((r) => (out[r[key]] = r));
  return out;
}
