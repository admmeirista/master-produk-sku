/**
 * Workflow: Draft → Menunggu Review → Disetujui → Aktif (+ Ditolak, Nonaktif, Diarsipkan).
 * Maker-checker: pembuat/pengaju tidak boleh menyetujui miliknya sendiri (bila diaktifkan).
 * Produk yang sudah disetujui hanya berubah lewat Change Request yang disetujui reviewer.
 */

function transitionProduct_(user, productId, action, opts) {
  opts = opts || {};
  const p = db_('Products').byId(productId);
  if (!p) throw new AppError('Produk tidak ditemukan');
  const ownDraftArchive = action === 'archive' && ['draft', 'rejected'].indexOf(p.status) >= 0 && can_(user, 'product.write');
  if (!ACTION_PERM[action]) throw new AppError('Aksi tidak dikenal');
  if (!can_(user, ACTION_PERM[action]) && !ownDraftArchive) throw new AppError('Anda tidak memiliki hak akses untuk tindakan ini', [], 'FORBIDDEN');
  if (opts.version !== undefined && opts.version !== null && Number(opts.version) !== p.version)
    throw new AppError('Data sudah diubah oleh pengguna lain. Muat ulang halaman.', [], 'STALE_VERSION');
  const from = p.status;
  const to = (TRANSITIONS[from] || {})[action];
  if (!to) throw new AppError(`Aksi tidak diizinkan dari status "${STATUS_LABEL[from]}"`);
  const reason = cleanText(opts.reason) || '';
  if (REASON_REQUIRED.indexOf(action) >= 0 && !reason) throw new AppError('Alasan wajib diisi', [{ path: 'reason', message: 'Alasan wajib diisi' }], 'VALIDATION_FAILED');
  const settings = getSettings_();
  let requestId = '';
  let warnings = [];

  if (action === 'submit') {
    const issues = completeness_(productId);
    if (issues.length) throw new AppError('Data belum lengkap untuk diajukan', issues, 'VALIDATION_FAILED');
    const dups = checkSavedProduct_(productId);
    const blocking = dups.filter((d) => d.severity === 'block');
    if (blocking.length) throw new AppError('Terdeteksi duplikasi identitas', blocking.map((d) => ({ message: d.message, data: d })), 'DUPLICATE');
    warnings = dups.filter((d) => d.severity === 'warn');
    if (warnings.length && !opts.acknowledgeWarnings)
      throw new AppError('Ada produk dengan nama mirip. Tinjau dulu sebelum mengajukan.', warnings.map((d) => ({ message: d.message, data: d })), 'DUPLICATE_WARNING');
    if (db_('Requests').find((r) => r.product_id === productId && r.status === 'pending_review')) throw new AppError('Produk ini sudah memiliki permintaan yang menunggu review');
    requestId = uuid_();
    db_('Requests').insert({
      id: requestId,
      request_no: nextSeq_('request_no'),
      request_type: 'new_product',
      product_id: productId,
      status: 'pending_review',
      reason,
      payload_json: { duplicateWarnings: warnings },
      submitted_by: user.email,
      submitted_at: now_(),
    });
  }

  if (['approve', 'reject', 'activate'].indexOf(action) >= 0) {
    const req = db_('Requests')
      .filter((r) => r.product_id === productId && r.request_type === 'new_product')
      .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];
    requestId = req ? req.id : '';
    if (action === 'approve' && settings.maker_checker && ((req && req.submitted_by === user.email) || p.created_by === user.email))
      throw new AppError('Maker-checker aktif: Anda tidak dapat menyetujui registrasi yang Anda buat/ajukan sendiri', [], 'FORBIDDEN');
    if (action !== 'reject') {
      const issues = completeness_(productId);
      if (issues.length) throw new AppError('Data belum lengkap', issues, 'VALIDATION_FAILED');
      const blocking = checkSavedProduct_(productId).filter((d) => d.severity === 'block');
      if (blocking.length) throw new AppError('Terdeteksi duplikasi identitas', blocking.map((d) => ({ message: d.message })), 'DUPLICATE');
    }
    if (req && req.status === 'pending_review' && (action === 'approve' || action === 'reject'))
      db_('Requests').update(req, { status: action === 'approve' ? 'approved' : 'rejected', reviewed_by: user.email, reviewed_at: now_(), review_reason: reason });
  }

  if (action === 'archive') {
    const skuIds = db_('SKUs').filter((s) => s.product_id === productId).map((s) => s.id);
    const used = db_('Mappings').filter((m) => m.is_active && skuIds.indexOf(m.sku_id) >= 0 && ['exported', 'confirmed'].indexOf(m.mapping_status) >= 0);
    if (used.length) throw new AppError(`Produk sudah dipakai di BeeCloud/Shopee (${used.length} mapping aktif). Nonaktifkan mapping dulu — produk yang sudah bertransaksi tidak boleh dihapus.`);
  }

  const finalStatus = action === 'approve' && settings.auto_activate_on_approve ? 'active' : to;
  const patch = { status: finalStatus, version: p.version + 1, updated_at: now_(), updated_by: user.email };
  if (action === 'submit') Object.assign(patch, { submitted_by: user.email, submitted_at: now_() });
  if (action === 'approve') Object.assign(patch, { approved_by: user.email, approved_at: now_() });
  if (finalStatus === 'active' && from !== 'inactive') patch.activated_at = now_();
  if (finalStatus === 'archived') patch.archived_at = now_();
  db_('Products').update(p, patch);

  const skus = db_('SKUs').filter((s) => s.product_id === productId);
  if (finalStatus === 'active') skus.forEach((s) => (s.status === 'draft' || (from === 'inactive' && s.status === 'inactive')) && db_('SKUs').update(s, { status: 'active', updated_at: now_() }));
  if (finalStatus === 'inactive') skus.forEach((s) => s.status === 'active' && db_('SKUs').update(s, { status: 'inactive', updated_at: now_() }));
  if (finalStatus === 'archived') {
    skus.forEach((s) => db_('SKUs').update(s, { status: 'archived', updated_at: now_() }));
    db_('Variants').filter((v) => v.product_id === productId).forEach((v) => db_('Variants').update(v, { status: 'archived' }));
  }
  approval_({ requestId, entityType: 'product', entityId: productId, action, from, to: finalStatus, actor: user.email, reason });
  audit_(user.email, 'product.' + action, 'product', productId, { status: from }, { status: finalStatus }, reason ? { reason } : null);
  return { status: finalStatus, warnings };
}

