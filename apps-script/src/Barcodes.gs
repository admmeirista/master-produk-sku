/**
 * Registry barcode: satu kode = satu baris di tab Barcodes, selamanya.
 * Penugasan (BarcodeAssignments) menyimpan histori; hanya boleh SATU penugasan aktif per kode.
 */

function findBarcode_(code) {
  return db_('Barcodes').find((b) => b.code === code);
}

function activeAssignment_(code) {
  return db_('BarcodeAssignments').find((a) => a.code === code && !a.unassigned_at);
}

function ownerInfo_(a) {
  if (!a) return null;
  const p = db_('Products').byId(a.product_id);
  const v = a.variant_id ? db_('Variants').byId(a.variant_id) : null;
  const s = a.sku_id ? db_('SKUs').byId(a.sku_id) : null;
  if (!p) return null;
  return {
    productId: p.id,
    productNo: p.product_no,
    productName: p.name,
    productStatus: p.status,
    variantName: v ? v.name : '',
    skuCode: s ? s.sku_code : null,
    label: `${p.name}${v && v.name ? ' — ' + v.name : ''}${s ? ' (SKU ' + s.sku_code + ')' : ''} [${productNoLabel(p.product_no)}, ${STATUS_LABEL[p.status] || p.status}]`,
  };
}

/**
 * Alokasi barcode internal. Aman konkurensi karena dipanggil di dalam withLock_ (script lock):
 * nomor urut dibaca-dinaikkan secara eksklusif, dan kode yang sudah ada di registry dilewati.
 * Idempoten: requestKey yang sama mengembalikan kode yang sama (mis. klik ganda / retry).
 */
function allocateInternal_(user, count, requestKey, notes) {
  const n = Math.min(Math.max(Number(count) || 1, 1), 100);
  const t = db_('Barcodes');
  if (requestKey) {
    const ex = t.filter((b) => b.request_key === requestKey || (b.request_key || '').indexOf(requestKey + '#') === 0);
    if (ex.length) return ex;
  }
  const prefix = String(getSettings_().internal_barcode_prefix || '200');
  const existing = new Set(t.rows().map((b) => b.code));
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
        code,
        barcode_type: 'internal',
        symbology: 'EAN13',
        status: 'allocated',
        verified_official: false,
        request_key: requestKey ? (n === 1 ? requestKey : `${requestKey}#${out.length + 1}`) : '',
        notes: notes || '',
        allocated_by: user.email,
        allocated_at: now_(),
      }),
    );
  }
  const seqRec = db_('Sequences').find((r) => r.name === 'internal_barcode');
  db_('Sequences').update(seqRec, { value: seq });
  audit_(user.email, 'barcode.allocate_internal', 'barcode', '', null, { codes: out.map((b) => b.code) });
  return out;
}

/**
 * Ubah input barcode (form/import) menjadi record registry yang siap ditugaskan. Tidak menugaskan.
 * input: { mode: 'gtin'|'internal'|'none', code }
 */
function resolveBarcodeInput_(user, input, ctx) {
  if (!input || !input.mode || input.mode === 'none') return null;
  const code = cleanBarcode(input.code);
  const t = db_('Barcodes');
  let rec;
  if (input.mode === 'gtin') {
    const v = validateManufacturerGtin(code);
    if (!v.ok) throw new AppError('Barcode resmi tidak valid', [{ path: ctx.path, message: v.message }], v.errorCode);
    rec = findBarcode_(v.code);
    if (rec && rec.barcode_type === 'internal') throw new AppError('Kode ini terdaftar sebagai barcode internal', [{ path: ctx.path, message: 'Pilih mode "Barcode internal"' }]);
    if (!rec)
      rec = t.insert({ code: v.code, barcode_type: 'gtin', symbology: v.symbology, status: 'allocated', verified_official: false, allocated_by: user.email, allocated_at: now_() });
  } else {
    if (!code) {
      if (ctx.autoAllocate === false) throw new AppError('Kode internal wajib dialokasikan', [{ path: ctx.path, message: 'Klik Alokasikan' }]);
      return allocateInternal_(user, 1, null, ctx.notes || '')[0];
    }
    const v = validateGtin(code);
    if (!v.ok) throw new AppError('Kode internal tidak valid', [{ path: ctx.path, message: v.message }]);
    rec = findBarcode_(v.code);
    if (!rec) throw new AppError('Kode internal belum dialokasikan', [{ path: ctx.path, message: 'Gunakan tombol "Alokasikan" — kode internal tidak boleh diketik bebas' }]);
    if (rec.barcode_type !== 'internal') throw new AppError('Kode ini terdaftar sebagai GTIN resmi', [{ path: ctx.path, message: 'Pilih mode "GTIN produsen"' }]);
  }
  if (rec.status === 'void') throw new AppError(`Barcode ${rec.code} sudah di-void`, [{ path: ctx.path, message: 'Barcode void' }]);
  const a = activeAssignment_(rec.code);
  if (a && a.product_id !== ctx.ownerProductId) {
    const o = ownerInfo_(a);
    throw new AppError(`Barcode ${rec.code} sudah dipakai oleh ${o ? o.label : 'barang lain'}`, [{ path: ctx.path, message: 'Dipakai oleh ' + (o ? o.label : '-'), code: 'BARCODE_IN_USE', data: o }], 'BARCODE_IN_USE');
  }
  if (!a && rec.status === 'retired' && !ctx.allowRetired)
    throw new AppError(`Barcode ${rec.code} pernah dipakai dan sudah dipensiunkan`, [{ path: ctx.path, message: 'Pemakaian ulang hanya lewat change request yang disetujui reviewer' }], 'BARCODE_RETIRED');
  return rec;
}

