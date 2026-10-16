/**
 * Emulator minimal layanan Google Apps Script untuk menjalankan file .gs di Node (khusus pengujian).
 * Meniru: SpreadsheetApp (sheet = array 2D berisi string), LockService, CacheService, Utilities, Session.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

class Range {
  constructor(sheet, r, c, nr, nc) {
    Object.assign(this, { sheet, r, c, nr, nc });
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
      out.push(o);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((v) => v.length !== this.nc)) throw new Error('Ukuran setValues tidak cocok dengan range');
    vals.forEach((row, i) => {
      const target = (this.sheet.data[this.r - 1 + i] = this.sheet.data[this.r - 1 + i] || []);
      row.forEach((v, j) => (target[this.c - 1 + j] = v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v)));
    });
    this.sheet.writes++;
    return this;
  }
  setNumberFormat() {
    return this;
  }
  setFontWeight() {
    return this;
  }
  setBackground() {
    return this;
  }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.data = [];
    this.writes = 0;
  }
  getName() {
    return this.name;
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getMaxRows() {
    return Math.max(1000, this.data.length);
  }
  getMaxColumns() {
    return 30;
  }
  insertColumnsAfter() {}
  getRange(r, c, nr = 1, nc = 1) {
    return new Range(this, r, c, nr, nc);
  }
  deleteRow(r) {
    this.data.splice(r - 1, 1);
  }
  setFrozenRows() {}
  clear() {
    this.data = [];
  }
  getSheetId() {
    return 0;
  }
  getProtections() {
    return [];
  }
  protect() {
    const p = { setDescription: () => p, setWarningOnly: () => p };
    return p;
  }
}

function createGas({ ownerEmail = 'owner@toko.local' } = {}) {
  const sheets = new Map();
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => {
      const s = new Sheet(n);
      sheets.set(n, s);
      return s;
    },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.name),
    getName: () => 'Master Produk DB',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/dev',
    copy: (name) => ({ getUrl: () => 'https://docs.google.com/copy/' + encodeURIComponent(name) }),
  };
  const cache = new Map();
  const toSigned = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
  const ctx = {
    console: { log() {}, error: (...a) => console.error(...a) },
    SpreadsheetApp: { getActive: () => ss, openById: () => ss, flush() {}, ProtectionType: { SHEET: 'SHEET' } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => ownerEmail }), getActiveUser: () => ({ getEmail: () => '' }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => toSigned(crypto.createHash(alg).update(String(s), 'utf8').digest()),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
      formatDate: (d) => d.toISOString().slice(0, 16).replace(/[-:T]/g, ''),
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({}) },
    HtmlService: {},
  };
  vm.createContext(ctx);
  const order = ['Config', 'Lib', 'Db', 'Auth', 'Barcodes', 'Products', 'Duplicates', 'Workflow', 'Mappings', 'Imports', 'Admin', 'Api'];
  const src = order.map((f) => fs.readFileSync(path.join(__dirname, '../src', f + '.gs'), 'utf8')).join('\n;\n');
  vm.runInContext(src.replace("'__DB_SPREADSHEET_ID__'", "'test-db'").replace(/const DB_SPREADSHEET_ID = '[^']*';/, "const DB_SPREADSHEET_ID = 'test-db';"), ctx, { filename: 'apps-script-bundle.js' });
  return { ctx, ss, sheets, cache };
}

module.exports = { createGas };
