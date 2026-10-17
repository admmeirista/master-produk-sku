/**
 * Registry barcode: satu kode = satu baris di BARCODE_REGISTRY, selamanya.
 * Penugasan (BARCODE_ASSIGNMENTS) menyimpan histori; hanya boleh SATU penugasan aktif per kode, dan
 * target-nya tepat satu: varian (unit dasar) ATAU satuan kemasan yang menjadi trade item sendiri.
 *
 *  - GTIN resmi diinput / dipindai dari barcode produsen; sistem TIDAK pernah membuat GTIN resmi.
 *  - Barang tanpa GTIN produsen boleh memakai barcode internal dari namespace terpisah (EAN-13 prefix 200,
 *    "restricted circulation" GS1 — hanya berlaku di dalam toko, tidak bentrok dengan GTIN resmi).
 */

function findBarcode_(code) {
  return db_('BARCODE_REGISTRY').find((b) => b.Code === code);
}

function activeAssignment_(code) {
  return db_('BARCODE_ASSIGNMENTS').find((a) => a.Code === code && !a.UnassignedAt);
}

function ownerInfo_(a) {
  if (!a) return null;
  const p = db_('MASTER_PRODUCTS').byId(a.ProductID);
  if (!p) return null;
  const v = a.VariantID ? db_('PRODUCT_VARIANTS').byId(a.VariantID) : null;
  const c = a.ConversionID ? db_('UNIT_CONVERSIONS').byId(a.ConversionID) : null;
  const what = c ? `kemasan ${c.UnitName} (SKU ${c.SKU})` : v ? `SKU ${v.SKU}` : '';
  return {
    productId: p.ProductID,
    productNo: productNoLabel(p.ProductNo),
    productName: p.ProductName,
    variantId: a.VariantID || '',
    variantName: v ? v.VariantName : '',
    conversionId: a.ConversionID || '',
    label: `${p.ProductName}${v && v.VariantName ? ' — ' + v.VariantName : ''}${what ? ', ' + what : ''} [${productNoLabel(p.ProductNo)}]`,
  };
}

/** Apakah penugasan a menunjuk target yang sama (kemasan → dibandingkan ConversionID, varian → VariantID). */
function sameTarget_(a, target) {
  if (!a) return false;
  if (target.conversionId) return a.ConversionID === target.conversionId;
  return !a.ConversionID && !!target.variantId && a.VariantID === target.variantId;
}

/**
 * Alokasi barcode internal. Aman konkurensi karena dipanggil di dalam withLock_ (script lock):
 * nomor urut dibaca-dinaikkan secara eksklusif, dan kode yang sudah ada di registry dilewati.
 * Idempoten: requestKey yang sama mengembalikan kode yang sama (mis. klik ganda / retry).
 */
function allocateInternal_(user, count, requestKey, notes) {
  const n = Math.min(Math.max(Number(count) || 1, 1), 100);
  const t = db_('BARCODE_REGISTRY');
  if (requestKey) {
    const ex = t.filter((b) => b.RequestKey === requestKey || (b.RequestKey || '').indexOf(requestKey + '#') === 0);
    if (ex.length) return ex;
  }
  const prefix = String(getSettings_().internal_barcode_prefix || '200');
  const existing = new Set(t.rows().map((b) => b.Code));
  const out = [];
  let seq = nextSeq_('internal_barcode', 0);
  let guard = 0;
  while (out.length < n) {
    if (++guard > n + 20000) throw new AppError('Tidak menemukan kode internal kosong');
    const code = buildInternalBarcode(prefix, seq++);
    if (existing.has(code)) continue;
    existing.add(code);
    out.push(
      t.insert({
        Code: code,
        BarcodeType: 'internal',
        Symbology: 'EAN13',
        Status: 'allocated',
        VerifiedOfficial: false,
        RequestKey: requestKey ? (n === 1 ? requestKey : `${requestKey}#${out.length + 1}`) : '',
        Notes: notes || '',
        AllocatedBy: user.email,
        AllocatedAt: now_(),
      }),
    );
  }
  setSeq_('internal_barcode', seq);
  audit_(user.email, 'barcode.allocate_internal', 'barcode', '', null, { codes: out.map((b) => b.Code) });
  return out;
}

