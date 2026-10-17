/**
 * Barcode varian & kemasan (VARIANT_BARCODES). Tiga identitas dibedakan tegas:
 *   - GTIN produsen  : diinput / dipindai dari kemasan; sistem TIDAK pernah membuat GTIN resmi.
 *   - Barcode internal: EAN-13 prefix 200 (GS1 "restricted circulation") untuk barang tanpa GTIN produsen.
 *   - SKU internal   : kode SKU000001 milik aplikasi (bukan barcode).
 *
 * Status baris: ACTIVE (terpasang ke varian/kemasan) · ALLOCATED (barcode internal dicadangkan, belum terpasang)
 *               · RETIRED (pernah dipakai, dilepas — tidak boleh dipakai barang lain) · VOID (cadangan dibatalkan).
 * Satu kode hanya boleh punya SATU baris ACTIVE/ALLOCATED. Semua kode disimpan sebagai teks.
 */

function liveBarcodeRow_(code) {
  return db_('VARIANT_BARCODES').find((b) => b.Code === code && (b.Status === 'ACTIVE' || b.Status === 'ALLOCATED'));
}

function barcodeRows_(code) {
  return db_('VARIANT_BARCODES').filter((b) => b.Code === code);
}

function ownerInfo_(b) {
  if (b && b.BundleID) {
    const bd = db_('BUNDLE_MASTERS').byId(b.BundleID);
    return bd ? { productId: '', bundleId: bd.BundleID, productCode: bd.BundleSKU, productName: bd.BundleName, variantId: '', variantName: '', conversionId: '', label: `Bundle ${bd.BundleName} [${bd.BundleSKU}]` } : null;
  }
  if (!b || !b.ProductID) return null;
  const p = db_('MASTER_PRODUCTS').byId(b.ProductID);
  if (!p) return null;
  const c = b.ConversionID ? db_('UNIT_CONVERSIONS').byId(b.ConversionID) : null;
  const v = db_('PRODUCT_VARIANTS').byId(b.VariantID || (c && c.VariantID));
  const what = c ? `kemasan ${c.UnitName}${c.SKU ? ' (SKU ' + c.SKU + ')' : ''}` : v ? `SKU ${v.SKU}` : '';
  return {
    productId: p.ProductID,
    productCode: p.ProductCode,
    productName: p.ProductName,
    variantId: v ? v.VariantID : '',
    variantName: v ? v.VariantName : '',
    conversionId: b.ConversionID || '',
    label: `${p.ProductName}${v && !v.IsDefault ? ' — ' + v.VariantName : ''}${what ? ', ' + what : ''} [${p.ProductCode}]`,
  };
}

/** Apakah baris barcode menunjuk target yang sama (kemasan → ConversionID, varian → VariantID). */
function sameTarget_(b, target) {
  if (!b) return false;
  if (target.bundleId) return b.BundleID === target.bundleId;
  if (b.BundleID) return false;
  if (target.conversionId) return b.ConversionID === target.conversionId;
  return !b.ConversionID && !!target.variantId && b.VariantID === target.variantId;
}

/**
 * Alokasi barcode internal (status ALLOCATED). Aman konkurensi karena dipanggil di dalam withLock_:
 * nomor urut dibaca-dinaikkan secara eksklusif dan kode yang pernah ada dilewati.
 * Idempoten: requestKey yang sama mengembalikan kode yang sama (klik ganda / retry).
 */
function allocateInternal_(user, count, requestKey, notes) {
  const n = Math.min(Math.max(Number(count) || 1, 1), 100);
  const t = db_('VARIANT_BARCODES');
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
        BarcodeID: uuid_(),
        Code: code,
        BarcodeType: 'INTERNAL',
        Symbology: 'EAN13',
        Status: 'ALLOCATED',
        VerifiedOfficial: false,
        RequestKey: requestKey ? (n === 1 ? requestKey : `${requestKey}#${out.length + 1}`) : '',
        Notes: notes || '',
        CreatedBy: user.email,
        CreatedAt: now_(),
      }),
    );
  }
  setSeq_('internal_barcode', seq);
  audit_(user.email, 'barcode.allocate_internal', 'barcode', '', null, { codes: out.map((b) => b.Code) });
  return out;
}

/**
 * Pasang barcode ke target { productId, variantId, conversionId }. input: { mode: 'gtin'|'internal'|'none', code }.
 * Mengembalikan baris VARIANT_BARCODES yang aktif, atau null untuk mode 'none'. Melempar AppError (dengan path) bila konflik.
 */
