/**
 * Pekerjaan foto produk (mode Staf Foto di HP + pemantauan Admin).
 *  - Foto selalu ditautkan ke VariantID (SKU Produk) yang tetap — bukan nama / posisi baris.
 *  - Foto utama = PRODUCT_VARIANTS.ImageUrl/ImageFileId (dipakai thumbnail di seluruh aplikasi). Riwayat setiap unggahan
 *    dicatat di PRODUCT_PHOTOS (siapa, kapan, file apa, diganti kapan). File lama tidak dihapus dari Drive.
 *  - Status foto (PRODUCT_VARIANTS.PhotoStatus): '' / APPROVED = selesai, UPLOADED = menunggu review (hanya bila
 *    review diaktifkan di Pengaturan), RETAKE = perlu foto ulang (alasan di PhotoNote). Tanpa ImageUrl = belum difoto.
 *  - Penugasan: PhotoAssignee = id pengguna staf. Staf melihat SKU yang ditugaskan kepadanya; bila tidak ada
 *    penugasan sama sekali untuknya, staf melihat semua SKU aktif yang belum difoto.
 *  - Anti salah timpa: simpan foto mengirim file foto yang sedang dilihat (expectFileId). Bila sementara itu orang lain
 *    sudah mengganti foto, penyimpanan ditolak (CONFLICT) kecuali pengguna memilih tetap mengganti.
 */

const PHOTO_STATE = { NONE: 'NONE', DONE: 'DONE', REVIEW: 'REVIEW', RETAKE: 'RETAKE' };
const PHOTO_STATE_LABEL = { NONE: 'Belum difoto', DONE: 'Selesai', REVIEW: 'Menunggu review', RETAKE: 'Perlu foto ulang' };

function photoState_(v) {
  if (v.ps === 'RETAKE') return PHOTO_STATE.RETAKE;
  if (!v.img) return PHOTO_STATE.NONE;
  if (v.ps === 'UPLOADED' && getSettings_().photo_review_required) return PHOTO_STATE.REVIEW;
  return PHOTO_STATE.DONE;
}

/** Thumbnail kecil dari Drive (tanpa memuat resolusi penuh). */
function photoThumb_(url, px) {
  const m = /^https:\/\/lh3\.googleusercontent\.com\/d\/([\w-]+)/.exec(String(url || ''));
  return m ? 'https://lh3.googleusercontent.com/d/' + m[1] + '=s' + (px || 240) : url || '';
}

/** Semua SKU Produk aktif sebagai kartu foto (dari indeks direktori yang sudah di-cache). */
function photoCards_() {
  const out = [];
  productIndex_().forEach((r) => {
    if (r.status !== STATUS.ACTIVE && r.status !== STATUS.DRAFT) return;
    (r.v || []).forEach((v) => {
      if (v.status !== STATUS.ACTIVE && v.status !== STATUS.DRAFT) return;
      out.push({
        variantId: v.id,
        productId: r.id,
        sku: v.sku,
        name: v.name || r.displayName,
        brand: r.brandName,
        attrs: (v.attrs || []).map((a) => a[1]).join(' · '),
        gtin: v.gtin,
        internal: v.internal,
        img: v.img,
        fileId: v.fid || '',
        ps: v.ps || '',
        note: v.pn || '',
        assignee: v.pa || '',
        by: v.pb || '',
        at: v.pt || '',
        updatedAt: r.updatedAt,
      });
    });
  });
  out.forEach((c) => (c.state = photoState_(c)));
  return out;
}

function photoCardView_(c) {
  return { variantId: c.variantId, productId: c.productId, sku: c.sku, name: c.name, brand: c.brand, attrs: c.attrs, barcode: c.gtin || c.internal || '', thumb: photoThumb_(c.img, 240), img: c.img, fileId: c.fileId, state: c.state, stateLabel: PHOTO_STATE_LABEL[c.state], note: c.note, assignee: c.assignee, by: c.by, at: c.at };
}

/** Lingkup kerja staf: SKU yang ditugaskan kepadanya; bila tidak ada → semua. Admin selalu semua. */
function photoScope_(user, cards) {
  if (can_(user, 'photo.manage')) return cards;
  const mine = cards.filter((c) => c.assignee === user.id);
  return mine.length ? mine : cards.filter((c) => !c.assignee);
}

const PHOTO_ORDER_ = { RETAKE: 0, NONE: 1, REVIEW: 2, DONE: 3 };