/**
 * Ubah input barcode menjadi record registry yang siap ditugaskan ke target. Tidak menugaskan.
 * input: { mode: 'gtin'|'internal'|'none', code }   target: { productId, variantId, conversionId }
 * Mengembalikan null bila mode 'none'.
 */
function resolveBarcode_(user, input, target, path, notes) {
  if (!input || !input.mode || input.mode === 'none') return null;
  const code = cleanBarcode(input.code);
  const t = db_('BARCODE_REGISTRY');
  let rec;
  if (input.mode === 'gtin') {
    const v = validateManufacturerGtin(code);
    if (!v.ok) throw new AppError('GTIN tidak valid: ' + v.message, [{ path, message: v.message, code: v.errorCode }], 'VALIDATION_FAILED');
    rec = findBarcode_(v.code);
    if (rec && rec.BarcodeType === 'internal') throw new AppError(`Kode ${v.code} terdaftar sebagai barcode internal`, [{ path, message: 'Pilih "Barcode internal"' }], 'VALIDATION_FAILED');
    if (!rec) rec = t.insert({ Code: v.code, BarcodeType: 'gtin', Symbology: v.symbology, Status: 'allocated', VerifiedOfficial: false, Notes: notes || '', AllocatedBy: user.email, AllocatedAt: now_() });
  } else if (input.mode === 'internal') {
    if (!code) return allocateInternal_(user, 1, null, notes || '')[0];
    const v = validateGtin(code);
    if (!v.ok) throw new AppError('Kode internal tidak valid', [{ path, message: v.message }], 'VALIDATION_FAILED');
    rec = findBarcode_(v.code);
    if (!rec) throw new AppError(`Kode internal ${v.code} belum dialokasikan`, [{ path, message: 'Kode internal tidak boleh diketik bebas — kosongkan agar dialokasikan otomatis' }], 'VALIDATION_FAILED');
    if (rec.BarcodeType !== 'internal') throw new AppError(`Kode ${v.code} terdaftar sebagai GTIN resmi`, [{ path, message: 'Pilih "GTIN produsen"' }], 'VALIDATION_FAILED');
  } else throw new AppError('Jenis barcode tidak dikenal', [{ path, message: input.mode }]);
  if (rec.Status === 'void') throw new AppError(`Barcode ${rec.Code} sudah di-void`, [{ path, message: 'Barcode void' }], 'VALIDATION_FAILED');
  const a = activeAssignment_(rec.Code);
  if (a && !sameTarget_(a, target)) {
    const o = ownerInfo_(a);
    throw new AppError(`Barcode ${rec.Code} sudah dipakai oleh ${o ? o.label : 'barang lain'}`, [{ path, message: 'Dipakai oleh ' + (o ? o.label : '-'), code: 'BARCODE_IN_USE', data: o }], 'BARCODE_IN_USE');
  }
  if (!a && rec.Status === 'retired' && !input.allowRetired)
    throw new AppError(`Barcode ${rec.Code} pernah dipakai barang lain dan sudah dipensiunkan`, [{ path, message: 'Barcode bekas tidak boleh dipakai ulang', code: 'BARCODE_RETIRED' }], 'BARCODE_RETIRED');
  return rec;
}

function assignBarcode_(user, rec, target, reason) {
  if (sameTarget_(activeAssignment_(rec.Code), target)) return;
  db_('BARCODE_ASSIGNMENTS').insert({
    AssignmentID: uuid_(),
    Code: rec.Code,
    ProductID: target.productId,
    VariantID: target.conversionId ? '' : target.variantId || '',
    ConversionID: target.conversionId || '',
    AssignedBy: user.email,
    AssignedAt: now_(),
    Reason: reason || '',
  });
  db_('BARCODE_REGISTRY').update(rec, { Status: 'assigned' });
}

/** Lepas barcode dari target. Kode yang pernah dipakai tidak kembali "tersedia" — dipensiunkan. */
function unassignBarcode_(user, code, reason) {
  const a = activeAssignment_(code);
  if (!a) return;
  db_('BARCODE_ASSIGNMENTS').update(a, { UnassignedAt: now_(), UnassignedBy: user.email, Reason: (a.Reason ? a.Reason + ' | ' : '') + 'dilepas: ' + reason });
  const b = findBarcode_(code);
  if (b) db_('BARCODE_REGISTRY').update(b, { Status: 'retired' });
}

