# Master Produk & SKU — Google Apps Script (v4)

Web App Apps Script dengan **Google Sheets sebagai database**, berbahasa Indonesia, tampilan mengikuti **FMS**
(font Nunito, sidebar gelap, toast, modal). Hierarki data:

```
Brand + Kategori → Parent SKU (PRD…, non-stockable) → Child SKU (SKU…, stockable) → Barcode (GTIN / internal 200…)
                                         ├→ Kemasan & konversi (BOX/KARTON, satuan beli/jual, histori isi)
                                         ├→ Kode supplier  ·  Listing kanal (Shopee/TikTok/Tokopedia/BeeCloud)
                                         └→ Komponen multipack (MP…) / bundle (BDL…)
```

Menu (sidebar dapat dilipat, dengan breadcrumb): Dashboard · Data Quality · Registrasi (scan GTIN + auto-fill Open Beauty Facts, Quick Entry / Advanced, Simpan Draft) ·
Master Produk · Scan Barcode (F2) · Master Brand · Master Kategori · Master Supplier · Supplier SKU Mapping · Packaging & Bundle ·
Channel SKU Mapping · Registry Barcode · Import & Export · Pengguna · Settings · Audit Log. Tanpa harga, tanpa approval, tanpa transaksi stok.

Dokumen v4 (arsitektur, ERD, skema, migrasi, deployment, panduan, test matrix, keterbatasan): **[REVISI-V4.md](REVISI-V4.md)**.
Revisi sebelumnya: [REVISI-ANALISIS.md](REVISI-ANALISIS.md) (v3).

## Struktur kode (`src/`)

| File | Isi |
|---|---|
| `Code.gs` | `doGet`/`doPost`, router API + hak akses, `setup()`, backup |
| `Config.gs` | ID database, skema tab, role, pengaturan default |
| `DatabaseService.gs` | Akses Sheets (batch), lock, staging, jurnal transaksi & rollback |
| `Lib.gs` | Aturan murni: GTIN, normalisasi nama, kode otomatis, SKU, kombinasi varian, konversi |
| `MasterDataService.gs`, `BrandService.gs`, `CategoryService.gs` | Master brand & kategori |
| `ProductService.gs`, `VariantService.gs`, `UnitConversionService.gs` | Registrasi/edit produk, varian, konversi kemasan |
| `BarcodeService.gs` | Registry GTIN & barcode internal |
| `LifecycleService.gs` | Status Draft/Aktif/Nonaktif/Discontinued/Diarsipkan, riwayat, deprecation SKU |
| `SupplierService.gs`, `BundleService.gs` | Master supplier & kode supplier; multipack, mixed bundle, request mix (BOM) |
| `MappingService.gs` | Channel SKU mapping (Shopee/TikTok/Tokopedia/BeeCloud/lainnya) & ekspor |
| `GtinLookupService.gs`, `AttributeService.gs`, `DataQualityService.gs` | Lookup GTIN + auto-fill, master nilai atribut, laporan kualitas data |
| `AdminService.gs`, `AuthService.gs` | Pengguna, pengaturan, dashboard, audit, login |
| `MigrationService.gs`, `ImportService.gs` | Migrasi v1/v2 → v4, import template Excel lama, listing marketplace, kode supplier |
| `Index.html`, `Styles.html`, `Scripts.html`, `Pages.html`, `Ops.html`, `Wizard.html`, `Logo.html` | Antarmuka (HTML Service, vanilla JS) |

## Database

