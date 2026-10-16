# Master Produk & SKU — versi Google Apps Script

Web App Apps Script dengan **Google Sheets sebagai database**, berbahasa Indonesia, berisi modul:
dashboard, registrasi produk 6 langkah, direktori & detail produk, persetujuan (maker-checker),
brand & kategori, barcode (generator internal + registry + histori), SKU & kemasan (multipack, bundle/BOM),
import/export Excel, kualitas data, mapping BeeCloud/Shopee, audit trail, pengguna & pengaturan.

## Arsitektur

* **Database**: file Google Sheets terpisah [Master Produk DB](https://docs.google.com/spreadsheets/d/11f_luP2oWDJHklnG4BjxWTjXXRA57XuO-un6tuAJbm4/edit)
  di folder Drive `Master Produk Toko Kosmetik`. Skema tabelnya dirancang baru (20 tabel + tab "Tentang", lihat `SCHEMA` di `Config.gs`; sudah dibuat lengkap di Drive akun adm.meirista@gmail.com);
  template Excel lama hanya dipakai sebagai bahan analisis.
* **Aplikasi**: proyek Apps Script **mandiri** (tidak menempel di spreadsheet) yang membuka database lewat
  `DB_SPREADSHEET_ID` di `Config.gs`.

## Cara pasang (±10 menit, tanpa tool tambahan)

Lakukan dengan akun Google pemilik file database: **adm.meirista@gmail.com**.

1. Buka https://script.google.com › **Proyek baru** › beri nama "Master Produk & SKU".
2. Buat file sesuai isi folder [`src/`](src) (nama harus sama persis):
   * File skrip (**+ › Skrip**): `Config`, `Lib`, `Db`, `Auth`, `Barcodes`, `Products`, `Duplicates`, `Workflow`, `Mappings`, `Imports`, `Admin`, `Api` → salin isi `*.gs`.
   * File HTML (**+ › HTML**): `Index`, `Styles`, `Core`, `Pages`, `Wizard` → salin isi `*.html`.
   * **Setelan proyek** (ikon roda gigi) › centang *Tampilkan file manifes "appsscript.json"* › salin isi `appsscript.json`.
   * Hapus file bawaan `Kode.gs`/`Code.gs`.
3. Pastikan `DB_SPREADSHEET_ID` di `Config.gs` berisi ID file database (sudah terisi). Bila memakai file lain, ambil ID dari URL-nya: `docs.google.com/spreadsheets/d/<ID>/edit`.
4. Pilih fungsi **`setup`** › **Jalankan** › izinkan akses. Struktur tab sudah ada di file database; `setup` memeriksa/melengkapinya (header, format teks, tab "Tentang",
   pengaturan default, nomor urut) dan membuat **akun Admin pertama** (email akun Anda; password sementara ada di **Log eksekusi**).
   Aman dijalankan ulang: tab yang sudah ada tidak dihapus.
5. **Terapkan › Deployment baru › Jenis: Aplikasi web**:
   * *Jalankan sebagai*: **Saya** (pemilik) — staf tidak perlu akses ke file database.
   * *Siapa yang memiliki akses*: **Siapa saja yang memiliki Akun Google** (login aplikasi tetap wajib).
6. Buka URL Web App → login → **Pengaturan & Profil › Ganti password** → menu **Pengguna** untuk membuat akun staf.
7. Isi **Brand & Kategori** (menu Brand & Kategori, atau Import file berkolom Nama Brand, Kode Brand, Nama Kategori, Kode Kategori), lalu mulai registrasi produk.
8. (Disarankan) Di editor Apps Script, jalankan fungsi **`installDailyBackup`** sekali untuk backup harian otomatis ke Drive.

Setiap kali kode diubah: **Terapkan › Kelola deployment › Edit › Versi baru** (URL tetap sama).


### Alternatif: clasp (bagi yang terbiasa command line)

```bash
npm install -g @google/clasp
```
```bash
clasp login
```
Lalu buat `apps-script/.clasp.json` berisi `{"scriptId":"<ID skrip dari Setelan proyek>","rootDir":"src"}` dan jalankan:
```bash
clasp push
```

## (Opsional) Memasukkan data dari template Excel lama

Database dimulai kosong. Bila suatu saat ingin memasukkan data lama: menu **Import & Export** → pilih file `Template_Master_Produk_SKU_BeeCloud Fix.xlsx` (dibaca di browser), urutan:
1. *Referensi Brand & Kategori* (sheet Referensi Kode)
2. *Barcode Internal Terpakai* (sheet Generator Barcode Internal)
3. *Master Produk (template lama)*
4. *Listing Shopee* (sheet Data Performa Produk)

Hasil uji pada workbook asli (emulator): 121 brand + 76 kategori, 3 kode internal, **554 SKU** (114 produk) tersimpan,
118 baris ditolak dengan alasan jelas (113 tidak lengkap, 5 duplikat barcode Viva Air Mawar), **125 listing Shopee**
terpetakan. Unduh *laporan error*, perbaiki di Excel, lalu import ulang — baris yang sudah masuk otomatis dilewati.

## Desain penting (karena Google Sheets bukan database transaksional)

| Risiko di Sheets | Pengendalian di aplikasi |
|---|---|
| Dua orang menyimpan bersamaan | Semua penulisan lewat `LockService` (script lock) — diproses bergiliran |
| Tidak ada rollback | Perubahan **di-buffer di memori** dan baru ditulis setelah seluruh validasi sukses; bila error, tidak ada yang tertulis |
| Barcode/SKU berubah jadi angka (`8.99E+12`, nol hilang) | Semua sel berformat teks `@`; file import dibaca dengan nilai mentah lalu dikonversi utuh |
| Data diedit langsung di sheet | Web App "Execute as me" + staf tanpa akses edit; tab diberi proteksi peringatan; file database terpisah dari kode; semua aksi tercatat di `AuditLog` |
| Duplikasi SKU/barcode/kode | Dicek di dalam lock sebelum menulis (SKU unik selamanya, barcode satu pemilik aktif) |
| Alokasi barcode internal ganda | Nomor urut di tab `Sequences`, dialokasikan di dalam lock, kode yang sudah ada dilewati, `requestKey` idempoten |
| Kehilangan data | Fungsi `backupNow` + backup harian otomatis `installDailyBackup` (salinan file database di Drive) |

**Batas wajar**: nyaman untuk ribuan SKU (puluhan ribu baris) dan beberapa staf bersamaan. Batas Google: eksekusi
maks. 6 menit per aksi, ±10 juta sel per spreadsheet. Bila sudah melewati ±30–50 ribu SKU atau banyak pengguna
bersamaan, gunakan basis data PostgreSQL (perlu dibangun terpisah).

Login memakai akun aplikasi sendiri (email + password, hash SHA-256 ber-salt, kunci 15 menit setelah 5 kali gagal),
karena untuk akun Gmail biasa Apps Script tidak memberikan email pengunjung saat Web App dijalankan sebagai pemilik.

## Yang masih perlu Anda verifikasi

* Kolom ekspor BeeCloud (`BEECLOUD_EXPORT_COLUMNS` di `Config.gs`) **belum** dicocokkan dengan template import resmi BeeCloud.
* Batas panjang SKU BeeCloud & Seller SKU Shopee (format lama = 31 karakter).
* Scanner/POS membaca barcode internal prefix `200` sebagai kode biasa.
* Unduhan file dari Web App bisa diblokir sebagian browser — gunakan tombol **"→ Tulis ke tab spreadsheet"**.

## Pengujian & pratinjau lokal (untuk developer)

```bash
npm test
```
```bash
npm run dev
```
Test menjalankan file `.gs` asli di emulator layanan Apps Script (`test/harness.cjs`) — 15 skenario: registrasi, varian,
paket 1/6/12/24, bundle, barcode/SKU duplikat, alokasi barcode, GTIN tidak valid, change request + maker-checker,
penolakan & revisi, hak akses, import sebagian bermasalah + idempoten, mapping & ekspor. Server pratinjau menyajikan UI
di http://localhost:8790 dengan data contoh (akun development tercantum di `dev/server.cjs`).

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
