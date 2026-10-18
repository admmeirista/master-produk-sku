# Revisi v5 — Registrasi SKU Master yang Disederhanakan

Revisi ini menyederhanakan registrasi menjadi **satu alur, tiga tahap**:

> Identifikasi Produk → Varian & GTIN → Kemasan (opsional) → Simpan

Yang tidak berubah: data dan sheet lama tetap ada, migrasi tidak destruktif, dan semua penyimpanan tetap atomik di dalam lock.

Dokumen sebelumnya: [REVISI-V4.md](REVISI-V4.md) (v4) dan [REVISI-ANALISIS.md](REVISI-ANALISIS.md) (v3).

## 1. Ringkasan perubahan

| Area | v4 | v5 |
|---|---|---|
| Registrasi | Quick Entry / Advanced (4 tahap) | **Satu alur 3 tahap** dengan tombol Sebelumnya, Selanjutnya, Simpan Draft, Simpan Produk. Tahap 3 opsional. |
| Parent SKU | `PRD000123` | **`BRAND-KATEGORI-0001`**, mis. `HAN-PLB-0001`. Kode parent `0001` berasal dari counter `parent_no`, unik, dan tidak pernah dialokasikan ulang. |
| Child SKU | `SKU000456` | **`PARENT_SKU-BARCODE`**, mis. `HAN-PLB-0001-8991234567898`. Produk tanpa GTIN memakai barcode internal: `HAN-PLB-0001-2000000000060`. |
| Barcode Child SKU | GTIN / internal / boleh kosong | **Wajib**: pilih *Memiliki GTIN* (scan/ketik, divalidasi) atau *Tidak Memiliki GTIN* (barcode internal dibuat otomatis). |
| Nama Child SKU | Gabungan atribut | **Nama Produk SKU otomatis** = Brand + Nama Parent + atribut. Urutan atribut mengikuti Settings. Tanpa kata/satuan berulang (`50ml ml` → `50 ml`). Override nama wajib beralasan dan tidak mengubah SKU. |
| Satuan dasar | Per produk | Per Child SKU, dengan default untuk semua varian (PCS). |
| Logistik | — | **Dimensi (cm) & berat kotor (g/kg)** per satuan (PCS, BOX, …), disimpan terpisah di `PRODUCT_DIMENSIONS`. Status *Data kemasan belum lengkap* bila belum diisi. |
| Batch / expiry / masa simpan | Di formulir & ekspor | **Dihapus dari formulir dan ekspor.** Kolom lama tetap ada dan nilainya dipertahankan, tidak dihapus. |
| Satuan beli / jual (v4) | Di formulir | Tidak lagi ditampilkan; nilai lama dipertahankan. |
| Master Supplier | Menu Supplier & Supplier SKU Mapping | **Dihapus dari navigasi.** Data lama tetap tersimpan dan tidak menjadi syarat registrasi. Kode supplier tidak lagi dipakai untuk lookup identitas. |
| Master Brand / Kategori | Manual & "Tambah banyak" | **+ Upload Excel (.xlsx)**: pratinjau, jumlah Berhasil/Dilewati/Gagal, laporan per baris, dan import ulang tanpa duplikat. |
| Lookup | Scan Barcode | **Cari SKU / Scan** (untuk stock opname). Mencari lewat GTIN, barcode internal, Child SKU, Parent SKU, atau nama produk. Menampilkan *Unknown Barcode* bila tidak dikenal. Konflik identitas ditampilkan sebagai error, tidak dipilih acak. |

**Aturan SKU:**
- SKU **boleh dihitung ulang selama produk masih Draft**, misalnya bila brand, kategori, atau GTIN dikoreksi.
- **Sejak produk diaktifkan, Parent SKU dan Child SKU dibekukan.** Koreksi GTIN hanya mengganti barcode; barcode lama dipensiunkan dan historinya tercatat. SKU lama tetap, sehingga mapping BeeCloud dan marketplace aman.
- Perubahan nama, dimensi, berat, atau kemasan tidak pernah mengubah SKU.
- SKU yang pernah dialokasikan tidak dipakai barang lain. Relasi antar-tab tetap memakai ID internal (UUID), bukan string SKU.

## 2. Struktur Google Sheets

Nama tab **tidak diganti**, karena mengganti nama tab berisiko bagi data yang sudah ada. Padanan dengan nama di brief:

