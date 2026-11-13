# Revisi V10 — Pemeriksaan SKU Shopee melalui web

Integrasi kini menyediakan satu halaman **SKU Mapping Shopee**. Tab TikTok, Tokopedia, BeeCloud, kanal lain, dan SKU lama tidak ditampilkan lagi. Riwayat lama pada database tetap tersedia untuk penelusuran; tidak ada penghapusan tabel/data historis.

## Daftar dan pemeriksaan

- Tabel menampilkan nama produk dan variasi Shopee, ID produk/variasi, SKU induk, SKU, GTIN, harga/stok snapshot, pasangan SKU/GTIN master, jenis penjualan, BOM, status, dan catatan.
- Pencarian, pagination, filter toko, jenis penjualan, status, dan stok tersedia. GTIN paket tidak diambil dari GTIN komponen.
- Pemeriksa memilih SKU barang / MP / BD, menentukan jenis, total unit dan komponen, lalu mengakui pemeriksaan sebelum menyetujui. Paket kombinasi harus memakai BD dengan BOM yang sesuai; request mix tanpa komposisi tetap tidak dapat disetujui lewat alur ini.
- Persetujuan mencatat pengguna/waktu dan membuat mapping Shopee ke identitas master. Ini bukan perubahan otomatis di Shopee. Kolom SKU induk listing tidak dipakai untuk menentukan isi pesanan.
- Perubahan nama/variasi/SKU pada tarikan berikutnya memicu pemeriksaan ulang dan menonaktifkan mapping lama. Perubahan master sejak pratinjau ditolak saat simpan; perubahan setelah persetujuan ditandai tidak sesuai.

## Data dan pembaruan

`SHOPEE_LISTINGS` menyimpan snapshot dan review terpisah dari `EXTERNAL_SKU_MAPPINGS`, sehingga listing tanpa pasangan tetap tampil. Identitas stabil adalah toko + ID produk + ID variasi. Versi listing mencegah dua pemeriksa saling menimpa. Penulisan menggunakan lock dan jurnal transaksi yang sudah ada.

Migrasi sekali jalan membawa 5.007 baris tarikan 12 November 2026: 660 usulan dari hasil audit dan 4.347 baris yang perlu diperiksa. Usulan divalidasi lagi terhadap nama, SKU, GTIN, dan BOM master saat migrasi, bukan disetujui atas nama pengguna. Listing yang sudah ada tidak ditimpa.

Snapshot awal `DataShopeeReview.gs` merupakan bootstrap lokal untuk deployment Apps Script dan tidak diikutkan ke repository publik. Sesudah migrasi, data tersimpan pada `SHOPEE_LISTINGS`; pembaruan berikutnya memakai unggahan tarikan oleh pengguna melalui halaman web.

Tombol **Perbarui tarikan Shopee** membaca template Excel/CSV dan mengirim batch maksimal 150 baris dari browser. Server menerima maksimal 200 baris per transaksi dan melakukan upsert. Impor ulang tidak menggandakan listing; harga dan stok hanya snapshot, bukan sinkronisasi stok live.

## Pengujian

`npm test` mencakup parser template, ID teks, pembatasan akses, upsert/idempotensi, pencarian/filter/pagination, SKU satuan vs MP/BD, komposisi salah, signature master, konflik versi, perubahan snapshot, dan keamanan migrasi awal. Pratinjau dengan snapshot master lokal memverifikasi 5.007 listing / 660 usulan / 4.347 perlu verifikasi, serta alur persetujuan `MP000243 = 3 × PRD000168-003`.

Untuk pratinjau developer dengan data nyata, jalankan `npm run dev` dengan `PREVIEW_MASTER_XLSX` menunjuk salinan database lokal. Hanya tabel katalog yang disalin ke emulator; akun produksi tidak dibaca atau ditiru.

Pembaruan struktur berjalan otomatis setelah backend baru diterapkan. Frontend Apps Script dan GitHub Pages sama-sama menyertakan `Shopee.html` melalui `Index.html`.
