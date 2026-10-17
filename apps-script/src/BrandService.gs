/**
 * Master Brand. User hanya mengisi Nama Brand; Kode Brand otomatis, unik, permanen.
 * Contoh: Viva → VIV, Hanasui → HAN, Purbasari → PUR, Scarlett → SCA; Vivelle (VIV sudah dipakai) → VIE.
 * Logika bersama ada di MasterDataService.gs.
 */

function brandList_(f) {
  return masterList_('brand', f);
}

function brandPreview_(name) {
  return masterPreview_('brand', name);
}

function brandCreate_(user, input) {
  return masterCreate_(user, 'brand', input);
}

function brandCreateMany_(user, input) {
  return masterCreateMany_(user, 'brand', input.names, input.acknowledgeSimilar);
}

function brandRename_(user, input) {
  return masterRename_(user, 'brand', input.id, input);
}

function brandSetStatus_(user, input) {
  return masterSetStatus_(user, 'brand', input.id, input.status);
}

/** Brand aktif untuk dipakai di registrasi produk. */
function activeBrand_(id) {
  const b = db_('MASTER_BRANDS').byId(id);
  if (!b) throw new AppError('Brand tidak ditemukan', [{ path: 'brandId', message: 'Pilih brand dari daftar' }], 'VALIDATION_FAILED');
  if (b.Status !== STATUS.ACTIVE) throw new AppError(`Brand ${b.BrandName} sedang nonaktif`, [{ path: 'brandId', message: 'Brand nonaktif' }], 'VALIDATION_FAILED');
  return b;
}