function photoSummary_(user) {
  const cards = photoScope_(user, photoCards_());
  const n = (st) => cards.filter((c) => c.state === st).length;
  const today = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const day = (iso) => (iso ? Utilities.formatDate(new Date(iso), 'Asia/Jakarta', 'yyyy-MM-dd') : '');
  const doneToday = cards.filter((c) => c.by === user.email && c.state !== PHOTO_STATE.RETAKE && day(c.at) === today).length;
  return {
    total: cards.length,
    todo: n(PHOTO_STATE.NONE),
    retake: n(PHOTO_STATE.RETAKE),
    review: n(PHOTO_STATE.REVIEW),
    done: n(PHOTO_STATE.DONE),
    doneToday,
    assigned: cards.some((c) => c.assignee === user.id),
    reviewRequired: !!getSettings_().photo_review_required,
  };
}

/**
 * Daftar kartu foto. filter: todo (belum + perlu ulang), none, retake, review, done, all. q = nama / SKU / barcode.
 * Admin: assignee ('' semua, 'none' belum ditugaskan, id staf), brandId.
 */
function photoList_(user, f) {
  f = f || {};
  let cards = photoScope_(user, photoCards_());
  const want = { todo: [PHOTO_STATE.RETAKE, PHOTO_STATE.NONE], none: [PHOTO_STATE.NONE], retake: [PHOTO_STATE.RETAKE], review: [PHOTO_STATE.REVIEW], done: [PHOTO_STATE.DONE, PHOTO_STATE.REVIEW] }[f.filter || 'todo'];
  if (want) cards = cards.filter((c) => want.indexOf(c.state) >= 0);
  if (f.assignee === 'none') cards = cards.filter((c) => !c.assignee);
  else if (f.assignee) cards = cards.filter((c) => c.assignee === f.assignee);
  if (f.brand) cards = cards.filter((c) => c.brand === f.brand);
  const q = cleanText(f.q).toUpperCase();
  if (q) {
    const qx = q.replace(/\s+/g, '');
    const qn = normalizeName(q).toUpperCase();
    const exact = cards.filter((c) => c.gtin === qx || c.internal === qx || String(c.sku).toUpperCase() === qx);
    cards = exact.length ? exact : cards.filter((c) => normalizeName(c.name + ' ' + c.sku + ' ' + c.brand + ' ' + c.attrs).toUpperCase().indexOf(qn) >= 0 || String(c.sku).toUpperCase().indexOf(qx) >= 0 || String(c.gtin).indexOf(qx) >= 0);
  }
  cards.sort((a, b) => PHOTO_ORDER_[a.state] - PHOTO_ORDER_[b.state] || (f.filter === 'done' ? String(b.at).localeCompare(String(a.at)) : String(a.brand + a.name).localeCompare(String(b.brand + b.name))));
  const page = paginate_(cards, f.page, Math.min(Number(f.pageSize) || 20, 100));
  page.rows = page.rows.map(photoCardView_);
  return page;
}

/** Cari SKU Produk dari hasil scan (GTIN / barcode internal / Kode SKU). Tidak pernah membuat produk baru. */
function photoFind_(user, p) {
  const code = String((p && p.code) || '').replace(/\s+/g, '').toUpperCase();
  if (!code) throw new AppError('Kode kosong');
  const hit = photoCards_().find((c) => c.gtin === code || c.internal === code || String(c.sku).toUpperCase() === code);
  return hit ? photoCardView_(hit) : null;
}

function photoGet_(user, p) {
  const c = photoCards_().find((x) => x.variantId === p.variantId);
  if (!c) throw new AppError('SKU Produk tidak ditemukan atau tidak aktif', [], 'NOT_FOUND');
  const history = db_('PRODUCT_PHOTOS')
    .filter((h) => h.VariantID === c.variantId)
    .slice(-10)
    .reverse()
    .map((h) => ({ id: h.PhotoID, url: h.Url, thumb: photoThumb_(h.Url, 240), kind: h.Kind, status: h.Status, by: h.UploadedBy, at: h.UploadedAt, note: h.Note || '' }));
  return Object.assign(photoCardView_(c), { large: photoThumb_(c.img, 1000), history });
}