// ------------------------------------------------------------------ Change request

const CHANGE_OPS = ['update_product', 'update_variant', 'add_variant', 'add_sku', 'change_barcode', 'change_sku_code', 'set_sku_status'];

function createChangeRequest_(user, productId, input) {
  const reason = cleanText(input.reason);
  if (reason.length < 5) throw new AppError('Alasan perubahan wajib diisi (min. 5 karakter)', [{ path: 'reason', message: 'Wajib' }]);
  const ops = input.operations || [];
  if (!ops.length) throw new AppError('Tambahkan minimal satu perubahan');
  ops.forEach((o) => {
    if (CHANGE_OPS.indexOf(o.op) < 0) throw new AppError('Jenis perubahan tidak dikenal: ' + o.op);
  });
  const p = db_('Products').byId(productId);
  if (!p) throw new AppError('Produk tidak ditemukan');
  if (['approved', 'active', 'inactive'].indexOf(p.status) < 0) throw new AppError('Change request hanya untuk produk yang sudah disetujui/aktif. Draft dapat diedit langsung.');
  if (db_('Requests').find((r) => r.product_id === productId && r.status === 'pending_review')) throw new AppError('Produk ini masih memiliki permintaan yang menunggu review', [], 'DUPLICATE');
  const before = productDetail_(productId);
  // Validasi kering: terapkan di memori lalu buang (penulisan Sheets di-buffer, jadi tidak ada yang tertulis)
  applyOperations_(user, productId, ops, { dryRun: true, reason });
  resetDbCache_();
  const req = db_('Requests').insert({
    id: uuid_(),
    request_no: nextSeq_('request_no'),
    request_type: 'change',
    product_id: productId,
    status: 'pending_review',
    reason,
    payload_json: { operations: ops },
    before_json: { name: before.name, variants: before.variants.map((v) => ({ id: v.id, name: v.name, barcode: v.barcode, skus: v.skus.map((s) => ({ id: s.id, sku_code: s.sku_code, pack_qty: s.pack_qty })) })) },
    submitted_by: user.email,
    submitted_at: now_(),
  });
  approval_({ requestId: req.id, entityType: 'product', entityId: productId, action: 'change_requested', actor: user.email, reason });
  audit_(user.email, 'change_request.create', 'request', req.id, null, { productId, operations: ops, reason });
  return { id: req.id, request_no: req.request_no };
}

