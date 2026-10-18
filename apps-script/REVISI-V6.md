# Revisi v6 — Kodifikasi SKU Sederhana & Master Data

Revisi ini menyederhanakan kode SKU agar tidak lagi bergantung pada brand, kategori, GTIN, atau nama produk.

Yang tidak berubah: data dan sheet lama tetap ada, migrasi tidak destruktif, dan setiap penyimpanan tetap atomik di dalam lock.

Dokumen sebelumnya: [REVISI-V5.md](REVISI-V5.md) dan [REVISI-V4.md](REVISI-V4.md).

## 1. Format kode (final)

| Jenis | Label di aplikasi | Format | Penghitung (SYSTEM_COUNTERS) |
|---|---|---|---|
| Parent SKU | Kode Produk Induk | `PRD000001` | `product_no` (global, lintas brand & kategori) |
| Child SKU | Kode SKU Produk | `PRD000001-001` | `child_no` + `ScopeID` = ProductID (mulai 001 per induk) |
| Multipack | Paket Produk Sama | `MP000001` | `multipack_no` |
| Bundle | Paket Kombinasi / Paket Pilih Sendiri | `BD000001` | `bundle_no` |

**Aturan kode:**
- **Siapa yang membuat nomor:** hanya backend, di dalam LockService. Nomor tidak pernah diambil dari jumlah atau urutan baris sheet. Kode yang sudah ada selalu dilewati.
- **Celah nomor:** nomor boleh terlewat, misalnya bila penyimpanan gagal. Yang dijamin adalah keunikan dan bahwa nomor tidak dipakai ulang.
- **SKU bersifat permanen sejak dialokasikan.** Mengubah brand, kategori, nama, GTIN, kemasan, dimensi, atau berat tidak mengubah SKU.
- **Kode SKU Produk tidak dipakai ulang**, walaupun varian lamanya sudah Nonaktif atau Discontinued. Contoh: setelah 005 di-discontinue, varian baru mendapat 006.
- **Batas 999 Kode SKU Produk per induk.** Lebih dari itu, sistem menolak dengan pesan yang jelas (tidak berputar ulang ke 001). Cara memperluas: daftarkan sebagai produk induk baru, atau naikkan `CHILD_SEQ_DIGITS` di `Config.gs` setelah sistem lain yang memakai SKU dicek.
- **GTIN terpisah dari SKU.** Saat barcode di-scan, sistem mencari di `VARIANT_BARCODES` lalu menampilkan Kode SKU Produk dan detail produknya. Pilihan barcode per varian: GTIN, barcode internal (dibuat otomatis, bertipe `INTERNAL`), atau tanpa barcode. Koreksi GTIN tidak mengubah SKU, dan histori barcode tetap disimpan.
- **Paket bersifat permanen setelah aktif.** Komposisi dan mode stok paket yang sudah aktif tidak bisa diubah; buat paket baru dengan kode baru. Nama paket tetap boleh diubah. Kode komponen tidak dimasukkan ke string SKU paket. Paket virtual tidak punya saldo stok.

## 2. Master Brand & Kategori

- Hanya **Nama**. ID internal (`BrandID` / `CategoryID`) dipakai untuk relasi dan tidak ditampilkan. Tidak ada lagi kode brand atau kategori di formulir, tabel, dropdown, maupun import.
- Kolom `BrandCode` / `CategoryCode` lama tetap ada di sheet sebagai metadata dan tidak dipakai untuk SKU. Data baru mengisinya kosong.
- Import XLSX tetap tersedia, dengan format minimal kolom `Nama Brand` / `Nama Kategori`. Alurnya:
  - Pratinjau dulu sebelum disimpan.
  - Nama dinormalisasi dan duplikat dideteksi.
  - Hasil ditampilkan sebagai jumlah Berhasil, Dilewati, dan Gagal, dengan laporan per baris.
  - Import ulang file yang sama tidak membuat data ganda.

## 3. Struktur sheet (padanan nama di brief)

Nama tab tidak diganti, karena mengganti nama berisiko bagi data yang sudah ada.

| Brief | Tab | Catatan |
|---|---|---|
| PRODUCT_PARENTS | `MASTER_PRODUCTS` | `ProductCode` = Parent SKU, `ProductName` = nama induk |
| PRODUCT_VARIANTS | `PRODUCT_VARIANTS` | `SKU` = Child SKU, `ProductSKUName`, `BaseUnit`, `ImageUrl` |
| PRODUCT_BARCODES | `VARIANT_BARCODES` | `BarcodeType` GTIN / INTERNAL, status ACTIVE / RETIRED (histori) |
| MULTIPACKS + BUNDLES | `BUNDLE_MASTERS` | `BundleType` MULTIPACK / MIXED / REQUEST_MIX, `StockMode` VIRTUAL / PREASSEMBLED |
| SKU_COMPONENTS | `BUNDLE_COMPONENTS` | komponen = `VariantID` (ID internal), `Quantity` |
| PACKAGING_CONVERSIONS | `UNIT_CONVERSIONS` | — |
| PRODUCT_DIMENSIONS | `PRODUCT_DIMENSIONS` | — |
| SYSTEM_COUNTERS | `SYSTEM_COUNTERS` | **+ kolom `ScopeID`** (penghitung Child SKU per induk) |