function assignBarcode_(user, rec, target, reason) {
  db_('BarcodeAssignments').insert({
    id: uuid_(),
    code: rec.code,
    product_id: target.productId,
    variant_id: target.variantId || '',
    sku_id: target.skuId || '',
    assigned_by: user.email,
    assigned_at: now_(),
    reason: reason || '',
  });
  db_('Barcodes').update(rec, { status: 'assigned' });
}

function primaryBarcode_(target) {
  return db_('BarcodeAssignments').find((a) => !a.unassigned_at && (target.variantId ? a.variant_id === target.variantId : a.sku_id === target.skuId));
}

function unassignPrimary_(user, target, reason) {
  const a = primaryBarcode_(target);
  if (!a) return null;
  db_('BarcodeAssignments').update(a, { unassigned_at: now_(), unassigned_by: user.email, reason: (a.reason ? a.reason + ' | ' : '') + 'dilepas: ' + reason });
  // kode yang pernah dipakai tidak kembali "tersedia" — dipensiunkan
  const b = findBarcode_(a.code);
  if (b) db_('Barcodes').update(b, { status: 'retired' });
  return a.code;
}

/** Draft dibangun ulang saat disimpan: lepas penugasannya (kode internal kembali ke status allocated). */
function releaseDraftAssignments_(productId) {
  const t = db_('BarcodeAssignments');
  const codes = t.filter((a) => a.product_id === productId).map((a) => a.code);
  t.deleteWhere((a) => a.product_id === productId);
  codes.forEach((c) => {
    const b = findBarcode_(c);
    if (b && !activeAssignment_(c)) db_('Barcodes').update(b, { status: 'allocated' });
  });
}

function barcodeValidate_(p) {
  const v = p.mode === 'internal' ? validateGtin(p.code) : validateManufacturerGtin(p.code);
  const reg = v.code ? findBarcode_(v.code) : null;
  const a = reg ? activeAssignment_(reg.code) : null;
  const owner = a && a.product_id !== p.productId ? ownerInfo_(a) : null;
  return Object.assign({}, v, { registered: reg ? { type: reg.barcode_type, status: reg.status } : null, owner });
}

function barcodeList_(f) {
  const search = String(f.search || '').toLowerCase();
  const assigns = {};
  db_('BarcodeAssignments').filter((a) => !a.unassigned_at).forEach((a) => (assigns[a.code] = a));
  let rows = db_('Barcodes')
    .rows()
    .map((b) => {
      const o = ownerInfo_(assigns[b.code]);
      return Object.assign({}, b, { owner: o });
    })
    .filter((b) => (!f.type || b.barcode_type === f.type) && (!f.status || b.status === f.status))
    .filter((b) => !search || b.code.indexOf(search) >= 0 || (b.owner && b.owner.productName.toLowerCase().indexOf(search) >= 0));
  rows.sort((a, b) => String(b.allocated_at).localeCompare(String(a.allocated_at)));
  return paginate_(rows, f.page, 50);
}

function barcodeHistory_(code) {
  const b = findBarcode_(code);
  if (!b) throw new AppError('Barcode tidak ditemukan');
  const history = db_('BarcodeAssignments')
    .filter((a) => a.code === code)
    .map((a) => Object.assign({}, a, { owner: ownerInfo_(a) }));
  return { barcode: b, history, validation: validateGtin(code) };
}

function barcodeVoid_(user, code, reason) {
  if (!reason) throw new AppError('Alasan wajib diisi');
  const b = findBarcode_(code);
  if (!b) throw new AppError('Barcode tidak ditemukan');
  if (b.status !== 'allocated' || activeAssignment_(code)) throw new AppError('Hanya barcode yang belum pernah dipakai yang dapat di-void');
  db_('Barcodes').update(b, { status: 'void', notes: (b.notes ? b.notes + ' | ' : '') + 'void: ' + reason });
  audit_(user.email, 'barcode.void', 'barcode', code, null, null, { reason });
  return true;
}

function barcodeVerify_(user, code, note) {
  const b = findBarcode_(code);
  if (!b || b.barcode_type !== 'gtin') throw new AppError('GTIN tidak ditemukan');
  db_('Barcodes').update(b, { verified_official: true, notes: (b.notes ? b.notes + ' | ' : '') + 'verifikasi: ' + (note || '-') });
  audit_(user.email, 'barcode.verify', 'barcode', code, null, null, { note });
  return true;
}

function paginate_(rows, page, size) {
  const p = Math.max(Number(page) || 1, 1);
  return { total: rows.length, page: p, pageSize: size, rows: rows.slice((p - 1) * size, p * size) };
}
