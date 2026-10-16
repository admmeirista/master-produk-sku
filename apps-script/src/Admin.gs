/**
 * Referensi (brand/kategori), pengguna, pengaturan, dashboard, kualitas data, audit.
 */

const REF_TABLE = { brand: 'Brands', category: 'Categories' };
const REF_LABEL = { brand: 'Brand', category: 'Kategori' };

function refList_(kind) {
  const col = kind === 'brand' ? 'brand_id' : 'category_id';
  const counts = {};
  db_('Products').filter((p) => p.status !== 'archived').forEach((p) => (counts[p[col]] = (counts[p[col]] || 0) + 1));
  return db_(REF_TABLE[kind])
    .rows()
    .map((r) => Object.assign({}, r, { product_count: counts[r.id] || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function refSave_(user, kind, input) {
  const T = db_(REF_TABLE[kind]);
  const code = normalizeCode(input.code);
  const name = cleanText(input.name);
  if (!/^[A-Z0-9]{2,6}$/.test(code)) throw new AppError('Kode harus 2–6 huruf/angka');
  if (!name) throw new AppError('Nama wajib diisi');
  const nn = normalizeName(name);
  const others = T.filter((r) => r.status !== 'rejected' && r.id !== input.id);
  const byCode = others.find((r) => r.code === code);
  if (byCode) throw new AppError(`Kode ${code} sudah dipakai oleh ${byCode.name}`, [], 'DUPLICATE');
  const byName = others.find((r) => r.name_norm === nn);
  if (byName) throw new AppError(`${REF_LABEL[kind]} "${byName.name}" sudah terdaftar (kode ${byName.code})`, [], 'DUPLICATE');
  const similar = others.map((r) => ({ r, s: nameSimilarity(name, r.name) })).filter((x) => x.s >= 0.85);
  if (similar.length && !input.acknowledgeSimilar)
    throw new AppError(`Ada ${REF_LABEL[kind].toLowerCase()} dengan nama mirip. Pastikan bukan duplikat.`, similar.map((x) => ({ message: `${x.r.name} (${x.r.code}) — ${Math.round(x.s * 100)}%` })), 'SIMILAR_EXISTS');
  if (input.id) {
    assertPerm_(user, 'reference.manage');
    const rec = T.byId(input.id);
    if (!rec) throw new AppError('Data tidak ditemukan');
    if (rec.code !== code) {
      const col = kind === 'brand' ? 'brand_id' : 'category_id';
      const used = db_('Products').filter((p) => p[col] === rec.id && ['active', 'inactive', 'approved'].indexOf(p.status) >= 0).length;
      if (used) throw new AppError(`Kode tidak dapat diubah: sudah dipakai ${used} produk aktif. SKU lama tetap memakai kode lama.`);
    }
    const before = Object.assign({}, rec);
    T.update(rec, { code, name, name_norm: nn, manufacturer: input.manufacturer || '', notes: input.notes || '', updated_at: now_(), version: (rec.version || 1) + 1 });
    audit_(user.email, kind + '.update', kind, rec.id, before, rec);
    return rec;
  }
  const manage = can_(user, 'reference.manage');
  if (!manage) assertPerm_(user, 'reference.propose');
  const rec = T.insert({
    id: uuid_(), code, name, name_norm: nn, manufacturer: input.manufacturer || '', notes: input.notes || '', status: manage ? 'active' : 'pending',
    proposed_by: user.email, approved_by: manage ? user.email : '', approved_at: manage ? now_() : '', created_at: now_(), updated_at: now_(), version: 1,
  });
  audit_(user.email, kind + (manage ? '.create' : '.propose'), kind, rec.id, null, rec);
  return rec;
}

function refStatus_(user, kind, id, action, reason) {
  const T = db_(REF_TABLE[kind]);
  const rec = T.byId(id);
  if (!rec) throw new AppError('Data tidak ditemukan');
  const map = { approve: [['pending'], 'active'], reject: [['pending'], 'rejected'], deactivate: [['active'], 'inactive'], activate: [['inactive'], 'active'] };
  if (!map[action] || map[action][0].indexOf(rec.status) < 0) throw new AppError('Aksi tidak diizinkan untuk status ini');
  if ((action === 'reject' || action === 'deactivate') && !cleanText(reason)) throw new AppError('Alasan wajib diisi');
  if (action === 'approve' && rec.proposed_by === user.email && user.role !== 'admin') throw new AppError('Usulan tidak dapat disetujui oleh pengusulnya sendiri', [], 'FORBIDDEN');
  const before = rec.status;
  T.update(rec, Object.assign({ status: map[action][1], updated_at: now_() }, action === 'approve' ? { approved_by: user.email, approved_at: now_() } : {}));
  audit_(user.email, kind + '.' + action, kind, id, { status: before }, { status: rec.status }, reason ? { reason } : null);
  return rec;
}

// ------------------------------------------------------------------ Users & settings

function userList_() {
  return db_('Users').rows().map(publicUser_);
}

function userUpdate_(actor, id, input) {
  const u = db_('Users').byId(id);
  if (!u) throw new AppError('User tidak ditemukan');
  if (id === actor.id && (input.isActive === false || (input.role && input.role !== 'admin'))) throw new AppError('Tidak dapat menonaktifkan / menurunkan role akun sendiri');
  const patch = { updated_at: now_() };
  if (input.fullName) patch.full_name = cleanText(input.fullName);
  if (input.role) {
    if (ROLES.indexOf(input.role) < 0) throw new AppError('Role tidak valid');
    patch.role = input.role;
  }
  if (input.isActive !== undefined) patch.is_active = !!input.isActive;
  if (input.password) {
    if (String(input.password).length < 10) throw new AppError('Password minimal 10 karakter');
    patch.pw_salt = newSalt_();
    patch.pw_hash = hashPassword_(input.password, patch.pw_salt);
    patch.failed_logins = 0;
    patch.locked_until = '';
  }
  const before = publicUser_(u);
  db_('Users').update(u, patch);
  audit_(actor.email, 'user.update', 'user', id, before, Object.assign(publicUser_(u), { passwordChanged: !!input.password }));
  return publicUser_(u);
}

function changeOwnPassword_(user, oldPw, newPw) {
  const u = db_('Users').byId(user.id);
  if (hashPassword_(String(oldPw), u.pw_salt) !== u.pw_hash) throw new AppError('Password lama salah');
  if (!newPw || String(newPw).length < 10) throw new AppError('Password baru minimal 10 karakter');
  const salt = newSalt_();
  db_('Users').update(u, { pw_salt: salt, pw_hash: hashPassword_(newPw, salt), updated_at: now_() });
  audit_(user.email, 'user.change_password', 'user', user.id);
  return true;
}

function settingsSave_(user, input) {
  const before = getSettings_();
  const allowed = { sku_template: 1, maker_checker: 1, auto_activate_on_approve: 1, fuzzy_threshold: 1 };
  if (input.sku_template !== undefined) {
    const errs = validateSkuTemplate(String(input.sku_template));
    if (errs.length) throw new AppError(errs.join('; '));
  }
  if (input.fuzzy_threshold !== undefined && !(Number(input.fuzzy_threshold) >= 0.5 && Number(input.fuzzy_threshold) <= 0.99)) throw new AppError('Ambang fuzzy 0.5 – 0.99');
  Object.keys(input).forEach((k) => {
    if (!allowed[k]) return;
    const val = k === 'fuzzy_threshold' ? Number(input[k]) : k === 'sku_template' ? String(input[k]).toUpperCase() : !!input[k];
    const rec = db_('Settings').find((r) => r.key === k);
    if (rec) db_('Settings').update(rec, { value: JSON.stringify(val), updated_by: user.email, updated_at: now_() });
    else db_('Settings').insert({ key: k, value: JSON.stringify(val), updated_by: user.email, updated_at: now_() });
  });
  const after = Object.assign({}, before);
  Object.keys(input).forEach((k) => allowed[k] && (after[k] = input[k]));
  audit_(user.email, 'settings.update', 'settings', '', before, after);
  return after;
}

// ------------------------------------------------------------------ Dashboard & kualitas data

function dashboard_() {
  const P = db_('Products').rows();
  const S = db_('SKUs').rows();
  const bcType = {};
  db_('Barcodes').rows().forEach((b) => (bcType[b.code] = b.barcode_type));
  const gtinVariants = {};
  db_('BarcodeAssignments').filter((a) => !a.unassigned_at && a.variant_id && bcType[a.code] === 'gtin').forEach((a) => (gtinVariants[a.variant_id] = 1));
  const liveProducts = {};
  P.forEach((p) => ['active', 'approved'].indexOf(p.status) >= 0 && (liveProducts[p.id] = 1));
  const confirmed = {};
  db_('Mappings').filter((m) => m.is_active && m.system === 'beecloud' && m.mapping_status === 'confirmed').forEach((m) => (confirmed[m.sku_id] = 1));
  const byStatus = {};
  P.forEach((p) => (byStatus[p.status] = (byStatus[p.status] || 0) + 1));
  const brandName = {};
  db_('Brands').rows().forEach((b) => (brandName[b.id] = b.name));
  const prodBrand = {};
  P.forEach((p) => (prodBrand[p.id] = brandName[p.brand_id]));
  const byBrand = {};
  S.filter((s) => s.status === 'active').forEach((s) => (byBrand[prodBrand[s.product_id]] = (byBrand[prodBrand[s.product_id]] || 0) + 1));
  const reqs = db_('Requests').filter((r) => r.status === 'pending_review');
  const pname = {};
  P.forEach((p) => (pname[p.id] = p.name));
  return {
    counts: {
      brands: db_('Brands').filter((b) => b.status === 'active').length,
      brands_pending: db_('Brands').filter((b) => b.status === 'pending').length + db_('Categories').filter((b) => b.status === 'pending').length,
      products: P.filter((p) => p.status !== 'archived').length,
      products_active: byStatus.active || 0,
      products_draft: byStatus.draft || 0,
      variants: db_('Variants').filter((v) => v.status !== 'archived').length,
      skus_active: S.filter((s) => s.status === 'active').length,
      pending_registrations: reqs.filter((r) => r.request_type === 'new_product').length,
      pending_changes: reqs.filter((r) => r.request_type === 'change').length,
      variants_without_gtin: db_('Variants').filter((v) => v.status === 'active' && liveProducts[v.product_id] && !gtinVariants[v.id]).length,
      duplicate_candidates: similarPairs_(1000).length,
      skus_not_synced_beecloud: S.filter((s) => s.status === 'active' && !confirmed[s.id]).length,
      mapping_problems: db_('Mappings').filter((m) => m.is_active && ['mismatch', 'error'].indexOf(m.mapping_status) >= 0).length,
    },
    byStatus: Object.keys(byStatus).map((k) => ({ status: k, label: STATUS_LABEL[k], n: byStatus[k] })),
    byBrand: Object.keys(byBrand).map((k) => ({ name: k, n: byBrand[k] })).sort((a, b) => b.n - a.n).slice(0, 10),
    pending: reqs.slice(0, 8).map((r) => ({ id: r.id, product_id: r.product_id, product_name: pname[r.product_id], request_type: r.request_type, submitted_by: r.submitted_by, submitted_at: r.submitted_at })),
    recent: db_('AuditLog').rows().slice(-12).reverse().map((a) => ({ id: a.id, action: a.action, actor: a.actor, created_at: a.created_at, entity_type: a.entity_type })),
  };
}

function dataQuality_() {
  const P = {};
  db_('Products').rows().forEach((p) => (P[p.id] = p));
  const live = (pid) => P[pid] && P[pid].status !== 'archived';
  const bcType = {};
  db_('Barcodes').rows().forEach((b) => (bcType[b.code] = b.barcode_type));
  const varBc = {};
  db_('BarcodeAssignments').filter((a) => !a.unassigned_at && a.variant_id).forEach((a) => (varBc[a.variant_id] = a.code));
  const V = db_('Variants').filter((v) => v.status !== 'archived' && live(v.product_id));
  const S = db_('SKUs').filter((s) => s.status !== 'archived' && live(s.product_id));
  const row = (pid, extra) => Object.assign({ product_id: pid, product: (P[pid] || {}).name, productNo: productNoLabel((P[pid] || {}).product_no) }, extra);
  const sections = {
    similarNames: similarPairs_(300),
    variantsNoBarcode: V.filter((v) => !varBc[v.id] && ['active', 'approved', 'pending_review', 'inactive'].indexOf(P[v.product_id].status) >= 0).map((v) => row(v.product_id, { variant: v.name })),
    internalOnly: V.filter((v) => varBc[v.id] && bcType[varBc[v.id]] === 'internal').map((v) => row(v.product_id, { variant: v.name, barcode: varBc[v.id] })),
    missingPrices: S.filter((s) => s.status === 'active' && (s.selling_price === null || (s.sku_type !== 'bundle' && s.purchase_price === null))).map((s) => row(s.product_id, { sku: s.sku_code, purchase_price: s.purchase_price, selling_price: s.selling_price })),
    negativeMargin: S.filter((s) => s.purchase_price !== null && s.selling_price !== null && s.selling_price < s.purchase_price).map((s) => row(s.product_id, { sku: s.sku_code, purchase_price: s.purchase_price, selling_price: s.selling_price })),
    multipackNoSingle: V.filter((v) => S.some((s) => s.variant_id === v.id && s.sku_type === 'multipack') && !S.some((s) => s.variant_id === v.id && s.sku_type === 'single')).map((v) => row(v.product_id, { variant: v.name })),
    mappingProblems: db_('Mappings').filter((m) => m.is_active && ['mismatch', 'error'].indexOf(m.mapping_status) >= 0).map((m) => {
      const s = db_('SKUs').byId(m.sku_id) || {};
      return row(s.product_id, { system: m.system, sku: s.sku_code, status: m.mapping_status, error: m.last_error });
    }),
    shopeeSkuMismatch: db_('Mappings').filter((m) => m.is_active && m.system === 'shopee').filter((m) => {
      const s = db_('SKUs').byId(m.sku_id) || {};
      return m.external_sku && String(m.external_sku).toUpperCase() !== String(s.sku_code).toUpperCase();
    }).map((m) => row((db_('SKUs').byId(m.sku_id) || {}).product_id, { listing: m.external_product_id, seller_sku: m.external_sku })),
    unverifiedGtin: db_('Barcodes').filter((b) => b.barcode_type === 'gtin' && b.status === 'assigned' && !b.verified_official).map((b) => ({ barcode: b.code })),
  };
  const summary = {};
  Object.keys(sections).forEach((k) => (summary[k] = sections[k].length));
  return Object.assign({ summary }, sections);
}

function auditList_(f) {
  let rows = db_('AuditLog').rows().slice().reverse();
  if (f.entityType) rows = rows.filter((a) => a.entity_type === f.entityType);
  if (f.action) rows = rows.filter((a) => a.action.indexOf(f.action) >= 0);
  if (f.entityId) rows = rows.filter((a) => a.entity_id === f.entityId);
  return paginate_(rows, f.page, 50);
}
