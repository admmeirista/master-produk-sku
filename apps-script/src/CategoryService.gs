/**
 * Master Kategori — bertingkat mengikuti kategori Shopee Indonesia (Perawatan & Kecantikan), lihat ShopeeCategories.gs.
 * Produk memilih KATEGORI AKHIR (mis. Perawatan Wajah > Toner); kelompok (Perawatan Wajah) tidak bisa dipilih.
 * Kategori lama di luar standar tetap ada & tetap berlaku untuk produk yang sudah memakainya.
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
  if (!c || c.Status === STATUS.DELETED) throw new AppError('Kategori tidak ditemukan', [{ path: 'categoryId', message: 'Pilih kategori dari daftar' }], 'VALIDATION_FAILED');
  if (c.Status !== STATUS.ACTIVE) throw new AppError(`Kategori ${c.CategoryName} sedang nonaktif`, [{ path: 'categoryId', message: 'Kategori nonaktif' }], 'VALIDATION_FAILED');
  if (catIsShopee_(c) && !catIsLeaf_(c))
    throw new AppError(`"${c.CategoryName}" adalah kelompok kategori. Pilih kategori paling akhir di bawahnya.`, [{ path: 'categoryId', message: 'Pilih kategori paling akhir (seperti di Shopee)' }], 'VALIDATION_FAILED');
  return c;
}

function categoryDelete_(user, input) {
  return masterDelete_(user, 'category', input.id);
}