function attachBarcode_(user, input, target, path, notes, reason) {
  if (!input || !input.mode || input.mode === 'none') return null;
  const code = cleanBarcode(input.code);
  const t = db_('VARIANT_BARCODES');
  let row;
  if (input.mode === 'gtin') {
    const v = validateManufacturerGtin(code);
    if (!v.ok) throw new AppError('GTIN tidak valid: ' + v.message, [{ path, message: v.message, code: v.errorCode }], 'VALIDATION_FAILED');
    row = liveBarcodeRow_(v.code);
    if (row && row.BarcodeType === 'INTERNAL') throw new AppError(`Kode ${v.code} terdaftar sebagai barcode internal`, [{ path, message: 'Pilih "Internal"' }], 'VALIDATION_FAILED');
    if (row && row.Status === 'ACTIVE' && !sameTarget_(row, target)) throw inUseError_(row, path);
    if (!row) {
      const retired = barcodeRows_(v.code).filter((b) => b.Status === 'RETIRED');
      if (retired.length && !retired.some((b) => sameTarget_(b, target)))
        throw new AppError(`Barcode ${v.code} pernah dipakai barang lain dan sudah dipensiunkan`, [{ path, message: 'Barcode bekas tidak boleh dipakai ulang untuk barang lain', code: 'BARCODE_RETIRED' }], 'BARCODE_RETIRED');
      row = t.insert({ BarcodeID: uuid_(), Code: v.code, BarcodeType: 'GTIN', Symbology: v.symbology, Status: 'ALLOCATED', VerifiedOfficial: false, Notes: notes || '', CreatedBy: user.email, CreatedAt: now_() });
    }
  } else if (input.mode === 'internal') {
    if (!code) row = allocateInternal_(user, 1, null, notes || '')[0];
    else {
      const v = validateGtin(code);
      if (!v.ok) throw new AppError('Kode internal tidak valid', [{ path, message: v.message }], 'VALIDATION_FAILED');
      row = liveBarcodeRow_(v.code);
      if (!row) throw new AppError(`Kode internal ${v.code} belum dialokasikan`, [{ path, message: 'Kode internal tidak boleh diketik bebas — kosongkan agar dialokasikan otomatis' }], 'VALIDATION_FAILED');
      if (row.BarcodeType !== 'INTERNAL') throw new AppError(`Kode ${v.code} terdaftar sebagai GTIN produsen`, [{ path, message: 'Pilih "GTIN"' }], 'VALIDATION_FAILED');
      if (row.Status === 'ACTIVE' && !sameTarget_(row, target)) throw inUseError_(row, path);
    }
  } else throw new AppError('Jenis barcode tidak dikenal', [{ path, message: input.mode }]);
  if (row.Status !== 'ACTIVE') {
    db_('VARIANT_BARCODES').update(row, { Status: 'ACTIVE', ProductID: target.productId || '', VariantID: target.conversionId || target.bundleId ? '' : target.variantId || '', ConversionID: target.conversionId || '', BundleID: target.bundleId || '', Reason: reason || 'registrasi', CreatedBy: row.CreatedBy || user.email });
  }
  return row;
}

function inUseError_(row, path) {
  const o = ownerInfo_(row);
  return new AppError(`Barcode ${row.Code} sudah dipakai oleh ${o ? o.label : 'barang lain'}`, [{ path, message: 'Dipakai oleh ' + (o ? o.label : '-'), code: 'BARCODE_IN_USE', data: o }], 'BARCODE_IN_USE');
}

/** Lepas barcode aktif. Kode yang pernah dipakai tidak kembali tersedia — dipensiunkan (RETIRED). */
function retireBarcode_(user, code, reason) {
  const row = db_('VARIANT_BARCODES').find((b) => b.Code === code && b.Status === 'ACTIVE');
  if (!row) return;
  db_('VARIANT_BARCODES').update(row, { Status: 'RETIRED', RetiredBy: user.email, RetiredAt: now_(), Reason: (row.Reason ? row.Reason + ' | ' : '') + 'dilepas: ' + reason });
}