Relasi selalu memakai ID internal (UUID), bukan string SKU.

## 4. Migrasi

- Database produksi pada saat revisi ini masih berisi **0 produk dan 0 paket**, jadi tidak ada SKU yang perlu dikonversi.
- Data lama tetap berlaku apa adanya: SKU format v3/v4 (`SKU000456`), v5 (`HAN-PLB-0001-…`), dan bundle `BDL…`.
  - Varian baru di bawah induk lama mengikuti pola `KODE_INDUK-001`.
  - SKU lama tetap bisa dicari (diuji).
- Migrasi dari data v1 dan import template Excel lama: nomor produk lama dipertahankan (mis. `PRD000007`), kode produk lama disimpan sebagai `LegacyCode`, dan SKU lama dicatat sebagai *legacy SKU* yang mengarah ke Child SKU baru.
- Pembaruan struktur berjalan otomatis (`autoSchema_`), termasuk kolom `ScopeID`. Tidak perlu menjalankan `setup`.

## 5. Hasil pengujian (dijalankan 18 Okt 2026)

- **Otomatis:** `npm test`, **52 tes lulus**. Tes menjalankan file `.gs` asli di emulator (`test/harness.cjs`); skenario v6 ada di `test/v6.test.cjs`.
- **Browser:** pratinjau lokal, desktop dan 375 px.
  - Registrasi Warna × Volume menghasilkan PRD000005-001 sampai -004, dengan GTIN terpisah dan satu baris tanpa barcode.
  - Direktori induk-SKU bisa dibuka per induk dan dicari lewat GTIN.
  - Master Brand/Kategori tanpa kode, halaman paket dengan label baru.
  - Tidak ada error JavaScript.
- **Produksi (Google Sheets asli): belum diuji dengan login.**

| # | Skenario | Hasil | Bukti |
|---|---|---|---|
| 1 | Brand berbeda → nomor Parent global berurutan | Pass | v6 [T1]: Hanasui, Viva, Purbasari, Wardah → PRD000001–004 |
| 2 | Kategori berbeda tidak mengulang nomor | Pass | v6 [T2]: PRD000005 untuk brand/kategori yang sama dengan PRD000001 |
| 3 | Dua user bersamaan tanpa nomor ganda | Pass (simulasi) | v6 [T3]: lock sibuk, versi basi ditolak, nomor unik. Emulator tidak menjalankan eksekusi paralel sungguhan |
| 4 | Parent baru → satu Child default | Pass | v6 [T4]: PRD000004-001 |
| 5 | 4 kombinasi → 001–004 | Pass | v6 [T5]; browser |
| 6 | Varian kelima → 005 | Pass | v6 [T6]; nomor tidak dipakai ulang (006 setelah 005 discontinued) |
| 7 | GTIN bukan bagian Child SKU | Pass | v6 [T7] |
| 8 | Ubah GTIN tidak mengubah Child SKU | Pass | v6 [T8]: barcode lama RETIRED, histori ada |
| 9 | Scan GTIN → Child SKU benar | Pass | v6 [T9]; browser Cari SKU |
| 10 | Tanpa GTIN tetap dapat Child SKU | Pass | v6 [T10]: tanpa barcode & barcode internal |
| 11 | Multipack 2 PCS → MP | Pass | v6 [T11]: MP000001 |
| 12 | Multipack 6 PCS → MP lain | Pass | v6 [T12]: MP000002 |
| 13 | Bundle A+B → BD | Pass | v6 [T13]: BD000001 |
| 14 | Komposisi tersimpan benar | Pass | v6 [T14]: BOM pakai VariantID; komposisi paket aktif terkunci |
| 15 | Parent tidak bisa jadi stok | Pass | v6 [T15]: tidak ada di inventory, ditolak sebagai komponen & mapping |
| 16 | Import XLSX tanpa kode | Pass | v6 [T16]; browser Upload Excel |
| 17 | Nama brand sama tidak dobel | Pass | v6 [T17] (manual & import ulang) |
| 18 | Ganti nama brand tidak mengubah Parent SKU | Pass | v6 [T18] |
| 19 | Dimensi & berat tidak memengaruhi SKU | Pass | v6 [T19] |
| 20 | SKU lama bisa dicari setelah migrasi | Pass | v6 [T20]: legacy SKU v1 → PRD000007-001; SKU v5 tetap bisa dicari |
| 21 | Request yang sama tidak membuat SKU ganda | Pass | v6 [T21]: idempotency key (`replayed`) |
| 22 | Konsisten saat partial failure | Pass | v6 [T22]: injeksi kegagalan tulis → rollback penuh |

## 6. Keterbatasan

- **Belum diuji dengan login di produksi.**
- **Nomor Kode Produk Induk di layar sebelum disimpan hanya perkiraan.** Bila pengguna lain menyimpan lebih dulu, nomornya bergeser, tetapi tetap unik.
- **Batas 999 Kode SKU Produk per induk.** Perluasan format harus disengaja (lihat §1).
- **Barcode internal prefix `200` dan batas panjang SKU di BeeCloud/Shopee belum diverifikasi.** SKU sekarang lebih pendek (13 karakter).
