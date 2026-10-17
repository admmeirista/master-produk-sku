/**
 * Master Kategori — disimpan terpusat, dipakai seluruh brand & produk.
 * User hanya mengisi Nama Kategori; Kode Kategori otomatis, unik, permanen.
 * Contoh: Parfum → PAR, Lipstick → LIP, Body Lotion → BOD, Facial Wash → FAC.
 * Logika bersama ada di MasterDataService.gs.
 */

function categoryList_(f) {
  return masterList_('category', f);
}

function categoryPreview_(name) {
  return masterPreview_('category', name);
}

function categoryCreate_(user, input) {
  return masterCreate_(user, 'category', input);
}

function categoryCreateMany_(user, input) {
  return masterCreateMany_(user, 'category', input.names, input.acknowledgeSimilar);
}

function categoryRename_(user, input) {
  return masterRename_(user, 'category', input.id, input);
}

function categorySetStatus_(user, input) {
  return masterSetStatus_(user, 'category', input.id, input.status);
}

function activeCategory_(id) {
  const c = db_('MASTER_CATEGORIES').byId(id);
  if (!c) throw new AppError('Kategori tidak ditemukan', [{ path: 'categoryId', message: 'Pilih kategori dari daftar' }], 'VALIDATION_FAILED');
  if (c.Status !== STATUS.ACTIVE) throw new AppError(`Kategori ${c.CategoryName} sedang nonaktif`, [{ path: 'categoryId', message: 'Kategori nonaktif' }], 'VALIDATION_FAILED');
  return c;
}