/** Cek cepat untuk UI (saat GTIN diketik / dipindai). Tidak menulis apa pun. */
function barcodeValidate_(p) {
  const v = p.mode === 'internal' ? validateGtin(p.code) : validateManufacturerGtin(p.code);
  const row = v.code ? liveBarcodeRow_(v.code) : null;
  const target = { variantId: p.variantId || '', conversionId: p.conversionId || '', bundleId: p.bundleId || '' };
  const owner = row && row.Status === 'ACTIVE' && !sameTarget_(row, target) ? ownerInfo_(row) : null;
  const retired = !row && v.code && barcodeRows_(v.code).some((b) => b.Status === 'RETIRED' && !sameTarget_(b, target));
  return Object.assign({}, v, { registered: row ? { type: row.BarcodeType, status: row.Status } : null, owner, retired: !!retired });
}

/**
 * Scan barcode: cari kode di GTIN / barcode internal / SKU internal / SKU lama & eksternal.
 * Kode yang bukan GTIN valid TIDAK pernah dianggap GTIN resmi.
 */
function barcodeLookup_(raw) {
  const code = cleanBarcode(raw);
  const up = String(raw || '').trim().toUpperCase();
  if (!code && !up) throw new AppError('Scan atau ketik barcode / SKU');
  const matches = [];
  const seen = {};
  const push = (via, variantId, conversionId, extra) => {
    const key = via + '|' + variantId + '|' + (conversionId || '');
    if (seen[key]) return;
    seen[key] = 1;
    const v = db_('PRODUCT_VARIANTS').byId(variantId);
    if (!v) return;
    const p = db_('MASTER_PRODUCTS').byId(v.ProductID);
    if (!p) return;
    const b = db_('MASTER_BRANDS').byId(p.BrandID) || {};
    const c = conversionId ? db_('UNIT_CONVERSIONS').byId(conversionId) : null;
    matches.push(Object.assign({ via, productId: p.ProductID, productCode: p.ProductCode, productName: p.ProductName, productStatus: p.Status, brandName: b.BrandName, variantId: v.VariantID, variantName: v.IsDefault ? '' : v.VariantName, variantStatus: v.Status, sku: v.SKU, gtin: v.GTIN, internalBarcode: v.InternalBarcode, baseUnit: p.BaseUnit, conversion: c ? { unitName: c.UnitName, baseUnitEquivalent: c.BaseUnitEquivalent, sku: c.SKU } : null }, extra || {}));
  };
  const bundles = [];
  const pushBundle = (via, bd) => bd && !bundles.some((x) => x.bundleId === bd.BundleID) && bundles.push({ via, bundleId: bd.BundleID, bundleSku: bd.BundleSKU, bundleName: bd.BundleName, type: bd.BundleType, stockMode: bd.StockMode, status: bd.Status });
  const row = code ? liveBarcodeRow_(code) : null;
  if (row && row.Status === 'ACTIVE' && row.BundleID) pushBundle(row.BarcodeType === 'GTIN' ? 'GTIN produsen' : 'Barcode internal', db_('BUNDLE_MASTERS').byId(row.BundleID));
  db_('BUNDLE_MASTERS')
    .filter((b) => b.BundleSKU === up)
    .forEach((b) => pushBundle('SKU bundle', b));
  supplierCodeLookup_(up).forEach((m) => push('Kode supplier ' + m.supplierName, m.variantId, '', { supplierCode: m.supplierProductCode }));
  if (row && row.Status === 'ACTIVE' && !row.BundleID) {
    const conv = row.ConversionID ? db_('UNIT_CONVERSIONS').byId(row.ConversionID) : null;
    push(row.BarcodeType === 'GTIN' ? 'GTIN produsen' : 'Barcode internal', row.VariantID || (conv && conv.VariantID), row.ConversionID);
  }
  db_('PRODUCT_VARIANTS')
    .filter((v) => v.SKU && v.SKU.toUpperCase() === up)
    .forEach((v) => push('SKU internal', v.VariantID));
  db_('UNIT_CONVERSIONS')
    .filter((c) => c.SKU && c.SKU.toUpperCase() === up)
    .forEach((c) => push('SKU kemasan', c.VariantID, c.ConversionID));
  db_('EXTERNAL_SKU_MAPPINGS')
    .filter((m) => m.IsActive && String(m.ExternalSku).toUpperCase() === up)
    .forEach((m) => {
      const via = m.System === 'legacy' ? 'SKU lama' : 'SKU ' + (CHANNEL_LABEL[m.System] || m.System);
      if (m.BundleID) return pushBundle(via, db_('BUNDLE_MASTERS').byId(m.BundleID));
      push(via, m.VariantID || (db_('UNIT_CONVERSIONS').byId(m.ConversionID) || {}).VariantID, m.ConversionID);
    });
  const gtin = validateManufacturerGtin(code);
  const anyGtin = validateGtin(code);
  const kind = gtin.ok ? 'gtin' : anyGtin.ok && /^2|^02|^04/.test(code) ? 'internal' : /^\d+$/.test(code) && code.length >= 8 ? 'invalid_numeric' : 'text';
  const retiredRows = code ? barcodeRows_(code).filter((b) => b.Status === 'RETIRED') : [];
  return {
    code: kind === 'text' ? up : code,
    kind,
    validation: gtin.ok ? { ok: true, symbology: gtin.symbology } : { ok: false, message: anyGtin.ok ? anyGtin.warnings[0] || gtin.message : anyGtin.message || gtin.message },
    found: matches.length > 0 || bundles.length > 0,
    matches,
    bundles,
    retired: !matches.length && !bundles.length && retiredRows.length ? retiredRows.map((b) => ({ retiredAt: b.RetiredAt, reason: b.Reason, owner: ownerInfo_(b) })) : [],
    reserved: row && row.Status === 'ALLOCATED' ? { type: row.BarcodeType, notes: row.Notes } : null,
  };
}