/** Folder Drive terstruktur: Foto Produk (Master SKU) / <Brand>. */
function photoBrandFolder_(brand) {
  const root = photoFolder_();
  const name = cleanText(brand) || 'Tanpa Brand';
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

/**
 * Simpan foto untuk satu SKU Produk. p: { variantId, dataUrl, kind: MAIN|EXTRA, expectFileId, replace, requestKey }.
 * Status sukses hanya dikembalikan setelah file tersimpan di Drive DAN data tercatat di database.
 * Mengembalikan SKU berikutnya yang perlu difoto (lingkup yang sama) agar staf langsung lanjut.
 */
function photoSave_(user, p) {
  const V = db_('PRODUCT_VARIANTS');
  const v = V.byId(p.variantId);
  if (!v || v.Status === STATUS.DELETED) throw new AppError('SKU Produk tidak ditemukan', [], 'NOT_FOUND');
  const prod = db_('MASTER_PRODUCTS').byId(v.ProductID);
  if (!prod || prod.Status === STATUS.DELETED) throw new AppError('Produk tidak ditemukan', [], 'NOT_FOUND');
  const kind = p.kind === 'EXTRA' ? 'EXTRA' : 'MAIN';
  if (kind === 'MAIN' && (v.ImageFileId || '') !== (p.expectFileId || '') && !p.replace) {
    throw new AppError('Foto SKU ini baru saja diganti' + (v.PhotoBy ? ' oleh ' + v.PhotoBy : '') + '. Lihat foto terbaru dulu, lalu pilih "Tetap ganti" bila foto Anda lebih baik.', [], 'CONFLICT');
  }
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(p.dataUrl || ''));
  if (!m) throw new AppError('Format foto tidak didukung. Gunakan JPG, PNG, atau WebP.');
  const bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > PHOTO_MAX_BYTES_) throw new AppError('Ukuran foto maksimal 3 MB');
  if (bytes.length < 2000) throw new AppError('File foto rusak atau kosong. Ambil ulang fotonya.');
  const brand = (db_('MASTER_BRANDS').byId(prod.BrandID) || {}).BrandName || '';
  const ts = now_();
  const stamp = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmmss');
  const name = (v.SKU || 'SKU') + '-' + (kind === 'MAIN' ? 'utama' : 'tambahan') + '-' + stamp + (m[2] === 'png' ? '.png' : m[2] === 'webp' ? '.webp' : '.jpg');
  let file;
  try {
    file = photoBrandFolder_(brand).createFile(Utilities.newBlob(bytes, m[1], name));
    file.setDescription('SKU ' + v.SKU + ' · VariantID ' + v.VariantID + ' · ' + user.email);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    throw new AppError('Foto gagal disimpan ke Google Drive. Coba lagi.', [], 'UPLOAD_FAILED');
  }
  PropertiesService.getScriptProperties().setProperty('drive_ok', '1');
  const url = 'https://lh3.googleusercontent.com/d/' + file.getId();
  const review = !!getSettings_().photo_review_required;
  const H = db_('PRODUCT_PHOTOS');
  if (kind === 'MAIN') {
    H.filter((h) => h.VariantID === v.VariantID && h.Kind === 'MAIN' && !h.ReplacedAt).forEach((h) => H.update(h, { ReplacedAt: ts }));
    const before = { ImageUrl: v.ImageUrl || '', PhotoStatus: v.PhotoStatus || '' };
    V.update(v, { ImageUrl: url, ImageFileId: file.getId(), PhotoStatus: review ? 'UPLOADED' : 'APPROVED', PhotoNote: '', PhotoBy: user.email, PhotoAt: ts, UpdatedAt: ts });
    audit_(user.email, 'photo.save', 'variant', v.VariantID, before, { ImageUrl: url, sku: v.SKU });
  } else audit_(user.email, 'photo.extra', 'variant', v.VariantID, null, { url, sku: v.SKU });
  H.insert({ PhotoID: uuid_(), VariantID: v.VariantID, ProductID: v.ProductID, Kind: kind, FileId: file.getId(), Url: url, Status: kind === 'MAIN' ? (review ? 'UPLOADED' : 'APPROVED') : 'EXTRA', Note: '', UploadedBy: user.email, UploadedAt: ts, ReviewedBy: '', ReviewedAt: '', ReplacedAt: '' });
  bumpDataVersion_();
  return { variantId: v.VariantID, sku: v.SKU, url, thumb: photoThumb_(url, 240), fileId: file.getId(), state: kind === 'MAIN' ? (review ? PHOTO_STATE.REVIEW : PHOTO_STATE.DONE) : null };
}

