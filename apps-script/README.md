# Master Produk & SKU — Google Apps Script (v2)

Web App Apps Script dengan **Google Sheets sebagai database**, berbahasa Indonesia, tampilan mengikuti **FMS**
(font Nunito, sidebar gelap, toast, modal). Hierarki data:

```
Brand + Kategori → Product Master → Product Variant (SKU + GTIN/barcode) → Satuan Kemasan & Konversi
```

Menu: Dashboard · **Registrasi Produk** (Identifikasi → Varian → Satuan & Konversi → Simpan Produk) · Direktori Produk ·
**Master Brand** & **Master Kategori** (cukup isi nama, kode otomatis) · Barcode · Mapping BeeCloud/Shopee · Ekspor Data ·
Pengguna · Pengaturan · Audit Log. Tanpa harga dan tanpa approval — produk langsung aktif setelah disimpan.

Analisis revisi, perbandingan struktur, risiko & rencana migrasi: [REVISI-ANALISIS.md](REVISI-ANALISIS.md).

## Struktur kode (`src/`)

| File | Isi |
|---|---|
| `Code.gs` | `doGet`/`doPost`, router API + hak akses, `setup()`, backup |
| `Config.gs` | ID database, skema tab, role, pengaturan default |
| `DatabaseService.gs` | Akses Sheets (batch), lock, staging, jurnal transaksi & rollback |
| `Lib.gs` | Aturan murni: GTIN, normalisasi nama, kode otomatis, SKU, kombinasi varian, konversi |
| `MasterDataService.gs`, `BrandService.gs`, `CategoryService.gs` | Master brand & kategori |
| `ProductService.gs`, `VariantService.gs`, `UnitService.gs` | Registrasi/edit produk, varian, konversi satuan |
| `BarcodeService.gs` | Registry GTIN & barcode internal |
| `MappingService.gs` | Mapping BeeCloud/Shopee & ekspor |
| `AdminService.gs`, `AuthService.gs` | Pengguna, pengaturan, dashboard, audit, login |
| `MigrationService.gs` | Migrasi eksplisit data struktur v1 |
| `Index.html`, `Styles.html`, `Scripts.html`, `Pages.html`, `Wizard.html`, `Logo.html` | Antarmuka (HTML Service, vanilla JS) |

## Database

File Google Sheets terpisah [Master Produk DB](https://docs.google.com/spreadsheets/d/11f_luP2oWDJHklnG4BjxWTjXXRA57XuO-un6tuAJbm4/edit)
(`DB_SPREADSHEET_ID` di `Config.gs`). Tab utama: `MASTER_BRANDS`, `MASTER_CATEGORIES`, `MASTER_PRODUCTS`, `PRODUCT_VARIANTS`,
`UNIT_CONVERSIONS`, `BARCODE_REGISTRY`, `BARCODE_ASSIGNMENTS`, `SKU_MAPPINGS`, plus `Settings`, `Users`, `Sequences`, `AuditLog`,
`TX_JOURNAL`. Semua sel berformat teks; relasi memakai ID stabil (UUID), bukan nomor baris.

## Cara pasang / memperbarui

1. Kode dikirim ke proyek Apps Script dengan `clasp push` (atau salin manual semua file `src/`).
2. Di editor Apps Script pilih fungsi **`setup`** › **Jalankan** › izinkan akses. `setup` aman diulang:
   membuat/melengkapi tab, mengisi pengaturan, **memigrasikan data struktur lama** (tab lama tidak dihapus), dan membuat
   akun Admin pertama bila belum ada (password sementara di **Log eksekusi**).
3. **Terapkan › Kelola deployment › Edit › Versi baru** (URL Web App tetap sama).
4. (Disarankan) jalankan `installDailyBackup` sekali untuk backup harian otomatis ke Drive.

## Aturan identitas (permanen)

* Kode brand/kategori dibuat otomatis (default 3 huruf), unik, tidak berubah walau nama diperbaiki.
* Kode produk unik per brand; boleh diubah sebelum produk pertama kali disimpan.
* SKU varian = template `{BRAND}-{CATEGORY}-{PRODUCT}-{VARIAN}` (mis. `SCA-PAR-PEDP-OB50`), unik global, permanen.
* SKU kemasan ber-SKU = SKU varian + satuan + isi dasar (mis. `SCA-PAR-PEDP-OB50-BOX24`); GTIN unit dasar tidak diganti.
* GTIN ada di level varian (bukan product master); satu barcode = satu varian/kemasan. Mengganti GTIN tersimpan wajib alasan;
  barcode lama dipensiunkan dan tidak boleh dipakai barang lain.
* Konversi berbasis kuantitas: 1 BOX = 24 BOTOL; konversi bertingkat KARTON = 6 BOX = 144 BOTOL; isi boleh beda per varian.

## Penyimpanan aman di Google Sheets

| Risiko | Pengendalian |
|---|---|
| Dua orang menyimpan bersamaan | `LockService` script lock untuk semua penulisan; cek versi produk |
| Tidak ada transaksi | Staging di memori → jurnal `TX_JOURNAL` → tulis batch → commit; gagal = rollback otomatis |
| Eksekusi terputus (timeout) | Jurnal PENDING dibatalkan otomatis pada penulisan berikutnya |
| Barcode/SKU berubah jadi angka | Semua sel teks `@`; ekspor XLSX menandai kolom SKU/barcode sebagai teks |
| Data diedit langsung di sheet | Web App "Execute as me", staf tanpa akses file; tab diberi proteksi peringatan; Audit Log |

## Yang masih perlu Anda verifikasi

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
Test menjalankan file `.gs` asli di emulator layanan Apps Script (`test/harness.cjs`) — 15 skenario (lihat REVISI-ANALISIS.md).
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
