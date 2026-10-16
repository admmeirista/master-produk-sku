/**
 * Lapisan data di atas Google Sheets.
 *  - Satu tab = satu tabel (SCHEMA di Config.gs). Baris dibaca sekali per eksekusi lalu di-cache.
 *  - Semua operasi tulis dibungkus withLock_() (LockService script lock) => tidak ada dua pengguna yang
 *    menulis bersamaan, sehingga alokasi SKU/barcode/nomor urut tidak pernah ganda.
 *  - Sheets tidak punya rollback. Karena itu semua penulisan DI-BUFFER di memori dan baru ditulis ke sheet
 *    setelah seluruh validasi & perubahan dalam satu aksi sukses (flushAll_). Bila ada error, buffer dibuang.
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

class Table_ {
  constructor(name) {
    this.name = name;
    this.cols = SCHEMA[name];
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
        this._all.push(this.toObj_(v, i + 2));
      });
    }
    return this._all.filter((r) => !r._deleted);
  }
  find(pred) {
    return this.rows().find(pred) || null;
  }
  filter(pred) {
    return this.rows().filter(pred);
  }
  byId(id) {
    return this.find((r) => r.id === id);
  }
  toObj_(v, rowNum) {
    const o = { _r: rowNum };
    this.cols.forEach((c, i) => (o[c] = parseCell_(c, v[i])));
    return o;
  }
  toRow_(o) {
    return this.cols.map((c) => serializeCell_(c, o[c]));
  }
  insert(obj) {
    return this.insertMany([obj])[0];
  }
  insertMany(objs) {
    this.rows();
    return objs.map((o) => {
      const rec = this.toObj_(this.toRow_(o), ++this._last);
      this._all.push(rec);
      this._dirty.add(rec);
      return rec;
    });
  }
  update(rec, patch) {
    Object.assign(rec, patch);
    const norm = this.toObj_(this.toRow_(rec), rec._r); // samakan tipe dengan nilai yang dibaca dari sheet
    Object.keys(norm).forEach((k) => (rec[k] = norm[k]));
    this._dirty.add(rec);
    return rec;
  }
  /** Hapus baris fisik — hanya untuk anak-anak draft yang belum pernah dipakai di luar sistem. */
  deleteWhere(pred) {
    const victims = this.rows().filter(pred);
    victims.forEach((r) => {
      r._deleted = true;
      this._dirty.add(r);
    });
    return victims.length;
  }
  flush() {
    if (!this._dirty.size) return;
    const dirty = Array.from(this._dirty);
    const appended = dirty.filter((r) => r._r > this._origLast).sort((a, b) => a._r - b._r);
    dirty
      .filter((r) => r._r <= this._origLast && !r._deleted)
      .forEach((r) => this.sheet.getRange(r._r, 1, 1, this.cols.length).setValues([this.toRow_(r)]));
    if (appended.length) {
      const values = appended.map((r) => (r._deleted ? this.cols.map(() => '') : this.toRow_(r)));
      this.sheet.getRange(appended[0]._r, 1, values.length, this.cols.length).setNumberFormat('@').setValues(values);
    }
    dirty
      .filter((r) => r._deleted)
      .map((r) => r._r)
      .sort((a, b) => b - a)
      .forEach((rowNum) => this.sheet.deleteRow(rowNum));
    this._dirty.clear();
    this._all = null;
  }
}

function flushAll_() {
  Object.keys(DB_CACHE_).forEach((k) => DB_CACHE_[k].flush());
}

function parseCell_(col, x) {
  if (x === '' || x === null || x === undefined) return BOOL_COLS[col] ? false : null;
  if (x instanceof Date) return x.toISOString();
  if (NUMERIC_COLS[col]) return Number(x);
  if (BOOL_COLS[col]) return x === true || String(x).toUpperCase() === 'TRUE';
  if (/_json$/.test(col)) {
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
  if (/_json$/.test(col)) {
    const s = JSON.stringify(v);
    return s.length > 49000 ? JSON.stringify({ truncated: true, preview: s.slice(0, 48000) }) : s;
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Semua operasi tulis lewat sini: lock -> baca data terbaru -> ubah di memori -> tulis sekaligus. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new AppError('Sistem sedang sibuk melayani pengguna lain. Coba lagi beberapa detik lagi.', [], 'BUSY');
  try {
    resetDbCache_();
    const out = fn();
    flushAll_();
    SpreadsheetApp.flush();
    return out;
  } finally {
    resetDbCache_();
    lock.releaseLock();
  }
}

function nextSeq_(name, count) {
  const n = count || 1;
  const t = db_('Sequences');
  let rec = t.find((r) => r.name === name);
  if (!rec) rec = t.insert({ name, value: 1 });
  const start = Number(rec.value) || 1;
  t.update(rec, { value: start + n });
  return start;
}

function getSettings_() {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  db_('Settings').rows().forEach((r) => {
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

function approval_(p) {
  db_('ApprovalHistory').insert({
    id: uuid_(),
    request_id: p.requestId || '',
    entity_type: p.entityType,
    entity_id: p.entityId,
    action: p.action,
    from_status: p.from || '',
    to_status: p.to || '',
    actor: p.actor,
    reason: p.reason || '',
    created_at: now_(),
  });
}

function productNoLabel(n) {
  return n ? 'PRD-' + String(n).padStart(6, '0') : '—';
}
