# REVISI V7 — Upgrade UI/UX, Mode Staf Foto (HP), Kelengkapan Data & Performa

Upgrade bertahap di atas aplikasi yang sudah berjalan (bukan bangun ulang). Data lama tidak diubah; struktur baru
ditambahkan otomatis (`autoSchema_`): tab `PRODUCT_PHOTOS` dan kolom foto di ujung kanan `PRODUCT_VARIANTS`.

## 1. Hasil audit (sebelum upgrade)

| Area | Temuan | Tindakan |
|---|---|---|
| Navigasi | 5 grup menu teknis; Brand, Kategori, Barcode, Data Quality masing-masing menu sendiri | Menu per fungsi bisnis; Brand/Kategori jadi tab Master Produk; Barcode & Kualitas data jadi alat di Master Produk |
| Master Produk | Sudah server-side pagination + indeks direktori di-cache per versi data (bukan seluruh DB ke browser) | Dipertahankan; ditambah filter kelengkapan |
| Detail produk | Membaca 8 tab penuh setiap kali dibuka (±0,5 s di 10.000 SKU, emulator) | Cache detail per versi data |
| `Table_.byId` | Pencarian linear per panggilan | Peta ID → baris (O(1)) |
| Registrasi | Brand/kategori baru harus dibuat di halaman lain | Tambah langsung dari dropdown (modal kecil, cek duplikat di server) |
| Foto | Unggah foto per SKU sudah ada (Drive), tanpa riwayat, tanpa alur kerja staf | Mode Staf Foto + riwayat + penugasan + review opsional |
| Kelengkapan | GTIN dianggap satu-satunya ukuran; dimensi kosong tampil sebagai masalah | Wajib / Disarankan / Opsional |
| Hak akses | `user.changePassword` butuh `product.read` | Izin `self` (cukup login) |

## 2. Navigasi baru

```
DASHBOARD          Dashboard
MANAJEMEN PRODUK   Master Produk  [tab: Produk · Brand · Kategori | alat: Foto · Kualitas data · Barcode]
                   Registrasi Produk
                   Kemasan & Bundling
INTEGRASI          Channel SKU Mapping · Import & Export
SISTEM             Pengguna & Hak Akses · Pengaturan · Audit Log
```

- Sidebar bisa diciutkan (ikon + tooltip), menu aktif bergaris aksen, grup bisa dibuka/tutup. Tautan lama tetap jalan.
- HP (admin): navigasi bawah Beranda · Produk · (+) Registrasi · Kemasan · Menu.

## 3. Mode Staf Foto (peran baru `photo_staff`, izin `photo.work` saja)

Alur: **Beranda → Mulai Lengkapi Foto → Ambil Foto / Pilih dari Galeri → Pratinjau → Simpan & Lanjut → produk berikutnya**.

- Masuk langsung ke halaman kerja foto; navigasi bawah 3 menu (Beranda, Foto Produk, Profil). Menu admin tidak tampil
  dan **server menolak** semua aksi master data (diuji: `product.list`, `product.save`, `brand.create` → FORBIDDEN).
- Cari besar “Cari nama produk atau scan barcode”, scan kamera HP / scanner USB; barcode tidak dikenal → tidak membuat
  produk, tersedia “Cari manual” & “Laporkan ke Admin” (tercatat di Audit Log, aksi `photo.report`).
- Filter: Belum Difoto · Perlu Diperbaiki · Selesai. Daftar kartu + “Muat lebih banyak” (20 per halaman).
- Foto diperkecil di HP (1600 px JPEG), status unggah tampil, gagal → foto tetap di layar + “Coba Kirim Lagi”
  (kode permintaan sama → tidak dobel). Sukses hanya setelah file tersimpan di Drive **dan** tercatat di database.
- Foto ditautkan ke **VariantID** (SKU Produk), disimpan di `Foto Produk (Master SKU)/<Brand>/<SKU>-utama-<waktu>.jpg`.
- Anti salah timpa: bila orang lain sudah mengganti foto, simpan ditolak (`CONFLICT`) kecuali dipilih “Tetap ganti”.
- Lewati produk, lanjut otomatis ke varian lain dari produk yang sama lebih dulu.