function barcodeList_(f) {
  f = f || {};
  const search = String(f.search || '').toLowerCase();
  const rows = db_('VARIANT_BARCODES')
    .rows()
    .filter((b) => (!f.type || b.BarcodeType === f.type) && (!f.status || b.Status === f.status))
    .map((b) => ({ id: b.BarcodeID, code: b.Code, type: b.BarcodeType, symbology: b.Symbology, status: b.Status, verified: b.VerifiedOfficial, notes: b.Notes, createdBy: b.CreatedBy, createdAt: b.CreatedAt, retiredAt: b.RetiredAt, reason: b.Reason, owner: ownerInfo_(b) }))
    .filter((b) => !search || b.code.indexOf(search) >= 0 || (b.owner && b.owner.label.toLowerCase().indexOf(search) >= 0));
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return paginate_(rows, f.page, 50);
}

function barcodeHistory_(code) {
  const rows = barcodeRows_(code);
  if (!rows.length) throw new AppError('Barcode tidak ditemukan', [], 'NOT_FOUND');
  const live = rows.find((b) => b.Status === 'ACTIVE' || b.Status === 'ALLOCATED') || rows[rows.length - 1];
  return {
    barcode: { code, type: live.BarcodeType, symbology: live.Symbology, status: live.Status, verified: live.VerifiedOfficial, notes: live.Notes },
    history: rows.map((b) => ({ status: b.Status, assignedAt: b.CreatedAt, assignedBy: b.CreatedBy, retiredAt: b.RetiredAt, retiredBy: b.RetiredBy, reason: b.Reason, owner: ownerInfo_(b) })),
    validation: validateGtin(code),
  };
}

function barcodeVoid_(user, code, reason) {
  if (!cleanText(reason)) throw new AppError('Alasan wajib diisi');
  const row = db_('VARIANT_BARCODES').find((b) => b.Code === code && b.Status === 'ALLOCATED');
  if (!row) throw new AppError('Hanya barcode internal cadangan (belum pernah dipakai) yang dapat di-void');
  db_('VARIANT_BARCODES').update(row, { Status: 'VOID', Reason: cleanText(reason), RetiredBy: user.email, RetiredAt: now_() });
  audit_(user.email, 'barcode.void', 'barcode', code, null, null, { reason });
  return true;
}

/** Tandai GTIN sudah dicek fisik (kemasan / GS1). Check digit valid ≠ GTIN resmi. */
function barcodeVerify_(user, code, note) {
  const row = db_('VARIANT_BARCODES').find((b) => b.Code === code && b.Status === 'ACTIVE' && b.BarcodeType === 'GTIN');
  if (!row) throw new AppError('GTIN aktif tidak ditemukan', [], 'NOT_FOUND');
  db_('VARIANT_BARCODES').update(row, { VerifiedOfficial: true, Notes: (row.Notes ? row.Notes + ' | ' : '') + 'verifikasi: ' + (note || '-') });
  audit_(user.email, 'barcode.verify', 'barcode', code, null, null, { note });
  return true;
}
