/**
 * Lifecycle Parent SKU (MASTER_PRODUCTS), Child SKU (PRODUCT_VARIANTS) dan bundle (BUNDLE_MASTERS).
 * Transisi eksplisit di LIFECYCLE (Config.gs); setiap perubahan dicatat di PRODUCT_LIFECYCLE_HISTORY + AUDIT_LOGS.
 * Hapus produk = hapus lunak (status Dihapus): baris tetap ada di sheet, tercatat di histori & audit; kode SKU tidak dipakai ulang.
 * Produk yang sudah dipakai (mapping channel, komponen paket, mapping supplier) tidak bisa dihapus — arsipkan saja.
 */

function lifecycleCheck_(from, to, reason, label) {
  const f = from || STATUS.ACTIVE;
  if (f === to) return false;
  if (!LIFECYCLE[f] || LIFECYCLE[f].indexOf(to) < 0)
    throw new AppError(`${label}: status ${STATUS_LABEL[f] || f} tidak dapat diubah menjadi ${STATUS_LABEL[to] || to}`, [{ path: 'status', message: 'Transisi tidak diizinkan' }], 'INVALID_TRANSITION');
  if ((LIFECYCLE_REASON[to] || (f === STATUS.DISCONTINUED && to === STATUS.ACTIVE)) && cleanText(reason).length < 5)
    throw new AppError(`Alasan wajib diisi (min. 5 karakter) untuk mengubah status menjadi ${STATUS_LABEL[to]}`, [{ path: 'reason', message: 'Wajib' }], 'VALIDATION_FAILED');
  return true;
}

function recordLifecycle_(user, entityType, entityId, productId, from, to, reason) {
  db_('PRODUCT_LIFECYCLE_HISTORY').insert({ HistoryID: uuid_(), EntityType: entityType, EntityID: entityId, ProductID: productId || '', FromStatus: from || '', ToStatus: to, Reason: cleanText(reason), ChangedBy: user.email, ChangedAt: now_() });
}

/** Ubah status Parent; Child SKU ikut menyesuaikan bila parent di-discontinue / diarsipkan / diaktifkan dari draft. */
function productSetStatus_(user, input) {
  const p = db_('MASTER_PRODUCTS').byId(input.id);
  if (!p) throw new AppError('Produk tidak ditemukan', [], 'NOT_FOUND');
  const to = input.status;
  if (!LIFECYCLE[to]) throw new AppError('Status tidak dikenal');
  if (!lifecycleCheck_(p.Status, to, input.reason, 'Produk ' + p.ProductName)) return productDetail_(p.ProductID);
  const from = p.Status;
  if (to === STATUS.ACTIVE) {
    const live = db_('PRODUCT_VARIANTS').filter((v) => v.ProductID === p.ProductID && [STATUS.ACTIVE, STATUS.DRAFT].indexOf(v.Status) >= 0);
    if (!live.length) throw new AppError('Produk tidak punya Child SKU yang bisa diaktifkan');
  }
  db_('MASTER_PRODUCTS').update(p, { Status: to, UpdatedBy: user.email, UpdatedAt: now_(), Version: (p.Version || 1) + 1 });
  recordLifecycle_(user, 'product', p.ProductID, p.ProductID, from, to, input.reason);
  // kaskade ke Child SKU
  db_('PRODUCT_VARIANTS')
    .filter((v) => v.ProductID === p.ProductID)
    .forEach((v) => {
      let vto = null;
      if (to === STATUS.ACTIVE && v.Status === STATUS.DRAFT) vto = STATUS.ACTIVE;
      if ((to === STATUS.DISCONTINUED || to === STATUS.ARCHIVED) && LIFECYCLE[v.Status] && LIFECYCLE[v.Status].indexOf(to) >= 0) vto = to;
      if (to === STATUS.DISCONTINUED && v.Status === STATUS.DRAFT) vto = STATUS.ARCHIVED;
      if (!vto) return;
      recordLifecycle_(user, 'variant', v.VariantID, p.ProductID, v.Status, vto, 'Mengikuti status produk: ' + cleanText(input.reason || STATUS_LABEL[to]));
      db_('PRODUCT_VARIANTS').update(v, { Status: vto, UpdatedAt: now_() });
    });
  audit_(user.email, 'product.status', 'product', p.ProductID, { status: from }, { status: to }, { reason: cleanText(input.reason) });
  return productDetail_(p.ProductID);
}

