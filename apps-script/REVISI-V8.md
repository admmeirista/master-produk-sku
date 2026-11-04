# REVISI V8 — SMS Meirista: Mobile-first Scan & Registrasi, Champagne Mocha

## 1. Asesmen arsitektur (kondisi nyata repo)

| Komponen | Temuan |
|---|---|
| Frontend | HtmlService (Apps Script) + PWA di GitHub Pages (`tools/build-pages.cjs`); JS tanpa framework, komponen fungsi (`combo`, `modal`, `toast`, `CamScan`, `pager`) |
| Backend | Google Apps Script (`api(token, action, payload)`), satu pintu `ROUTES` dengan izin per aksi, `withLock_` + jurnal transaksi + rollback |
| Database | Google Sheets (satu spreadsheet = **source of truth** tunggal untuk web & HP) |
| Scanner | `BarcodeDetector` bawaan browser, cadangan ZXing 0.20 (dimuat saat perlu) |
| Peran | Admin, Admin Data, Staf Foto, Viewer — dicek di server |
| Integrasi data | Import Excel (format sistem, referensi, barcode internal, listing kanal, mapping supplier), job katalog sekali jalan (`DATA_JOBS_`), ekspor BeeCloud/Shopee, lookup GTIN Open Beauty Facts (opsional) |
| Integrasi sistem perusahaan (ERP/API) | **Tidak ada** di repo: tidak ada kontrak API, kredensial, atau skema sumber. Tidak dibuat konektor/dummy API. |

Kepemilikan atribut: semua atribut SKU dimiliki SMS Meirista (Sheets). Data katalog pemasok masuk lewat import yang
tervalidasi (GTIN check digit, duplikat, kategori baku) dan **tidak pernah menimpa** data yang sudah terisi — hanya
mengisi yang kosong; GTIN berbeda / kombinasi ganda ditolak atau dilewati dengan alasan di laporan import.

Usulan bila integrasi perusahaan disetujui: endpoint server-to-server (Apps Script `doPost` dengan kunci layanan di
Script Properties, bukan di browser) → validasi payload → tahap pratinjau (`import.preview` yang sudah ada) → upsert
terotorisasi lewat `importRun_` (idempoten, tercatat di `IMPORT_BATCHES`/`IMPORT_ERRORS`/Audit Log). Perlu dari Anda:
nama sistem sumber, format/field, frekuensi, dan aturan prioritas field.

## 2. Masalah utama sebelum revisi

- HP: navigasi bawah berisi Registrasi/Kemasan; scan hanya popup dari kolom cari, hasil scan langsung jadi daftar produk
  (tanpa tindakan "belum terdaftar → registrasi"), beranda HP = dashboard desktop yang dirapatkan.
- Identitas: logo & aset dari FMS (`fms-meirista`), palet oranye/hijau.
- Scanner mendeteksi 8 format (termasuk QR, Code 39, ITF) yang tidak dipakai barang.

## 3. Yang diubah

**Design system — Champagne Mocha:** token warna di `:root` (sidebar #62564D, aktif #76685E, tombol #996A51/#80553F,
latar #F8F5EF, kartu #FFFDF9, champagne #C9A98B, copper #A65F49, teks #302923/#716860, garis #E9E1D6, sukses #36795D,
peringatan #A87429, bahaya #B9433D), radius 12 px, bayangan tipis. Teks di sidebar #F1E8DE/#E3D5C6 (kontras ≥ 4,5:1);
tombol putih di #996A51 = 4,6:1. Font Nunito.

**Branding:** logo SMS Meirista (monogram + “SMS”) di sidebar, halaman masuk, favicon, ikon PWA 192/512/maskable,
apple-touch-icon; nama “SMS Meirista — SKU Management System”; aset FMS tidak dipakai lagi.

**HP (≤ 760 px):**
- Navigasi bawah: Beranda · SKU · **Scan** (tombol tengah) · Aktivitas · Akun (label selalu tampil, target ≥ 44 px, safe-area).
- **Beranda HP:** sapaan, tombol besar Scan Barcode, Registrasi SKU, 3 angka ringkas, “Perlu tindakan” (error data,
  draft, tanpa barcode, tanpa foto), aktivitas terbaru.
- **Scan Barcode (halaman penuh):** kamera tetap menyala, bingkai panduan, status terbaca layar (aria-live), senter
  bila didukung, input manual. Setelah terbaca 2× sama → decoding berhenti (tidak scan berulang) → `barcode.lookup`
  server (hasil per kode di-cache dalam sesi). Hasil: *terdaftar* (kartu SKU + salin kode + Lihat Detail),
  *belum terdaftar* (GTIN valid → **Registrasi SKU Baru** dengan GTIN terisi otomatis), *barcode internal*,
  *check digit salah*, *konflik* (satu barcode di beberapa barang — tidak ada perubahan, minta tinjau), gagal jaringan
  (Coba Lagi). Kamera dilepas saat pindah halaman, aplikasi ke latar belakang, atau halaman ditutup.
- Format scan dibatasi: EAN-13, EAN-8, UPC-A, UPC-E, Code 128.
- **Aktivitas:** riwayat registrasi/perubahan (milik saya / semua), tap → detail produk.
- **Akun:** profil, menu modul lain sesuai hak akses, ganti password, keluar.

**Web:** menu “Scan Barcode” di Manajemen Produk (bisa dengan scanner USB), dashboard: panel **Status import data**
(4 batch terakhir: baris, diproses, dilewati, ditolak) — status sinkron yang benar-benar ada.

Pencegahan duplikat tetap di server (barcode unik per registry, `requestKey` idempoten, lock + rollback).

## 4. File

`src/Mobile.html` (baru: `CamScan.mount`, `Pages.scan`, `Pages.activity`, `Pages.account`, `mobileHome`),
`src/Logo.html`, `src/Styles.html` (token + v6.16), `src/Scripts.html` (nama, menu, navigasi bawah, format scan,
`App.onLeave`), `src/Pages.html` (beranda HP, status import), `src/AdminService.gs` (`imports`), `src/Config.gs`,
`src/Index.html`, `pages/*` (ikon, manifest), `tools/build-pages.cjs`.

## 5. Pengujian & performa

- `npm test`: 74 lulus.
- Emulator lokal (HP 375 px): beranda, navigasi bawah, scan manual (terdaftar → kartu; GTIN baru → Registrasi dengan
  GTIN terisi; check digit salah → pesan), izin kamera ditolak → pesan + input manual, Aktivitas, Akun, tanpa geser
  horizontal. Desktop 1280 px: dashboard & sidebar.
- Ukuran halaman: 405 KB → 440 KB (gzip 107 → 122 KB; +11 KB logo baru). Lokal: LCP 688 ms, CLS 0, DCL 221 ms
  (localhost, tanpa latensi jaringan nyata).

## 6. Batasan & risiko

- Scan kamera **belum diuji di HP sungguhan** (pane uji memblokir kamera) — perlu dicoba di Android Chrome & iPhone Safari.
- iPhone memakai ZXing (dimuat dari unpkg saat pertama scan) — butuh internet saat pertama kali.
- Integrasi sistem perusahaan belum ada sumber & kontraknya — tidak dibuat.
- Halaman detail SKU di HP masih memakai tata letak yang ada (sudah berbasis kartu); belum didesain ulang khusus.
- INP belum diukur (perlu interaksi nyata di perangkat).
