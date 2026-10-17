/**
 * Pengguna, pengaturan, dashboard, audit log.
 */

// ------------------------------------------------------------------ Users

function userList_() {
  return db_('Users').rows().map(publicUser_);
}

function userUpdate_(actor, id, input) {
  const u = db_('Users').byId(id);
  if (!u) throw new AppError('User tidak ditemukan', [], 'NOT_FOUND');
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

// ------------------------------------------------------------------ Settings

function cleanUnitList_(list, label) {
  const out = [];
  (Array.isArray(list) ? list : String(list || '').split(/[\n,]/)).forEach((x) => {
    const u = normalizeUnit(x);
    if (!u) return;
    if (!/^[A-Z][A-Z0-9]{1,11}$/.test(u)) throw new AppError(`${label}: "${x}" tidak valid (2–12 huruf/angka, diawali huruf)`);
    if (out.indexOf(u) < 0) out.push(u);
  });
  if (!out.length) throw new AppError(label + ' minimal satu');
  return out;
}

function settingsSave_(user, input) {
  const before = getSettings_();
  const val = {};
  if (input.sku_template !== undefined) {
    const t = String(input.sku_template).toUpperCase().trim();
    const errs = validateSkuTemplate(t);
    if (errs.length) throw new AppError(errs.join('; '));
    val.sku_template = t;
  }
  if (input.fuzzy_threshold !== undefined) {
    const f = Number(input.fuzzy_threshold);
    if (!(f >= 0.5 && f <= 0.99)) throw new AppError('Ambang kemiripan 0.5 – 0.99');
    val.fuzzy_threshold = f;
  }
  if (input.master_code_length !== undefined) {
    const n = Number(input.master_code_length);
    if ([3, 4].indexOf(n) < 0) throw new AppError('Panjang kode brand/kategori 3 atau 4 karakter');
    val.master_code_length = n;
  }
  if (input.base_units !== undefined) {
    val.base_units = cleanUnitList_(input.base_units, 'Satuan dasar');
    // satuan yang sudah dipakai produk tidak boleh hilang dari daftar
    const used = {};
    db_('MASTER_PRODUCTS').rows().forEach((p) => (used[p.BaseUnit] = 1));
    const missing = Object.keys(used).filter((u) => val.base_units.indexOf(u) < 0);
    if (missing.length) throw new AppError('Satuan dasar masih dipakai produk: ' + missing.join(', '));
  }
  if (input.pack_units !== undefined) val.pack_units = cleanUnitList_(input.pack_units, 'Satuan kemasan');
  if (input.attribute_types !== undefined) {
    const list = (Array.isArray(input.attribute_types) ? input.attribute_types : String(input.attribute_types).split(/[\n,]/)).map(cleanAttrName).filter(Boolean);
    if (!list.length) throw new AppError('Jenis atribut minimal satu');
    val.attribute_types = list.filter((x, i) => list.indexOf(x) === i);
  }
  Object.keys(val).forEach((k) => {
    const rec = db_('Settings').find((r) => r.key === k);
    const v = JSON.stringify(val[k]);
    if (rec) db_('Settings').update(rec, { value: v, updated_by: user.email, updated_at: now_() });
    else db_('Settings').insert({ key: k, value: v, updated_by: user.email, updated_at: now_() });
  });
  const after = Object.assign({}, before, val);
  audit_(user.email, 'settings.update', 'settings', '', before, after);
  return after;
}

// ------------------------------------------------------------------ Dashboard

function dashboard_() {
  const P = db_('MASTER_PRODUCTS').rows();
  const V = db_('PRODUCT_VARIANTS').rows();
  const C = db_('UNIT_CONVERSIONS').rows();
  const liveP = {};
  P.forEach((p) => p.Status === STATUS.ACTIVE && (liveP[p.ProductID] = 1));
  const liveV = V.filter((v) => v.Status === STATUS.ACTIVE && liveP[v.ProductID]);
  const brands = indexBy_(db_('MASTER_BRANDS').rows(), 'BrandID');
  const byBrand = {};
  liveV.forEach((v) => {
    const p = P.find((x) => x.ProductID === v.ProductID);
    const b = (brands[p.BrandID] || {}).BrandName || '-';
    byBrand[b] = (byBrand[b] || 0) + 1;
  });
  return {
    counts: {
      brands: db_('MASTER_BRANDS').filter((b) => b.Status === STATUS.ACTIVE).length,
      categories: db_('MASTER_CATEGORIES').filter((b) => b.Status === STATUS.ACTIVE).length,
      products: P.filter((p) => p.Status === STATUS.ACTIVE).length,
      variants: liveV.length,
      skus: liveV.length + C.filter((c) => c.SKU && c.Status === STATUS.ACTIVE && c.IsTradeItem && liveP[c.ProductID]).length,
      withGtin: liveV.filter((v) => v.GTIN).length,
      withInternal: liveV.filter((v) => !v.GTIN && v.InternalBarcode).length,
      withoutBarcode: liveV.filter((v) => !v.GTIN && !v.InternalBarcode).length,
      conversions: C.filter((c) => !c.IsBaseUnit && c.Status === STATUS.ACTIVE && liveP[c.ProductID]).length,
    },
    byBrand: Object.keys(byBrand)
      .map((k) => ({ name: k, n: byBrand[k] }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8),
    recentProducts: P.slice()
      .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)))
      .slice(0, 6)
      .map((p) => ({ id: p.ProductID, name: p.ProductName, productNo: productNoLabel(p.ProductNo), brandName: (brands[p.BrandID] || {}).BrandName, createdAt: p.CreatedAt, createdBy: p.CreatedBy, variants: V.filter((v) => v.ProductID === p.ProductID).length })),
    recent: db_('AuditLog')
      .rows()
      .slice(-10)
      .reverse()
      .map((a) => ({ action: a.action, actor: a.actor, createdAt: a.created_at, entityType: a.entity_type, entityId: a.entity_id })),
  };
}

// ------------------------------------------------------------------ Audit

function auditList_(f) {
  f = f || {};
  let rows = db_('AuditLog').rows().slice().reverse();
  if (f.entityType) rows = rows.filter((a) => a.entity_type === f.entityType);
  if (f.action) rows = rows.filter((a) => a.action.indexOf(f.action) >= 0);
  if (f.actor) rows = rows.filter((a) => String(a.actor).indexOf(f.actor) >= 0);
  if (f.entityId) rows = rows.filter((a) => a.entity_id === f.entityId);
  return paginate_(rows, f.page, 50);
}