function decideChangeRequest_(user, requestId, decision, reason) {
  const req = db_('Requests').byId(requestId);
  if (!req) throw new AppError('Permintaan tidak ditemukan');
  if (req.request_type !== 'change') throw new AppError('Registrasi baru diproses lewat aksi Setujui/Tolak produk');
  if (req.status !== 'pending_review') throw new AppError('Permintaan ini sudah diproses', [], 'CONFLICT');
  const settings = getSettings_();
  if (decision === 'cancel') {
    if (req.submitted_by !== user.email && user.role !== 'admin') throw new AppError('Hanya pengaju yang dapat membatalkan', [], 'FORBIDDEN');
  } else {
    assertPerm_(user, 'product.review');
    if (settings.maker_checker && req.submitted_by === user.email) throw new AppError('Maker-checker aktif: Anda tidak dapat memutuskan permintaan yang Anda ajukan sendiri', [], 'FORBIDDEN');
  }
  if (decision === 'reject' && !cleanText(reason)) throw new AppError('Alasan penolakan wajib diisi');
  if (decision === 'approve') {
    applyOperations_(user, req.product_id, req.payload_json.operations, { dryRun: false, reason: req.reason, requestId, maker: req.submitted_by });
    const p = db_('Products').byId(req.product_id);
    db_('Products').update(p, { version: p.version + 1, updated_at: now_(), updated_by: user.email });
  }
  const status = decision === 'approve' ? 'applied' : decision === 'reject' ? 'rejected' : 'cancelled';
  db_('Requests').update(req, { status, reviewed_by: user.email, reviewed_at: now_(), review_reason: reason || '' });
  approval_({ requestId, entityType: 'product', entityId: req.product_id, action: 'change_' + status, actor: user.email, reason });
  audit_(user.email, 'change_request.' + decision, 'request', requestId, req.before_json, null, { reason });
  return { status };
}