| Nama di brief | Tab yang dipakai | Perubahan v5 |
|---|---|---|
| `MASTER_BRANDS`, `MASTER_CATEGORIES` | sama | — |
| `PRODUCT_PARENTS` | `MASTER_PRODUCTS` | + kolom `ParentCode`. `ProductCode` = Parent SKU. |
| `PRODUCT_VARIANTS` | `PRODUCT_VARIANTS` | + `BaseUnit`, `ProductSKUName`, `NameOverride`, `NameOverrideReason`. `SKU` = Child SKU. |
| `PRODUCT_BARCODES` | `VARIANT_BARCODES` | — (BarcodeType `GTIN`/`INTERNAL` disimpan eksplisit; sumber lookup yang otoritatif) |
| `PACKAGING_CONVERSIONS` | `UNIT_CONVERSIONS` | — (QuantityPerUnit = `ConversionFactor`, ReferenceUnit = `ContainsUnit`) |
| `PRODUCT_DIMENSIONS` | **`PRODUCT_DIMENSIONS` (baru)** | DimensionID, VariantID, ProductID, PackagingUnit, LengthCm, WidthCm, HeightCm, GrossWeightGrams, UpdatedBy, UpdatedAt |
| `AUDIT_LOGS`, `SYSTEM_COUNTERS` | sama | + counter `parent_no` |
| staging/import | `IMPORT_BATCHES`, `IMPORT_ERRORS` | jenis baru `brand_list`, `category_list` |

Semua kolom baru ditambahkan di sebelah kanan, sehingga `setup()` aman dijalankan pada tab yang sudah berisi data.

## 3. Migrasi

- **Produksi saat ini berisi 0 produk**, jadi tidak ada SKU lama yang perlu dipertahankan atau diubah.
- Bila ada data v3/v4 (format `PRD…`/`SKU…`), datanya tetap berlaku apa adanya dan tidak ditulis ulang. Produk baru memakai format v5.
- Import template Excel lama dan migrasi v1 kini menghasilkan Parent/Child SKU format v5. Barang tanpa GTIN valid mendapat barcode internal, dan SKU lama tetap tercatat sebagai *legacy SKU*.
- Kolom batch/expiry/satuan beli-jual tidak dihapus dan nilainya dipertahankan saat produk diedit (diuji).

## 4. Deployment

1. Kode dikirim dengan `clasp push`, deploy versi baru ke deployment yang sama (URL tetap), lalu `git push` (GitHub Pages).
2. **Tidak perlu menjalankan `setup` manual.** Permintaan pertama setelah kode baru membuat tab `PRODUCT_DIMENSIONS`, kolom baru,
   dan penghitung `parent_no` secara otomatis (lihat README › Cara pasang / memperbarui). Tidak ada izin (scope) baru di v5.

## 5. Hasil pengujian (dijalankan 18 Okt 2026)

- **Otomatis:** `npm test`, **47 tes lulus**. Tes menjalankan file `.gs` asli di emulator Node (`test/harness.cjs`); 15 di antaranya tes baru v5 (`test/v5.test.cjs`).
  - Import Excel diuji dengan file `.xlsx` sungguhan yang dibuat pustaka SheetJS.
- **Browser:** pratinjau lokal (`dev/server.cjs`), desktop dan mobile 375 px.
  - Registrasi lengkap lewat UI: 2 Warna × 2 Volume, GTIN + satu tanpa GTIN, BOX 24 + KARTON 6 BOX, dimensi PCS/BOX, "Terapkan ke semua varian", lalu Simpan.
  - Detail produk dan tab Kemasan & Logistik.
  - Cari SKU (GTIN, Unknown Barcode, Parent SKU).
  - Upload Excel Master Brand, termasuk import ulang.
  - 13 halaman tanpa error JavaScript dan tanpa scroll horizontal di 375 px.
- **Produksi (Google Sheets asli): belum diuji.** Status Not Tested sampai `setup` dijalankan dan aplikasi dicoba.

