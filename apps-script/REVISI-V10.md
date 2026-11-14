# Revisi V10 — Pemeriksaan SKU Shopee melalui web

## Form seragam dan cache daftar

Registrasi MP/BD di Kemasan & Bundling dan pemetaan Shopee memakai renderer baris SKU–qty dan pilihan barcode yang sama: Tanpa barcode, GTIN, atau Barcode internal. Mode stok tidak ditampilkan. Paket baru memakai perilaku virtual yang sudah menjadi default sistem; data mode paket historis dipertahankan. Paket pilih sendiri dihapus dari daftar/form dan pembuatan melalui API ditolak; arsip lama tidak dihapus.

Barcode paket baru dibuat dalam transaksi pembuatan paket/pemetaan yang sama. Barcode paket yang sudah ada ditampilkan dari master; perubahan memerlukan izin mengubah produk, pemeriksaan signature, validasi barcode unik dan audit histori. Barcode internal tidak ditulis sebagai GTIN dalam template Shopee.

Cache browser per akun bertahan dua menit dalam sesi tab: daftar terakhir langsung digambar, lalu diperbarui dari server. Permintaan bersamaan untuk filter yang sama digabungkan. Logout, sesi kedaluwarsa, dan penulisan data mengosongkan cache. Cache server memakai versi data dan diganti setelah perubahan master/listing. Proses simpan dan unduh tetap memvalidasi data sumber terbaru, bukan snapshot tampilan.

## Paket langsung dari pemetaan Shopee

Popup kini hanya memiliki satu definisi isi penjualan: jenis Satuan/MP/BD, Child SKU barang, dan qty per baris. Satuan selalu qty 1; MP satu SKU dengan qty minimal 2; BD minimal dua SKU barang berbeda. Tidak ada input total unit atau editor komposisi kedua.

Sistem mencocokkan BOM secara persis (urutan baris diabaikan) dan memakai SKU paket aktif yang sudah tersedia. Jika belum ada, tombol **Buat paket baru & setujui** membuat paket virtual di Kemasan & Bundling sekaligus menyimpan pemetaan dan persetujuan dalam satu transaksi. Nama paket dibuat otomatis. Paket nonaktif dengan isi sama ditampilkan sebagai hambatan agar tidak digandakan. Paket pilih sendiri tidak dianggap BD berkomposisi tetap.

Preview tidak menulis data. Pembuatan baru membutuhkan izin `product.write` dan pemetaan membutuhkan `mapping.write`. Server memeriksa ulang fingerprint SKU barang, BOM, signature master, dan versi listing di dalam lock. Jika paket yang sama dibuat pengguna lain sesudah preview, paket tersebut dipakai ulang. Bila penyimpanan gagal, paket, BOM, counter SKU, mapping, dan persetujuan dibatalkan bersama.

Integrasi kini menyediakan satu halaman **SKU Mapping Shopee**. Tab TikTok, Tokopedia, BeeCloud, kanal lain, dan SKU lama tidak ditampilkan lagi. Riwayat lama pada database tetap tersedia untuk penelusuran; tidak ada penghapusan tabel/data historis.

## Daftar dan pemeriksaan