File Google Sheets terpisah [Master Produk DB](https://docs.google.com/spreadsheets/d/11f_luP2oWDJHklnG4BjxWTjXXRA57XuO-un6tuAJbm4/edit). Struktur tab v4 lihat REVISI-V4.md §3.

## Cara pasang / memperbarui

1. Kode dikirim ke proyek Apps Script dengan `clasp push` (atau salin manual semua file `src/`).
2. Di editor Apps Script pilih fungsi **`setup`** › **Jalankan** › izinkan akses. `setup` aman diulang:
   membuat/melengkapi tab, mengisi pengaturan, **memigrasikan data struktur lama** (tab lama tidak dihapus), dan membuat
   akun Admin pertama bila belum ada (password sementara di **Log eksekusi**).
   v4 meminta izin baru **terhubung ke layanan eksternal** (UrlFetchApp, untuk lookup GTIN Open Beauty Facts) — klik *Izinkan*.
3. **Terapkan › Kelola deployment › Edit › Versi baru** (URL Web App tetap sama).
4. (Disarankan) jalankan `installDailyBackup` sekali untuk backup harian otomatis ke Drive.

## Aturan identitas (permanen)

* Kode brand/kategori otomatis (default 3 huruf), unik, tidak berubah walau nama diperbaiki.
* Kode produk `PRD000123` dan SKU internal `SKU000456` dibuat otomatis, berurutan, tidak bergantung brand/kategori/GTIN.
* SKU lama & SKU BeeCloud/Shopee disimpan terpisah di `EXTERNAL_SKU_MAPPINGS` dan tetap bisa dicari/dipindai.
* GTIN di level varian; satu barcode = satu varian/kemasan. Ganti GTIN tersimpan wajib alasan; barcode lama dipensiunkan.
* Konversi kemasan berbasis kuantitas, per varian, tidak otomatis membuat SKU.

## Penyimpanan aman di Google Sheets

| Risiko | Pengendalian |
|---|---|
| Dua orang menyimpan bersamaan | `LockService` script lock untuk semua penulisan; cek versi produk |
| Tidak ada transaksi | Staging di memori → jurnal `TX_JOURNAL` → tulis batch → commit; gagal = rollback otomatis |
| Eksekusi terputus (timeout) | Jurnal PENDING dibatalkan otomatis pada penulisan berikutnya |
| Barcode/SKU berubah jadi angka | Semua sel teks `@`; ekspor XLSX menandai kolom SKU/barcode sebagai teks |
| Data diedit langsung di sheet | Web App "Execute as me", staf tanpa akses file; tab diberi proteksi peringatan; Audit Log |

## Yang masih perlu Anda verifikasi

* Hasil lookup Open Beauty Facts untuk produk Indonesia (cakupan tipis; brand sering kosong) — selalu direview sebelum disimpan.
* Kolom ekspor BeeCloud (`BEECLOUD_EXPORT_COLUMNS` di `Config.gs`) **belum** dicocokkan dengan template import resmi BeeCloud.
* Batas panjang SKU BeeCloud & Seller SKU Shopee.
* Scanner/POS membaca barcode internal prefix `200` sebagai kode biasa.

## Pengujian & pratinjau lokal (developer)

```bash
npm test
```
```bash
npm run dev
```
Test menjalankan file `.gs` asli di emulator layanan Apps Script (`test/harness.cjs`) — 32 tes termasuk import workbook Excel asli dan pemeriksaan statis frontend (lihat REVISI-V4.md §7).
Server pratinjau: http://localhost:8790 dengan data contoh (akun development tercantum di `dev/server.cjs`).

## Deploy otomatis dari GitHub

Workflow [`.github/workflows/deploy-apps-script.yml`](../.github/workflows/deploy-apps-script.yml) menjalankan test lalu
`clasp push` ke proyek Apps Script setiap ada push ke branch `main`. Siapkan sekali:

1. Aktifkan **Google Apps Script API** di https://script.google.com/home/usersettings (akun pemilik proyek).
2. Di komputer: `npx @google/clasp login` → login akun pemilik → salin isi file `~/.clasprc.json`
   (Windows: `C:\Users\<nama>\.clasprc.json`).
3. Di GitHub: **Settings › Secrets and variables › Actions › New repository secret**:
   * `CLASPRC_JSON` = isi file `.clasprc.json`
   * `SCRIPT_ID` = ID proyek Apps Script (Setelan proyek › ID Skrip)
   * `DEPLOYMENT_ID` (opsional) = ID deployment Aplikasi web (Terapkan › Kelola deployment), agar URL web app langsung memakai versi terbaru.

Gunakan repository **Private**: `CLASPRC_JSON` memberi akses ke akun Google, dan kode berisi ID file database.

## Tampilan di GitHub Pages (github.io)

Tampilan yang sama juga bisa dibuka di `https://admmeirista.github.io/master-produk-sku/`. Halaman itu statis;
datanya tetap diambil dari Web App Apps Script lewat `doPost` (API JSON), jadi Web App harus sudah di-deploy.

1. Deploy Web App dengan *Siapa yang memiliki akses*: **Siapa saja** (anonim) — wajib agar github.io bisa memanggilnya.
   Data tetap terlindungi oleh login aplikasi (token sesi dicek di server untuk setiap aksi).
2. Salin URL Web App (`https://script.google.com/macros/s/<ID>/exec`).
3. GitHub › **Settings › Secrets and variables › Actions › tab Variables › New repository variable**:
   `APPS_SCRIPT_URL` = URL tersebut.
4. GitHub › **Settings › Pages › Build and deployment › Source: GitHub Actions**.
5. **Actions › GitHub Pages › Run workflow**. Halaman muncul di `https://admmeirista.github.io/master-produk-sku/`.

GitHub Pages untuk repository **private** hanya tersedia pada paket GitHub berbayar (Pro/Team/Enterprise).
Pada akun gratis, repository harus **Public** agar Pages aktif.