| # | Uji minimal | Hasil (emulator) | Bukti |
|---|---|---|---|
| 1 | Registrasi Parent baru | Pass | v5 [T1][T2]; browser: tahap 1 → simpan |
| 2 | Parent SKU sesuai format | Pass | `HAN-<KAT>-0001`; pratinjau tidak mereservasi nomor |
| 3 | Produk tanpa varian | Pass | v5 [T3][T6]: satu Child SKU default |
| 4 | Kombinasi warna & ukuran | Pass | v5 [T4]: 4 Child SKU; browser: generator kombinasi |
| 5 | GTIN berbeda → Child SKU berbeda | Pass | v5 [T5] |
| 6 | Tanpa GTIN → barcode internal | Pass | v5 [T6]; browser |
| 7 | Scan GTIN menemukan produk yang tepat | Pass | v5 [T7]; browser Cari SKU |
| 8 | Scan barcode tidak terdaftar | Pass | v5 [T8] *Unknown Barcode*; konflik → error |
| 9 | Duplikasi barcode ditolak | Pass | v5 [T9] (antar-produk & dalam formulir) |
| 10 | Nama Child SKU tanpa pengulangan | Pass | v5 [T10] (`50ml ml` → `50 ml`, brand tidak ganda, urutan atribut) |
| 11 | BOX 24 PCS | Pass | v5 [T11]; browser |
| 12 | KARTON bertingkat | Pass | v5 [T12]: 1 KARTON = 6 BOX = 144 PCS |
| 13 | Dimensi PCS & BOX terpisah | Pass | v5 [T13]: satu baris per satuan |
| 14 | Berat PCS & BOX terpisah | Pass | v5 [T14]: 2,3 kg → 2300 g; tidak dihitung dari PCS |
| 15 | Tahap kemasan dilewati | Pass | v5 [T15]: tersimpan + *Data kemasan belum lengkap* |
| 16 | Import Master Brand XLSX | Pass | v5 [T16]; browser Upload Excel |
| 17 | Import Master Kategori XLSX | Pass | v5 [T17] |
| 18 | Import ulang tanpa duplikat | Pass | v5 [T18]; browser |
| 19 | Perubahan dimensi tidak mengubah SKU | Pass | v5 [T19] (juga nama, kemasan, rename brand) |
| 20 | Perubahan GTIN pada SKU aktif aman | Pass | v5 [T20]: SKU beku, barcode lama dipensiunkan, histori ada |
| 21 | Varian baru pada Parent existing | Pass | v5 [T21]: tidak ada Parent baru |
| 22 | Dua pengguna bersamaan | Pass (simulasi) | v5 [T22]: lock sibuk, versi basi ditolak, kode unik. Emulator tidak menjalankan eksekusi paralel sungguhan. |

## 6. Keterbatasan

- **Belum diuji di Google Sheets produksi.**
- **Konsekuensi format `PARENT_SKU-GTIN`:**
  - Setelah GTIN dikoreksi pada produk aktif, SKU masih memuat GTIN lama. Ini disengaja (SKU beku), tetapi bisa membingungkan; barcode yang benar selalu dicari lewat tabel barcode.
  - Panjang SKU ±26 karakter. **Batas panjang SKU di BeeCloud dan Shopee belum diverifikasi.**
- **Barcode internal EAN-13 prefix `200`** (rentang sirkulasi terbatas GS1). Belum diverifikasi apakah POS/scanner toko membaca prefix 2xx sebagai kode berat.
- **Nomor parent di pratinjau tahap 1 adalah perkiraan.** Bila dua orang menyimpan hampir bersamaan, nomor final bisa bergeser satu. Nomor final selalu unik.
- **Kode brand/kategori tetap otomatis 3 huruf**, mis. "Pelembab Wajah" → `PEL`, bukan `PLB` seperti contoh brief. Kode yang sudah ada tidak diubah.
- **Data uji di produksi:** brand `asda` (ASDAS) dan kategori `3ere` (WER) tampaknya data uji. Hapus dari halaman Master bila tidak dipakai.
- **Data supplier v4** dan modul Packaging & Bundle / Channel SKU Mapping tetap ada. Supplier hanya dihapus dari navigasi.

## 7. Rekomendasi berikutnya

1. Jalankan `setup`, lalu uji 22 skenario di atas langsung di produksi dengan dua akun.
2. Pastikan batas panjang SKU di BeeCloud dan Shopee sebelum mengekspor SKU v5.
3. Uji scan barcode internal `200…` di scanner/POS toko.
4. Impor daftar brand dan kategori toko lewat Upload Excel sebelum registrasi produk massal.