/** Alasan produk tidak boleh dihapus (kosong = boleh). */
function productDeleteBlockers_(p) {
  const out = [];
  const maps = db_('EXTERNAL_SKU_MAPPINGS').filter((m) => m.ProductID === p.ProductID && m.IsActive);
  if (maps.length) out.push(maps.length + ' mapping SKU channel/marketplace');
  const vids = {};
  db_('PRODUCT_VARIANTS').filter((v) => v.ProductID === p.ProductID).forEach((v) => (vids[v.VariantID] = 1));
  const bundles = {};
  db_('BUNDLE_COMPONENTS')
    .filter((c) => vids[c.VariantID] && c.Status !== STATUS.DELETED)
    .forEach((c) => {
      const b = db_('BUNDLE_MASTERS').byId(c.BundleID);
      if (b && b.Status !== STATUS.ARCHIVED && b.Status !== STATUS.DELETED) bundles[b.BundleSKU] = 1;
    });
  if (Object.keys(bundles).length) out.push('komponen paket ' + Object.keys(bundles).join(', '));
  const sup = db_('SUPPLIER_PRODUCT_MAPPING').filter((m) => m.ProductID === p.ProductID && m.Status !== STATUS.DELETED && m.Status !== STATUS.INACTIVE);
  if (sup.length) out.push(sup.length + ' mapping supplier');
  return out;
}

/**
 * Hapus produk (hapus lunak). Parent + seluruh Child SKU berstatus Dihapus; GTIN/barcode dibatalkan (VOID) sehingga GTIN yang
 * salah input bisa didaftarkan lagi di produk yang benar. Kode PRD/SKU & nomor internal tidak dipakai ulang.
 */
function productDelete_(user, input) {
  const p = db_('MASTER_PRODUCTS').byId(input && input.id);
  if (!p || p.Status === STATUS.DELETED) throw new AppError('Produk tidak ditemukan atau sudah dihapus', [], 'NOT_FOUND');
  const reason = cleanText(input.reason);
  if (reason.length < 5) throw new AppError('Alasan hapus wajib diisi (min. 5 karakter)', [{ path: 'reason', message: 'Wajib' }], 'VALIDATION_FAILED');
  const blockers = productDeleteBlockers_(p);
  if (blockers.length)
    throw new AppError('Produk ' + p.ProductName + ' tidak dapat dihapus karena masih dipakai: ' + blockers.join('; ') + '. Ubah statusnya menjadi Discontinued / Diarsipkan saja.', [], 'IN_USE');
  const from = p.Status;
  const variants = db_('PRODUCT_VARIANTS').filter((v) => v.ProductID === p.ProductID);
  const voided = [];
  db_('VARIANT_BARCODES')
    .filter((b) => b.ProductID === p.ProductID && (b.Status === 'ACTIVE' || b.Status === 'ALLOCATED'))
    .forEach((b) => {
      voided.push(b.Code);
      db_('VARIANT_BARCODES').update(b, { Status: 'VOID', RetiredBy: user.email, RetiredAt: now_(), Reason: (b.Reason ? b.Reason + ' | ' : '') + 'produk dihapus: ' + reason });
    });
  variants.forEach((v) => {
    if (v.Status === STATUS.DELETED) return;
    recordLifecycle_(user, 'variant', v.VariantID, p.ProductID, v.Status, STATUS.DELETED, 'Produk dihapus: ' + reason);
    db_('PRODUCT_VARIANTS').update(v, { Status: STATUS.DELETED, UpdatedAt: now_() });
  });
  db_('MASTER_PRODUCTS').update(p, { Status: STATUS.DELETED, UpdatedBy: user.email, UpdatedAt: now_(), Version: (p.Version || 1) + 1 });
  recordLifecycle_(user, 'product', p.ProductID, p.ProductID, from, STATUS.DELETED, reason);
  audit_(user.email, 'product.delete', 'product', p.ProductID, { status: from, name: p.ProductName, code: p.ProductCode, skus: variants.map((v) => v.SKU) }, { status: STATUS.DELETED }, { reason, barcodesVoided: voided });
  return { id: p.ProductID, productCode: p.ProductCode, name: p.ProductName, skus: variants.length, barcodesVoided: voided.length };
}

/** Ubah status satu Child SKU (tanpa menghapus — SKU & barcode tetap tercatat). */
function variantSetStatus_(user, input) {
  const v = db_('PRODUCT_VARIANTS').byId(input.id);
  if (!v) throw new AppError('Varian tidak ditemukan', [], 'NOT_FOUND');
  const to = input.status;
  if (!LIFECYCLE[to]) throw new AppError('Status tidak dikenal');
  if (!lifecycleCheck_(v.Status, to, input.reason, 'SKU ' + v.SKU)) return variantView_(v, []);
  if (to !== STATUS.ACTIVE) {
    const others = db_('PRODUCT_VARIANTS').filter((x) => x.ProductID === v.ProductID && x.VariantID !== v.VariantID && x.Status === STATUS.ACTIVE);
    const p = db_('MASTER_PRODUCTS').byId(v.ProductID);
    if (!others.length && p && p.Status === STATUS.ACTIVE) throw new AppError('Child SKU terakhir yang aktif tidak dapat dinonaktifkan. Ubah status produknya.');
  }
  const from = v.Status;
  db_('PRODUCT_VARIANTS').update(v, { Status: to, UpdatedAt: now_() });
  recordLifecycle_(user, 'variant', v.VariantID, v.ProductID, from, to, input.reason);
  touchProduct_(user, v.ProductID);
  audit_(user.email, 'variant.status', 'variant', v.VariantID, { status: from }, { status: to, sku: v.SKU }, { productId: v.ProductID, reason: cleanText(input.reason) });
  return variantView_(v, []);
}

