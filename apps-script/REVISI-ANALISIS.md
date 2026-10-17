# Revisi v2 — Analisis, Perbandingan Struktur, Risiko & Rencana Migrasi

## 1. Analisis kode sebelum revisi (v1)

| Area | v1 | Keputusan v2 |
|---|---|---|
| Lapisan data (`Db.gs`) | Tabel di Sheets, cache baca per eksekusi, tulis di-buffer, script lock | **Dipertahankan** → `DatabaseService.gs`, ditambah **jurnal transaksi + rollback/pemulihan** |
| Login & RBAC (`Auth.gs`) | Akun aplikasi, hash SHA-256 ber-salt, sesi CacheService | **Dipertahankan** → `AuthService.gs`; role disederhanakan: Admin, Admin Data, Viewer (role `reviewer` lama = Admin Data) |
| GTIN & barcode internal (`Lib.gs`, `Barcodes.gs`) | Validasi check digit/prefix, registry, alokasi prefix 200 dalam lock | **Dipertahankan** → `BarcodeService.gs`; target barcode kini varian **atau** satuan kemasan |
| Brand & kategori | Kode diketik user, usulan → approval | **Diganti**: kode otomatis, unik, permanen; tanpa approval; aktif/nonaktif |
| Produk | Wizard 6 langkah, SKU = varian × kemasan (single/multipack/bundle), harga, draft → review → aktif | **Diganti**: wizard 3 langkah, SKU per varian, konversi satuan per varian, langsung aktif |
| Harga, approval, change request, maker-checker | Ada | **Dihapus dari aplikasi** (data lama tetap di tab lama) |
| Duplikasi nama (fuzzy) | Ada | **Dipertahankan** sebagai peringatan (brand/kategori/produk) |
| Mapping BeeCloud/Shopee & ekspor | Berbasis `SKUs` | **Dipertahankan**, kini berbasis kode SKU (varian + kemasan ber-SKU) |
| Import Excel template lama | 5 jenis import | **Dihapus** (database baru; data lama hanya acuan). Bulk input brand/kategori diganti "Tambah banyak" |
| UI | Desain sendiri | **Diganti** mengikuti FMS (`meirista_fulfillment_system`): Nunito, token warna, sidebar, toast, modal, login |

## 2. Perbandingan struktur database

| v1 (tab lama) | v2 (tab baru) | Catatan |
|---|---|---|
| Brands | MASTER_BRANDS | `BrandCode` otomatis & permanen, `NameKey` untuk cek duplikasi |
| Categories | MASTER_CATEGORIES | idem |
| Products | MASTER_PRODUCTS | + `BaseUnit`; tanpa status approval |
| Variants + SKUs (single) | PRODUCT_VARIANTS | SKU & GTIN/barcode internal **di level varian** |
| SKUs (multipack) | UNIT_CONVERSIONS (`IsTradeItem=TRUE`) | SKU lama dipertahankan; isi = `ConversionFactor` |
| — | UNIT_CONVERSIONS | konversi bertingkat (`ContainsUnit`), `BaseUnitEquivalent` |
| Barcodes / BarcodeAssignments | BARCODE_REGISTRY / BARCODE_ASSIGNMENTS | + `ConversionID` |
| Mappings | SKU_MAPPINGS | kunci = kode SKU |
| — | TX_JOURNAL | jurnal transaksi untuk rollback |
| Prices, Requests, ApprovalHistory, SkuCodeHistory, Components, Import*, Dismissals | — | tidak dipakai lagi; **tidak dihapus** |

Semua relasi memakai ID stabil (UUID). Kode brand/kategori, kode produk, dan SKU tidak bergantung pada urutan baris.

## 3. Risiko & pengendalian

| Risiko | Pengendalian |
|---|---|
| Kehilangan data lama | Tab lama tidak dihapus/diubah; migrasi hanya menyalin. |
| SKU lama berubah | Migrasi memakai SKU lama apa adanya; SKU tersimpan tidak pernah dibuat ulang. Template SKU baru hanya untuk SKU baru. |
| Kode brand/kategori lama berubah | Kode lama dipertahankan (termasuk yang > 3 huruf). |
| Bundle/BOM tidak punya padanan | Dilaporkan di log `setup()`; data tetap di tab `SKUs` & `Components`. |
| Multipack dengan satuan sama (PACK 6 & PACK 12) | Nama satuan kedua menjadi `PACK12` agar unik per varian. |
| Produk tersimpan setengah | Staging + jurnal + rollback; transaksi terputus dibatalkan otomatis. Diuji dengan simulasi kegagalan tulis. |
| Dua user menyimpan bersamaan | Script lock untuk semua penulisan; kode & nomor dialokasikan di dalam lock; cek versi produk (`STALE_VERSION`). |

## 4. Rencana migrasi (sudah diimplementasikan di `MigrationService.gs`)

1. Deploy kode v2 (clasp push).
2. Jalankan `setup()` dari editor Apps Script:
   - membuat tab baru, memperbarui template SKU default lama,
   - menyalin data lama → struktur baru (idempoten: ID lama dipakai ulang, aman diulang),
   - menulis laporan ke Log eksekusi & Audit Log (`migration.legacy`).
3. Cek hasil di aplikasi. Setelah yakin, tab lama boleh dihapus manual (opsional).

Kondisi database live saat revisi: **0 produk**, 1 brand uji (`asda`/ASDAS, status usulan → menjadi Nonaktif),
1 kategori uji (`3ere`/WER), 1 akun admin. Risiko migrasi praktis nol.

## 5. Pengujian

`npm test` — 15 skenario di emulator layanan Apps Script, antara lain: kode brand otomatis (Viva→VIV, Vivelle≠VIV,
duplikasi beda penulisan), kategori otomatis, parfum 2 aroma × 2 volume dengan GTIN per varian & konversi bertingkat
(BOX 24, KARTON 6 BOX = 144), kemasan ber-SKU, kalkulator (3 BOX = 72), kombinasi ganda, GTIN ganda/terpakai/salah,
produk tanpa varian (varian default), edit (tambah varian, identitas permanen, ganti GTIN wajib alasan, kemasan ber-SKU
terkunci), rollback kegagalan tulis, pemulihan transaksi terputus, migrasi struktur lama, mapping & ekspor, pengaturan.