function applyOperations_(actor, productId, ops, ctx) {
  const p = productCtx_(productId);
  const skuStatus = p.status === 'active' ? 'active' : 'draft';
  const variantOf = (id) => {
    const v = db_('Variants').byId(id);
    if (!v || v.product_id !== productId || v.status === 'archived') throw new AppError('Varian tidak ditemukan');
    return v;
  };
  const skuOf = (id) => {
    const s = db_('SKUs').byId(id);
    if (!s || s.product_id !== productId) throw new AppError('SKU tidak ditemukan');
    return s;
  };
  ops.forEach((op, i) => {
    const path = 'operations.' + i;
    if (op.op === 'update_product') {
      const patch = {};
      if (op.name) {
        const n = cleanText(op.name);
        if (n.length < 3) throw new AppError('Nama minimal 3 karakter', [{ path, message: 'Nama' }]);
        Object.assign(patch, { name: n, name_norm: normalizeName(n), token_key: tokenKey(n) });
      }
      if (op.description !== undefined) patch.description = cleanText(op.description);
      if (op.categoryId) {
        const c = db_('Categories').byId(op.categoryId);
        if (!c || c.status !== 'active') throw new AppError('Kategori tidak aktif', [{ path, message: 'Kategori' }]);
        patch.category_id = op.categoryId; // SKU yang sudah terbit tidak berubah
      }
      db_('Products').update(p, Object.assign(patch, { updated_at: now_() }));
    } else if (op.op === 'update_variant') {
      const v = variantOf(op.variantId);
      const patch = {};
      if (op.name !== undefined) patch.name = cleanText(op.name);
      if (op.attributes) {
        const sig = attributeSignature(op.attributes);
        if (db_('Variants').find((x) => x.product_id === productId && x.id !== v.id && x.status !== 'archived' && x.signature === sig))
          throw new AppError('Kombinasi atribut sudah dipakai varian lain', [{ path, message: 'Atribut' }]);
        Object.assign(patch, { attributes_json: op.attributes, signature: sig });
      }
      db_('Variants').update(v, patch);
    } else if (op.op === 'add_variant') {
      if (!p.has_variants) db_('Products').update(p, { has_variants: true });
      const count = db_('Variants').filter((v) => v.product_id === productId).length;
      insertVariantTree_(actor, p, op.variant, { index: count, skuStatus, strict: true, productName: p.name, isDefault: false });
    } else if (op.op === 'add_sku') {
      const v = variantOf(op.variantId);
      if (op.sku.skuType !== 'bundle' && db_('SKUs').find((x) => x.variant_id === v.id && x.pack_qty === Number(op.sku.packQty) && x.status !== 'archived'))
        throw new AppError(`Varian sudah memiliki kemasan isi ${op.sku.packQty}`, [{ path, message: 'Isi ganda' }], 'DUPLICATE');
      const a = primaryBarcode_({ variantId: v.id });
      insertSku_(actor, p, v, a ? a.code : null, op.sku, { status: skuStatus, path, strict: true, productName: p.name });
    } else if (op.op === 'change_barcode') {
      if (!op.variantId === !op.skuId) throw new AppError('Pilih tepat satu target: varian atau SKU');
      if (op.variantId) variantOf(op.variantId);
      if (op.skuId) skuOf(op.skuId);
      const target = op.variantId ? { productId, variantId: op.variantId } : { productId, skuId: op.skuId };
      unassignPrimary_(actor, target, ctx.reason);
      const rec = resolveBarcodeInput_(actor, op.barcode, { path: path + '.barcode', ownerProductId: productId, allowRetired: true });
      if (rec) assignBarcode_(actor, rec, target, ctx.reason);
      const affected = db_('SKUs').filter((s) => (op.skuId ? s.id === op.skuId : s.variant_id === op.variantId)).map((s) => s.id);
      db_('Mappings')
        .filter((m) => m.is_active && affected.indexOf(m.sku_id) >= 0 && ['exported', 'confirmed'].indexOf(m.mapping_status) >= 0)
        .forEach((m) => db_('Mappings').update(m, { mapping_status: 'mismatch', last_error: 'Barcode berubah — verifikasi di sistem eksternal', updated_at: now_() }));
    } else if (op.op === 'change_sku_code') {
      const s = skuOf(op.skuId);
      const code = String(op.newCode || '').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9\-_.\/]{2,63}$/.test(code)) throw new AppError('Format SKU tidak valid', [{ path, message: 'Huruf besar, angka, - _ . /' }]);
      assertSkuFree_(code, path, s.id);
      const old = s.sku_code;
      db_('SKUs').update(s, { sku_code: code, sku_source: 'manual', updated_at: now_() });
      db_('SkuCodeHistory').insert({ id: uuid_(), sku_id: s.id, old_code: old || '', new_code: code, reason: ctx.reason, request_id: ctx.requestId || '', changed_by: actor.email, changed_at: now_() });
      db_('Mappings')
        .filter((m) => m.sku_id === s.id && m.is_active)
        .forEach((m) => db_('Mappings').update(m, { mapping_status: 'mismatch', last_error: `SKU internal berubah dari ${old} — perbarui SKU di sistem eksternal`, updated_at: now_() }));
    } else if (op.op === 'set_sku_status') {
      const s = skuOf(op.skuId);
      if (['active', 'inactive'].indexOf(op.status) < 0 || ['draft', 'archived'].indexOf(s.status) >= 0) throw new AppError('Status SKU tidak dapat diubah');
      db_('SKUs').update(s, { status: op.status, updated_at: now_() });
    }
  });
  if (!ctx.dryRun) {
    const pp = db_('Products').byId(productId);
    db_('SKUs')
      .filter((s) => s.product_id === productId)
      .forEach((s) => {
        const v = db_('Variants').byId(s.variant_id) || {};
        const base = cleanText([pp.name, v.name].filter(Boolean).join(' - '));
        const dn = packDisplayName(base, s.pack_qty, s.sku_type === 'bundle' ? 'SET' : 'PCS');
        if (s.sku_source !== 'legacy_import' && s.display_name !== dn) db_('SKUs').update(s, { display_name: dn });
      });
    audit_(actor.email, 'product.change_applied', 'product', productId, null, { operations: ops }, { requestId: ctx.requestId, maker: ctx.maker });
  }
}

function listRequests_(user, f) {
  const prods = {};
  db_('Products').rows().forEach((p) => (prods[p.id] = p));
  const brands = {};
  db_('Brands').rows().forEach((b) => (brands[b.id] = b.name));
  return db_('Requests')
    .filter((r) => (!f.status || r.status === f.status) && (!f.type || r.request_type === f.type))
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
    .slice(0, 300)
    .map((r) => {
      const p = prods[r.product_id] || {};
      return Object.assign({}, r, { product_name: p.name, productNo: productNoLabel(p.product_no), product_status: p.status, product_created_by: p.created_by, brand_name: brands[p.brand_id] });
    });
}
