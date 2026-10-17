# Revisi v3 — Smart Product Master Registration

Dokumen ini: analisis dampak, perubahan struktur Google Sheets, migrasi, instalasi & deployment, panduan singkat,
dan hasil pengujian. (Revisi v2 menghasilkan desain FMS, master brand/kategori otomatis, dan wizard 3 langkah.)

## 1. Analisis dampak (v2 → v3)

| Area | v2 | v3 |
|---|---|---|
| Kode produk | Diisi user / disarankan dari nama (PEDP) | **Otomatis `PRD000123`** dari counter, permanen |
| SKU | Template `{BRAND}-{CATEGORY}-{PRODUCT}-{VARIANT}` | **Otomatis `SKU000456`**, tidak bergantung brand/kategori/GTIN |
| Kode varian | Wajib (OB50) | Dihapus — tidak perlu input |
| Registrasi | 3 langkah untuk semua produk | **Quick Entry** (1 varian, 1 layar) & **Advanced** (4 tahap, kemasan opsional) |
| Barcode | `BARCODE_REGISTRY` + `BARCODE_ASSIGNMENTS` | **`VARIANT_BARCODES`** (satu tabel, termasuk histori dipensiunkan) |
| Atribut | JSON di varian | **`VARIANT_ATTRIBUTES`** (relasional) + salinan ringkas di varian |
| SKU lama / eksternal | `SKU_MAPPINGS` (BeeCloud/Shopee) | **`EXTERNAL_SKU_MAPPINGS`**: `legacy`, `beecloud`, `shopee` → VariantID/ConversionID |
| Audit / counter | `AuditLog`, `Sequences` | **`AUDIT_LOGS`**, **`SYSTEM_COUNTERS`** |
| Edit produk | Brand/kategori/atribut terkunci (SKU bergantung) | Boleh dikoreksi; ID, kode produk, SKU tetap |
| Faktor konversi | ≥ 2 | **> 0** (bilangan bulat) |
| Hapus | — | Brand/kategori tanpa produk; kemasan operasional |
| Fitur baru | — | Scan Barcode (F2), Duplikat Produk, laci detail di direktori, Import Data Lama (Excel), cache direktori |

Dipertahankan: login & RBAC, lock + staging + jurnal transaksi + rollback, validasi GTIN, barcode internal prefix 200,
deteksi duplikat (exact + fuzzy, tanpa auto-merge), mapping BeeCloud/Shopee, ekspor, audit log, desain FMS.

## 2. Struktur Google Sheets v3

| Tab | Isi |
|---|---|
| `MASTER_BRANDS`, `MASTER_CATEGORIES` | ID, kode otomatis permanen, nama, NameKey, status ACTIVE/INACTIVE/DELETED |
| `MASTER_PRODUCTS` | ProductID, ProductCode (PRD…), brand, kategori, nama, satuan dasar, LegacyCode (kode template lama) |
| `PRODUCT_VARIANTS` | VariantID, SKU (SKU…), GTIN / InternalBarcode aktif, status |
| `VARIANT_ATTRIBUTES` | Atribut per varian (Aroma=Ocean Blue, Volume=50 ml) |
| `VARIANT_BARCODES` | Barcode per varian/kemasan: GTIN & internal; ACTIVE / ALLOCATED / RETIRED / VOID |
| `UNIT_CONVERSIONS` | Satuan kemasan per varian: isi, satuan isi, ekuivalen satuan dasar, opsional SKU/GTIN trade item |
| `EXTERNAL_SKU_MAPPINGS` | SKU lama & SKU BeeCloud/Shopee → VariantID / ConversionID |
| `AUDIT_LOGS`, `SYSTEM_COUNTERS`, `TX_JOURNAL`, `IMPORT_BATCHES`, `Settings`, `Users` | Sistem |

Semua relasi memakai ID permanen (UUID), bukan nama atau nomor baris. Semua sel berformat teks.
Tab lama (v1 & v2) **tidak dihapus**; tercantum sebagai LEGACY di tab "Tentang".

## 3. Migrasi (`MigrationService.gs`, dijalankan oleh `setup()`, idempoten)

* **v2 → v3**: counter, audit log, barcode (registry + histori), mapping, atribut dipindahkan.
  **Produk & SKU v2 tidak diganti** (mis. `SCA-PAR-PEDP-OB50` tetap).
* **v1 → v3**: kode brand/kategori lama dipertahankan; produk mendapat `PRD…`, varian mendapat `SKU…`;
  SKU lama (`PRB-BSR-GH180-8999225912415-1`) dicatat di `EXTERNAL_SKU_MAPPINGS` (legacy) → tetap bisa dicari & dipindai;
  multipack → satuan kemasan tanpa SKU baru. Bundle/harga/approval dilaporkan, data tetap di tab lama.