function lifecycleHistory_(productId) {
  return db_('PRODUCT_LIFECYCLE_HISTORY')
    .filter((h) => h.ProductID === productId || h.EntityID === productId)
    .slice()
    .reverse()
    .map((h) => ({ entityType: h.EntityType, entityId: h.EntityID, from: h.FromStatus, to: h.ToStatus, reason: h.Reason, by: h.ChangedBy, at: h.ChangedAt }));
}

/** Apakah Child SKU boleh dipakai untuk mapping / komponen bundle BARU. */
function assertUsableVariant_(v, path) {
  if (!v) throw new AppError('Child SKU tidak ditemukan', [{ path, message: 'Tidak ditemukan' }], 'NOT_FOUND');
  const p = db_('MASTER_PRODUCTS').byId(v.ProductID) || {};
  if (v.Status !== STATUS.ACTIVE || p.Status !== STATUS.ACTIVE)
    throw new AppError(`SKU ${v.SKU} berstatus ${STATUS_LABEL[v.Status !== STATUS.ACTIVE ? v.Status : p.Status]} — hanya SKU aktif yang dapat dipakai untuk mapping/bundle baru`, [{ path, message: 'SKU tidak aktif' }], 'VALIDATION_FAILED');
  return p;
}

/**
 * Controlled deprecation (pengganti merge): bila dua Child SKU ternyata barang yang sama, SKU duplikat di-DISCONTINUE,
 * ditandai "digantikan oleh" SKU utama, dan (opsional) mapping supplier/channel aktif dipindahkan. Tidak ada data dihapus.
 */
function variantDeprecate_(user, input) {
  const dup = db_('PRODUCT_VARIANTS').byId(input.id);
  const keep = db_('PRODUCT_VARIANTS').byId(input.replacedBy);
  if (!dup || !keep) throw new AppError('SKU tidak ditemukan', [], 'NOT_FOUND');
  if (dup.VariantID === keep.VariantID) throw new AppError('SKU pengganti harus berbeda');
  if (cleanText(input.reason).length < 5) throw new AppError('Alasan wajib diisi (min. 5 karakter)', [{ path: 'reason', message: 'Wajib' }], 'VALIDATION_FAILED');
  assertUsableVariant_(keep, 'replacedBy');
  if (keep.ReplacedByVariantID) throw new AppError('SKU pengganti sendiri sudah digantikan SKU lain');
  const moved = { supplier: 0, channel: 0, bundle: 0 };
  if (input.moveMappings) {
    db_('SUPPLIER_PRODUCT_MAPPING')
      .filter((m) => m.VariantID === dup.VariantID && m.Status === STATUS.ACTIVE)
      .forEach((m) => {
        db_('SUPPLIER_PRODUCT_MAPPING').update(m, { VariantID: keep.VariantID, ProductID: keep.ProductID, UpdatedBy: user.email, UpdatedAt: now_() });
        moved.supplier++;
      });
    db_('EXTERNAL_SKU_MAPPINGS')
      .filter((m) => m.VariantID === dup.VariantID && m.IsActive && m.System !== 'legacy')
      .forEach((m) => {
        db_('EXTERNAL_SKU_MAPPINGS').update(m, { VariantID: keep.VariantID, ProductID: keep.ProductID, InternalSku: keep.SKU, MappingStatus: 'mapped', Notes: (m.Notes ? m.Notes + ' | ' : '') + 'dipindah dari ' + dup.SKU, UpdatedAt: now_() });
        moved.channel++;
      });
    db_('BUNDLE_COMPONENTS')
      .filter((c) => c.VariantID === dup.VariantID && c.Status === STATUS.ACTIVE)
      .forEach((c) => {
        db_('BUNDLE_COMPONENTS').update(c, { VariantID: keep.VariantID });
        moved.bundle++;
      });
  }
  const from = dup.Status;
  const to = from === STATUS.ARCHIVED ? STATUS.ARCHIVED : STATUS.DISCONTINUED;
  db_('PRODUCT_VARIANTS').update(dup, { Status: to, ReplacedByVariantID: keep.VariantID, UpdatedAt: now_() });
  if (from !== to) recordLifecycle_(user, 'variant', dup.VariantID, dup.ProductID, from, to, 'Digantikan ' + keep.SKU + ': ' + cleanText(input.reason));
  touchProduct_(user, dup.ProductID);
  audit_(user.email, 'variant.deprecate', 'variant', dup.VariantID, { status: from, sku: dup.SKU }, { status: to, replacedBy: keep.SKU, moved }, { productId: dup.ProductID, reason: cleanText(input.reason) });
  return { sku: dup.SKU, replacedBy: keep.SKU, moved };
}
