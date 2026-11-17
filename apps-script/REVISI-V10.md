# Revisi V10 — Pemeriksaan SKU Shopee melalui web

## Kartu status, impor terpusat dan ekspor pilihan

Unggah template Shopee dipindahkan ke **Import & Export → Import**. Pengguna dengan `mapping.write` dapat mengakses unggahan Shopee tanpa memperoleh izin impor master (`import.run`). SKU Mapping menampilkan semua listing tersimpan, kartu jumlah/persentase Semua variasi, Perlu diverifikasi, Disetujui, dan Tidak tersedia. Persentase menggunakan total listing sebagai denominator; kartu juga berfungsi sebagai filter.

Hanya baris Disetujui yang dapat dicentang. Pilihan bertahan saat paging/filter atau berpindah ke Import & Export dan dibersihkan saat logout. Ekspor tersedia dari tombol **Ekspor terpilih** di Mapping atau bagian mass update Shopee pada tab Ekspor. Server memvalidasi ulang setiap ID yang dipilih dengan hak `export.run` dan menolak status/master yang tidak lagi sesuai.

File acuan asli dipakai dari unggahan pada sesi browser yang sama. Sesudah refresh atau saat mengerjakan file lain, pilih kembali `.xlsx` asli melalui **Import & Export → Ekspor → Pilih template acuan**; pemilihan acuan tidak mengimpor data. Seluruh pilihan harus ada pada file/toko acuan dan cocok dengan snapshot listing. Tidak ada template atau data produk pengguna yang dipublikasikan ke repository.

Ekspor hanya menyertakan baris yang dipilih, dengan metadata/header, kolom, format, dan lembar bantu asli. Baris output dirapatkan; string produk yang tidak dipilih dibuang dari sharedStrings. SKU dan GTIN memakai master terbaru; SKU induk hanya diubah bila seluruh variasi produk pada acuan ikut disetujui dan menunjuk parent yang sama. Harga, stok, ID, nama, dan nilai kolom lain dipertahankan; rumus pada baris data yang dipilih dibekukan ke hasil tersimpan agar referensi lama tidak berpindah ke produk berbeda.

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

Unggahan baru menyimpan XLSX asli dan manifest baris secara privat di folder Drive milik aplikasi (maksimal 10 MB / 15.000 variasi). Metadata dan progres ada di `SHOPEE_BATCHES`; impor per 150 baris memperbarui progres pada transaksi yang sama dengan listing. Setelah refresh, buka batch melalui Import & Export → Import → Unggahan tersimpan atau pemilih unggahan di Shopee. Impor yang terputus dilanjutkan dari progres server. Unggahan lama sebelum fitur ini memerlukan satu kali unggah ulang agar template aslinya diarsipkan. File pengguna tidak dimasukkan ke repository publik.

Navigasi desktop dan HP: Katalog → Produk / Paket Penjualan; Kanal Penjualan → Shopee; Data → Import & Export; Administrasi. Tambah produk berada di dalam Produk; rute registrasi lama tetap kompatibel. Tombol Setujui & berikutnya menyimpan dahulu, lalu membuka variasi berikutnya yang belum disetujui dalam filter aktif, termasuk antarhalaman. Jika penyimpanan gagal, popup tetap terbuka. Unggah tetap terpusat di Import & Export; ekspor terpilih memuat kembali template batch bila memori browser kosong.

Pembaruan 16 November 2026: hasil daftar produk serta brand/kategori di-cache pada server berdasarkan versi data. Browser memakai cache sesi per akun untuk daftar produk dan kualitas data, dengan penyegaran di belakang dan penggabungan permintaan bersamaan. Tabel rincian kualitas data dibuat hanya ketika kelompoknya dibuka. Tombol Periksa ulang menghitung ulang pemeriksaan. Kategori ganda ditentukan dari jalur lengkap atau identitas kanal, bukan nama daun saja; kategori bernama sama di cabang berbeda tetap berbeda. Parent pada brand sama dengan skor minimal 90% masuk temuan Parent ganda, diurutkan skor tertinggi; perbandingan nama dipersiapkan sekali dan menghindari edit distance yang pasti tidak memenuhi ambang. Relasi/data tidak digabung otomatis.

Daftar kerja Shopee dapat dibatasi dengan profil penjualan privat: pasangan ID produk/variasi yang memiliki penjualan pesanan siap dikirim positif. Ringkasan parent tidak dipakai untuk mengikutkan semua variasi; fallback ID produk hanya berlaku untuk listing tunggal tanpa nama variasi dan profil yang tidak memiliki rincian variasi. Filter berlaku pada daftar, kartu status, antrean pemeriksaan, dan ekspor terpilih. Listing, master, dan persetujuan tetap disimpan. Profil tersimpan di Script Properties dalam potongan kecil dan bootstrap lokal `DataShopeeSales2026.gs` diabaikan oleh Git; penerapan kode berikutnya tetap memakai profil yang sudah tersimpan. Nomor versi cache browser/server diganti agar daftar sebelum profiling tidak muncul sebagai snapshot awal.

Popup pemeriksaan: Kode Produk/Kode Variasi eksternal tetap dipakai sebagai identitas internal, tetapi tidak ditampilkan pada kartu. Desktop memisahkan konteks perbandingan di kiri dan formulir dengan scroll sendiri di kanan; header/footer berada di luar area scroll sehingga tombol tidak menutupi isian. Pada layar kecil, ringkasan Shopee tetap terlihat dan perbandingan lengkap dapat dibuka. Brand merupakan filter pencarian opsional, tidak mengubah komposisi yang sudah dipilih (termasuk BD lintas brand). Indeks `sku.picker` hanya membaca SKU barang aktif, parent, dan brand; tidak membangun sellables/BOM/konversi. Indeks disiapkan saat masuk Shopee, di-cache per versi master pada server serta sementara per akun di browser. Pencarian token nama, SKU, GTIN dan brand berjalan lokal. Perubahan katalog/logout membatalkan cache; persetujuan mapping tidak membuang indeks lokal. Server tetap memeriksa SKU/komposisi/signature saat persetujuan disimpan.