/** SKU berikutnya untuk difoto (setelah simpan / lewati). skip = daftar variantId yang dilewati di sesi ini. */
function photoNext_(user, p) {
  const skip = {};
  (p.skip || []).forEach((id) => (skip[id] = 1));
  if (p.after) skip[p.after] = 1;
  const cards = photoScope_(user, photoCards_()).filter((c) => !skip[c.variantId] && (c.state === PHOTO_STATE.NONE || c.state === PHOTO_STATE.RETAKE));
  if (!cards.length) return null;
  // utamakan varian lain dari produk yang sama (barang biasanya berdekatan di rak)
  const cur = p.after ? photoCards_().find((c) => c.variantId === p.after) : null;
  cards.sort((a, b) => PHOTO_ORDER_[a.state] - PHOTO_ORDER_[b.state] || (cur ? (b.productId === cur.productId) - (a.productId === cur.productId) : 0) || String(a.brand + a.name).localeCompare(String(b.brand + b.name)));
  return photoCardView_(cards[0]);
}

/** Staf melaporkan barang tidak ditemukan / data salah → tercatat di Audit Log untuk ditindaklanjuti Admin. */
function photoReport_(user, p) {
  const note = cleanText(p.note).slice(0, 300);
  if (!note && !p.code) throw new AppError('Tulis keterangan singkat');
  audit_(user.email, 'photo.report', 'variant', p.variantId || '', null, { code: cleanText(p.code).slice(0, 40), note });
  return { ok: true };
}

// ---------------------------------------------------------------- Admin: penugasan, minta foto ulang, review

function photoStaff_() {
  return db_('Users')
    .rows()
    .filter((u) => u.is_active && (ROLE_PERMISSIONS[u.role] || []).indexOf('photo.work') >= 0)
    .sort((a, b) => (a.role === 'photo_staff' ? 0 : 1) - (b.role === 'photo_staff' ? 0 : 1) || String(a.full_name).localeCompare(String(b.full_name)))
    .map((u) => ({ id: u.id, name: u.full_name + (u.role === 'photo_staff' ? '' : ' (' + (ROLE_LABEL[u.role] || u.role) + ')'), email: u.email, role: u.role }));
}

function photoVariants_(ids) {
  const V = db_('PRODUCT_VARIANTS');
  const list = (ids || []).map((id) => V.byId(id)).filter((v) => v && v.Status !== STATUS.DELETED);
  if (!list.length) throw new AppError('Pilih minimal satu SKU Produk');
  if (list.length > 500) throw new AppError('Maksimal 500 SKU sekali proses');
  return list;
}

function photoAssign_(user, p) {
  const to = p.assignee ? db_('Users').byId(p.assignee) : null;
  if (p.assignee && (!to || !to.is_active)) throw new AppError('Staf tidak ditemukan / nonaktif');
  const list = photoVariants_(p.variantIds);
  list.forEach((v) => db_('PRODUCT_VARIANTS').update(v, { PhotoAssignee: to ? to.id : '' }));
  audit_(user.email, 'photo.assign', 'variant', '', null, { count: list.length, to: to ? to.email : '' });
  bumpDataVersion_();
  return { updated: list.length };
}

function photoRetake_(user, p) {
  const note = cleanText(p.note).slice(0, 200);
  if (note.length < 3) throw new AppError('Tulis alasan foto perlu diulang (mis. blur, salah varian, tulisan tidak terbaca)');
  const list = photoVariants_(p.variantIds);
  const H = db_('PRODUCT_PHOTOS');
  list.forEach((v) => {
    db_('PRODUCT_VARIANTS').update(v, { PhotoStatus: 'RETAKE', PhotoNote: note });
    H.filter((h) => h.VariantID === v.VariantID && h.Kind === 'MAIN' && !h.ReplacedAt).forEach((h) => H.update(h, { Status: 'RETAKE', Note: note, ReviewedBy: user.email, ReviewedAt: now_() }));
  });
  audit_(user.email, 'photo.retake', 'variant', '', null, { count: list.length, note });
  bumpDataVersion_();
  return { updated: list.length };
}

function photoApprove_(user, p) {
  const list = photoVariants_(p.variantIds).filter((v) => v.ImageUrl);
  const H = db_('PRODUCT_PHOTOS');
  list.forEach((v) => {
    db_('PRODUCT_VARIANTS').update(v, { PhotoStatus: 'APPROVED', PhotoNote: '' });
    H.filter((h) => h.VariantID === v.VariantID && h.Kind === 'MAIN' && !h.ReplacedAt).forEach((h) => H.update(h, { Status: 'APPROVED', ReviewedBy: user.email, ReviewedAt: now_() }));
  });
  audit_(user.email, 'photo.approve', 'variant', '', null, { count: list.length });
  bumpDataVersion_();
  return { updated: list.length };
}