- Tabel ringkas menampilkan produk/variasi, SKU Shopee, SKU sistem, dan status. Kolom/card Shopee berwarna orange (#ee4d2d), master mengikuti warna mocha sistem. Detail menampilkan label terpisah dan urutan nama, variasi, identitas produk, SKU, dan GTIN.
- Pencarian, pagination, dan tiga filter status tersedia: Perlu diverifikasi (orange, ada target aktif namun belum disetujui), Disetujui (hijau), Tidak tersedia (merah, belum memiliki target aktif). GTIN paket tidak diambil dari GTIN komponen.
- Pemeriksa memilih jenis Satuan/MP/BD, lalu Child SKU barang dan qty per baris. Komposisi dan total unit mengikuti isian tersebut secara otomatis. Paket yang sudah ada digunakan ulang, paket baru dapat dibuat sekaligus disetujui tanpa ceklis. Catatan opsional untuk persetujuan. Paket kombinasi harus memakai BD dengan BOM yang sesuai; request mix tanpa komposisi tetap tidak dapat disetujui lewat alur ini.
- Persetujuan mencatat pengguna/waktu dan membuat mapping Shopee ke identitas master. Ini bukan perubahan otomatis di Shopee. Kolom SKU induk listing tidak dipakai untuk menentukan isi pesanan.
- Perubahan nama/variasi/SKU pada tarikan berikutnya memicu pemeriksaan ulang dan menonaktifkan mapping lama. Perubahan master sejak pratinjau ditolak saat simpan; perubahan setelah persetujuan ditandai tidak sesuai.

## Data dan pembaruan

`SHOPEE_LISTINGS` menyimpan snapshot dan review terpisah dari `EXTERNAL_SKU_MAPPINGS`, sehingga listing tanpa pasangan tetap tampil. Identitas stabil adalah toko + ID produk + ID variasi. Versi listing mencegah dua pemeriksa saling menimpa. Penulisan menggunakan lock dan jurnal transaksi yang sudah ada.

Migrasi sekali jalan membawa 5.007 baris tarikan 12 November 2026: 660 usulan dari hasil audit dan 4.347 baris yang perlu diperiksa. Usulan divalidasi lagi terhadap nama, SKU, GTIN, dan BOM master saat migrasi, bukan disetujui atas nama pengguna. Listing yang sudah ada tidak ditimpa.

Snapshot awal `DataShopeeReview.gs` merupakan bootstrap lokal untuk deployment Apps Script dan tidak diikutkan ke repository publik. Sesudah migrasi, data tersimpan pada `SHOPEE_LISTINGS`; pembaruan berikutnya memakai unggahan tarikan oleh pengguna melalui halaman web.

Tombol **Unggah template** membaca template .xlsx asli dan mengirim batch maksimal 150 baris dari browser. Server menerima maksimal 200 baris per transaksi dan melakukan upsert. Impor ulang tidak menggandakan listing; harga dan stok hanya snapshot, bukan sinkronisasi stok live.

## Pengujian

`npm test` mencakup parser template, ID teks, pembatasan akses, upsert/idempotensi, pencarian/filter/pagination, SKU satuan vs MP/BD, komposisi salah, signature master, konflik versi, perubahan snapshot, dan keamanan migrasi awal. Pratinjau dengan snapshot master lokal memverifikasi 5.007 listing / 660 usulan / 4.347 perlu verifikasi, serta alur persetujuan `MP000243 = 3 × PRD000168-003`.

Untuk pratinjau developer dengan data nyata, jalankan `npm run dev` dengan `PREVIEW_MASTER_XLSX` menunjuk salinan database lokal. Hanya tabel katalog yang disalin ke emulator; akun produksi tidak dibaca atau ditiru.

Pembaruan struktur berjalan otomatis setelah backend baru diterapkan. Frontend Apps Script dan GitHub Pages sama-sama menyertakan `Shopee.html` melalui `Index.html`.
# Alur template mass edit Shopee

SKU Mapping Shopee kini memakai tabel ringkas: produk, variasi, SKU asal, SKU sistem, status, dan tombol Periksa. Rincian GTIN dan komposisi paket tersedia di Periksa.

1. Unggah template `.xlsx` asli Shopee (lembar produk ditemukan berdasarkan judul kolom, termasuk jika bukan lembar pertama).
2. Periksa usulan dan setujui pasangan. Nama persis atau GTIN unik dapat menghasilkan usulan baru; persetujuan tetap memeriksa jenis dan komposisi satuan/MP/BD.
3. Unduh hasil. Server memeriksa ulang identitas file, persetujuan, serta signature master. Hanya pasangan yang disetujui dan masih berlaku yang mengubah SKU dan GTIN. GTIN paket kosong di master menghasilkan GTIN kosong, tidak menyalin GTIN komponennya.

SKU induk diisi dari parent master hanya jika seluruh variasi produk dalam file disetujui dan memiliki parent yang sama. Bila berbeda atau masih ada variasi belum disetujui, SKU induk asli dipertahankan. File mempertahankan seluruh baris dan kolom lain, harga, stok, ID, petunjuk, format, validasi Excel, dan lembar lain. Implementasi hanya menambal sel terpilih di XML ZIP asli. Baris belum disetujui tetap seperti asal, termasuk kode lama yang mungkin masih ada.

File asli disimpan di memori tab browser selama sesi ini. Setelah refresh atau menutup tab, unggah kembali file yang sama untuk mengunduh; hasil pemeriksaan tetap tersimpan di database. File pengguna tidak dimasukkan ke repository publik.

Popup dapat ditutup memakai Esc. Detail dibuka dari snapshot tabel tanpa permintaan tambahan. Sesudah persetujuan tersimpan, baris/status diperbarui dari respons server tanpa memuat ulang daftar. Backend memakai target yang sudah divalidasi untuk memperbarui mapping pada transaksi yang sama tanpa membangun ulang seluruh katalog sellables. Konflik versi, signature master, validasi komposisi, lock, dan rollback tetap berlaku.