* **Import Data Lama** (menu): template Excel lama → pratinjau → import. 1 barcode = 1 varian, sehingga
  GTIN yang dipakai dua kode produk lama (VAM100 & AIM100) **tidak** menjadi produk ganda. Isi > 1 → satuan `PACKn`
  (stok tetap dihitung di satuan dasar → tidak ada penggandaan stok). Barcode yang bukan GTIN valid tidak disimpan
  sebagai GTIN. Import ulang tidak menggandakan apa pun.
* Kode brand/kategori lama **tidak diubah otomatis**: bila nama sudah terdaftar dengan kode lain, dilaporkan sebagai catatan.

## 4. Instalasi & deployment Web App

1. Kirim kode: `clasp push` (atau salin semua file `src/` ke proyek Apps Script).
2. Editor Apps Script → fungsi **`setup`** → **Jalankan** (aman diulang). Lihat **Log eksekusi** untuk laporan migrasi.
3. **Terapkan → Kelola deployment → Edit → Versi baru** (URL Web App tetap). Jalankan sebagai: *Saya*; akses: *Siapa saja*.
4. GitHub Pages ikut diperbarui otomatis setelah push ke `main`.

## 5. Panduan singkat

* **Scan Barcode** (menu / tombol **F2**): tembakkan scanner USB → produk terdaftar ditampilkan; GTIN baru → *Registrasi produk baru* (GTIN terisi otomatis) atau *Jadikan varian produk lain*.
* **Registrasi → Quick Entry**: Brand, Kategori, Nama, Barcode/GTIN, Satuan Dasar → Simpan. Kemasan opsional.
* **Registrasi → Advanced**: isi atribut (Aroma: Ocean Blue, Rose Garden; Volume: 50 ml, 100 ml) → *Buat kombinasi* → hapus kombinasi yang tidak ada → scan GTIN per baris (Enter = baris berikutnya) → Kemasan (*Terapkan ke semua varian*, lalu ubah varian tertentu bila beda) → Ringkasan → Simpan.
* **Master Produk**: cari nama/SKU/barcode/SKU lama, klik ▸ untuk laci varian & kemasan; *Duplikat* menyalin konfigurasi tanpa ID/SKU/GTIN.
* **Master Brand / Kategori**: cukup nama; hapus hanya untuk data yang belum dipakai produk.
* **Import Data Lama**: Referensi → Barcode Internal → Master Produk; selalu *Pratinjau* dulu.

## 6. Hasil pengujian

`npm test` — **18 tes lulus** (dijalankan di emulator layanan Apps Script dengan file `.gs` asli):
Quick Entry, Advanced 2×2 dengan GTIN per varian, penolakan GTIN konflik/kombinasi ganda/faktor 0, kode brand &
kategori otomatis + hapus, SKU unik otomatis, scan barcode (terdaftar, baru, check digit salah, prefix kupon, teks),
konversi ke semua varian & override satu varian, 3 BOX × 24 = 72, duplikat produk, simpan tanpa BOX, edit tanpa
mengubah ID permanen, dua user bersamaan (lock sibuk → `BUSY`, versi basi → `STALE_VERSION`, GTIN sama ditolak),
kegagalan tulis multi-sheet → rollback, transaksi terputus → pemulihan, cache direktori, mapping & ekspor,
migrasi v2→v3 dan v1→v3, serta **import workbook Excel asli**:
121 brand, 76 kategori, 114 produk, 559 SKU lama tertelusur, 442 satuan kemasan, 113 baris tidak lengkap ditolak,
import ulang = 0 data baru.

Uji UI di browser (server pratinjau lokal, data contoh): login, Scan Barcode (terdaftar / GTIN baru / bukan GTIN),
Quick Entry dari hasil scan, Advanced (peringatan duplikat, generator, hapus kombinasi, terapkan kemasan ke semua
varian + override, ringkasan, simpan), laci detail direktori, Duplikat, halaman Import, tampilan desktop 1100 px dan
HP 375 px (tanpa scroll horizontal halaman).

Batasan yang perlu diketahui:
* Emulator tidak menjalankan dua eksekusi Apps Script benar-benar paralel; konkurensi diuji dengan simulasi lock
  sibuk dan penyimpanan berurutan. Di Apps Script, script lock menjamin penulisan bergiliran.
* Import Excel dibatasi 5.000 baris per kali (batas waktu eksekusi Apps Script 6 menit).
* Kolom ekspor BeeCloud masih **belum diverifikasi** terhadap template import resmi BeeCloud.
