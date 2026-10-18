/**
 * Foto Child SKU — unggah ke Google Drive (folder "Foto Produk (Master SKU)" di samping file database).
 * File dibagikan "siapa saja yang punya link: lihat" agar bisa tampil di aplikasi & dipakai di marketplace.
 * Foto diperkecil di browser (maks. 1200 px, JPEG) sebelum dikirim. Alternatif tanpa unggah: link https langsung.
 *
 * Butuh izin Google Drive SEKALI dari pemilik akun: jalankan fungsi authorizeDrive di editor Apps Script.
 */

const PHOTO_MAX_BYTES_ = 3 * 1024 * 1024;

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('photo_folder_id');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      // folder terhapus → dibuat ulang
    }
  }
  const parents = DriveApp.getFileById(DB_SPREADSHEET_ID).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder('Foto Produk (Master SKU)');
  props.setProperty('photo_folder_id', folder.getId());
  return folder;
}

function photoUpload_(user, p) {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((p && p.dataUrl) || ''));
  if (!m) throw new AppError('Format foto tidak didukung. Gunakan JPG, PNG, atau WebP.');
  const bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > PHOTO_MAX_BYTES_) throw new AppError('Ukuran foto maksimal 3 MB');
  const ext = m[2] === 'png' ? '.png' : m[2] === 'webp' ? '.webp' : '.jpg';
  const name = 'foto-sku-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmmss') + '-' + uuid_().slice(0, 6) + ext;
  let file;
  try {
    file = photoFolder_().createFile(Utilities.newBlob(bytes, m[1], name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    throw new AppError('Unggah foto belum aktif — pemilik aplikasi perlu memberi izin Google Drive sekali. Sementara gunakan link foto.', [], 'NOT_AUTHORIZED');
  }
  PropertiesService.getScriptProperties().setProperty('drive_ok', '1');
  audit_(user.email, 'photo.upload', 'photo', file.getId(), null, { name, original: cleanText(p.fileName).slice(0, 120) });
  return { fileId: file.getId(), url: 'https://lh3.googleusercontent.com/d/' + file.getId() };
}

/** Jalankan SEKALI dari editor Apps Script untuk memberi izin Google Drive (unggah foto produk). */
function authorizeDrive() {
  photoFolder_();
  PropertiesService.getScriptProperties().setProperty('drive_ok', '1');
  console.log('Izin Google Drive aktif. Unggah foto produk siap dipakai.');
}