Admin (Master Produk › Foto): ringkasan %, filter (Tanpa foto, Perlu foto ulang, Menunggu review, Foto tersedia),
filter staf, pilih banyak → **Tugaskan** ke staf / **Minta foto ulang** (alasan terlihat staf) / **Setujui**;
klik thumbnail → foto besar + riwayat unggahan (siapa, kapan). Pengaturan: “Review foto oleh Admin” (default mati).

## 4. Kelengkapan data

| Tingkat | Data |
|---|---|
| Wajib | Brand, kategori, nama, SKU (dibuat sistem) — selalu terpenuhi untuk produk terdaftar |
| Disarankan | GTIN / barcode internal, foto, berat satuan |
| Opsional | Dimensi P×L×T, kemasan BOX |

Master Produk: kolom **Kelengkapan** (“Data lengkap” atau “Perlu: Foto, Berat”), terpisah dari status lifecycle;
filter Perlu dilengkapi / Tanpa GTIN / Tanpa foto / Tanpa berat / Data lengkap. Dashboard: meter bisa diklik.

## 5. Registrasi

- Dropdown Brand & Kategori: ketik nama baru → “+ Tambahkan brand "…"” → modal (nama bisa diperbaiki) → tersimpan &
  langsung terpilih, isian form tidak hilang. Duplikat ditolak server (abaikan besar/kecil huruf, spasi, tanda baca);
  nama mirip minta konfirmasi. Keyboard: panah + Enter.
- Nama final tetap otomatis berawalan brand tanpa dobel (sudah ada di `buildSkuName`). Draf otomatis tetap berjalan.

## 6. Benchmark (emulator, `node tools/bench.cjs`; sebelum = commit 3fb6b3b)

Waktu logika server dalam ms (tanpa latensi jaringan & baca Google Sheets nyata — untuk membandingkan versi).

| SKU | Daftar (cache) sebelum → sesudah | Cari GTIN | Detail pertama | Detail dibuka ulang | Daftar foto |
|---|---|---|---|---|---|
| 1.000 | 2,9 → 3,7 | 2,2 → 2,7 | 62 → 58 | **53 → 0,1** | 7,8 |
| 5.000 | 29 → 12 | 17 → 12 | 434 → 292 | **336 → 0,2** | 48 |
| 10.000 | 19,5 → 35 | 20 → 24 | 510 → 658 | **538 → 0,2** | 103 |

Payload satu halaman Master Produk ±31 KB (25 baris) di semua ukuran. Indeks direktori dibangun ulang hanya setelah
data berubah (±0,8 s di 10.000 SKU, emulator). Angka bervariasi ±30% antar-run (emulator).

## 7. Pengujian

`npm test`: 74 lulus (termasuk `test/photo.test.cjs`: hak akses staf, daftar & scan, simpan & lanjut, kirim ulang tanpa
dobel, CONFLICT, minta foto ulang, penugasan, review, filter kelengkapan). Dicoba di emulator lokal (layar HP 375 px):
login staf → mulai → pilih foto → simpan → lanjut ke varian berikutnya; staf membuka dashboard dialihkan ke Beranda foto.

## 8. Belum dikerjakan / catatan

- Uji di perangkat nyata (Android Chrome, iPhone Safari, izin kamera) belum dilakukan — baru emulator.
- Format kode varian tetap `PRD000503-001` (tidak diubah ke `-V01`: dipakai di mapping kanal, import, barcode).
- Foto tambahan (belakang/detail) sudah didukung server (`kind: EXTRA`) tetapi belum ada tombolnya di layar staf;
  jumlah foto wajib yang bisa diatur Admin, crop/rotate, dan antrean unggah offline belum dibuat.
- Tabel Master Produk: pengaturan kolom, pilihan jumlah baris, dan menu aksi dropdown per baris belum dibuat.
- Membuka detail produk pertama kali masih membaca tab penuh; bila di produksi terasa > 2 s, langkah berikutnya
  pembacaan per produk (TextFinder pada kolom ProductID).