/** Cek cepat untuk UI (saat GTIN diketik / dipindai). Tidak menulis apa pun. */
function barcodeValidate_(p) {
  const v = p.mode === 'internal' ? validateGtin(p.code) : validateManufacturerGtin(p.code);
  const reg = v.code ? findBarcode_(v.code) : null;
  const a = reg ? activeAssignment_(reg.Code) : null;
  const target = { variantId: p.variantId || '', conversionId: p.conversionId || '' };
  const owner = a && !sameTarget_(a, target) ? ownerInfo_(a) : null;
  return Object.assign({}, v, { registered: reg ? { type: reg.BarcodeType, status: reg.Status } : null, owner, retired: !a && reg && reg.Status === 'retired' });
}

function barcodeList_(f) {
  const search = String(f.search || '').toLowerCase();
  const assigns = {};
  db_('BARCODE_ASSIGNMENTS')
    .filter((a) => !a.UnassignedAt)
    .forEach((a) => (assigns[a.Code] = a));
  const rows = db_('BARCODE_REGISTRY')
    .rows()
    .map((b) => ({ code: b.Code, type: b.BarcodeType, symbology: b.Symbology, status: b.Status, verified: b.VerifiedOfficial, notes: b.Notes, allocatedBy: b.AllocatedBy, allocatedAt: b.AllocatedAt, owner: ownerInfo_(assigns[b.Code]) }))
    .filter((b) => (!f.type || b.type === f.type) && (!f.status || b.status === f.status))
    .filter((b) => !search || b.code.indexOf(search) >= 0 || (b.owner && b.owner.label.toLowerCase().indexOf(search) >= 0));
  rows.sort((a, b) => String(b.allocatedAt).localeCompare(String(a.allocatedAt)));
  return paginate_(rows, f.page, 50);
}

function barcodeHistory_(code) {
  const b = findBarcode_(code);
  if (!b) throw new AppError('Barcode tidak ditemukan', [], 'NOT_FOUND');
  const history = db_('BARCODE_ASSIGNMENTS')
    .filter((a) => a.Code === code)
    .map((a) => ({ assignedAt: a.AssignedAt, assignedBy: a.AssignedBy, unassignedAt: a.UnassignedAt, unassignedBy: a.UnassignedBy, reason: a.Reason, owner: ownerInfo_(a) }));
  return { barcode: { code: b.Code, type: b.BarcodeType, symbology: b.Symbology, status: b.Status, verified: b.VerifiedOfficial, notes: b.Notes }, history, validation: validateGtin(code) };
}

function barcodeVoid_(user, code, reason) {
  if (!cleanText(reason)) throw new AppError('Alasan wajib diisi');
  const b = findBarcode_(code);
  if (!b) throw new AppError('Barcode tidak ditemukan', [], 'NOT_FOUND');
  if (b.Status !== 'allocated' || activeAssignment_(code)) throw new AppError('Hanya barcode yang belum pernah dipakai yang dapat di-void');
  db_('BARCODE_REGISTRY').update(b, { Status: 'void', Notes: (b.Notes ? b.Notes + ' | ' : '') + 'void: ' + reason });
  audit_(user.email, 'barcode.void', 'barcode', code, null, null, { reason });
  return true;
}

/** Tandai GTIN sudah dicek fisik (kemasan / GS1). Check digit valid ≠ GTIN resmi. */
function barcodeVerify_(user, code, note) {
  const b = findBarcode_(code);
  if (!b || b.BarcodeType !== 'gtin') throw new AppError('GTIN tidak ditemukan', [], 'NOT_FOUND');
  db_('BARCODE_REGISTRY').update(b, { VerifiedOfficial: true, Notes: (b.Notes ? b.Notes + ' | ' : '') + 'verifikasi: ' + (note || '-') });
  audit_(user.email, 'barcode.verify', 'barcode', code, null, null, { note });
  return true;
}