Brand otomatis dihitung ulang setiap popup dari brand SKU komponen yang dipilih, lalu nama listing bila belum ada SKU; judul ambigu/lintas brand tidak dipaksa ke satu brand. Pilihan manual terlindungi selama popup tersebut. Kartu master langsung menampilkan pratinjau dari indeks SKU, termasuk komposisi BD yang belum lengkap; nomor MP/BD dan GTIN paket tidak diambil dari komponen. Paket yang belum ditemukan ditandai belum ditentukan sampai dibuat. CSS subgrid menyamakan tinggi setiap baris pembanding. Untuk target yang sudah ditemukan, submit langsung mengirim signature target dan komposisi tanpa resolusi paket berulang; server membangun target dan komponen yang dibutuhkan saja serta tetap memeriksa versi listing, status, signature, komposisi dan barcode. Membuat paket baru tetap memakai resolusi komposisi serta transaksi atomik.

Alur terbaru menggantikan menu Import & Export: tombol Impor template, Ekspor terpilih dan Muat ulang berada langsung di Shopee. Rute lama `io` mengarah ke Shopee. Daftar memakai satu snapshot `shopee.workspace` per versi/batch; pencarian, kartu status, pagination dan antrean berikutnya berjalan lokal. Hasil review memperbarui snapshot tanpa fetch ulang. Muat ulang menyegarkan snapshot; ekspor selalu memeriksa persetujuan/signature terbaru pada server. Satu klik Ekspor terpilih menyiapkan sekaligus mengunduh XLSX berisi baris pilihan dalam template asli, tanpa konfirmasi unduh kedua atau pindah halaman. Server memilih arsip template yang cocok dengan seluruh baris pilihan; template awal 1.xlsx diarsipkan sekali tanpa mengimpor ulang atau mengganti persetujuan melalui bootstrap privat `DataShopeeOriginalTemplate.gs` (tidak masuk Git). Bila tidak ada arsip yang cocok, pengguna dapat memilih file asli di dialog pada halaman yang sama. Header, 15 kolom, format, harga/stok dan identitas sumber dipertahankan; hanya perubahan SKU/GTIN dan SKU induk yang aman diterapkan, dengan baris tak dipilih dikeluarkan.

17 November 2026: Pilih semua disetujui mencakup semua halaman dalam snapshot/unggahan aktif dan tidak dibatasi pencarian/status yang sedang terlihat. Penjualan produk 2026 (Rp) diambil langsung dari Sheet3 Profiling SKU, dicocokkan dengan ID produk dan diurutkan menurun. Nilai Sheet3 adalah per produk dan ditampilkan sama pada variasi produk tersebut; tidak dijumlahkan ulang menjadi total SKU. Nilai nol dibedakan dari data yang tidak tersedia. Update hasil review tetap mempertahankan nilai penjualan.

Build GitHub Pages menghasilkan fingerprint HTML dan version.json otomatis. Watcher memeriksa versi setiap menit/saat aplikasi kembali aktif, lalu mengganti halaman dengan URL versi baru saat aman. Form/modal yang terbuka, wizard, aktivitas pengetikan, dan ekspor menunda pembaruan; halaman/filter/pilihan SKU dipulihkan melalui sessionStorage per akun. Data Shopee disegarkan di belakang saat versi database berubah, tanpa mengosongkan tabel. Web App Apps Script memakai fingerprint file HTML melalui app.versions. Pemasangan watcher pada jendela versi lama memerlukan satu refresh awal, tanpa menutup aplikasi; pembaruan berikutnya otomatis.

Perbaikan Simpan untuk diverifikasi: aksi ini menyimpan jenis penjualan, SKU komponen, qty, dan target yang sudah cocok, tanpa mewajibkan catatan. Komposisi parsial dapat disimpan sebagai draft; paket baru tidak dibuat dan mapping aktif lama dinonaktifkan. ReviewStatus needs_review yang diminta pengguna (ReviewedAt terisi) ditampilkan sebagai Perlu diverifikasi walaupun belum memiliki MP/BD; seed/import yang belum pernah ditinjau tetap Tidak tersedia jika tidak ada pasangan. Pemetaan draft tidak dapat diekspor. Tombol Setujui tetap memvalidasi komposisi lengkap dan mengubah status menjadi Disetujui. Progress simpan terlihat, klik ganda ditahan, kegagalan mempertahankan formulir dan menampilkan error; hasil hanya dianggap tersimpan setelah respons sukses. Resolusi MP/BD membandingkan BOM berdasarkan VariantID/qty lalu menghitung signature komponen/target yang cocok saja, bukan seluruh katalog. Cache workspace dinaikkan versinya agar status tampilan lama tidak dipakai kembali.

Popup dapat ditutup memakai Esc. Detail dibuka dari snapshot tabel tanpa permintaan tambahan. Sesudah persetujuan tersimpan, baris/status diperbarui dari respons server tanpa memuat ulang daftar. Backend memakai target yang sudah divalidasi untuk memperbarui mapping pada transaksi yang sama tanpa membangun ulang seluruh katalog sellables. Konflik versi, signature master, validasi komposisi, lock, dan rollback tetap berlaku.
