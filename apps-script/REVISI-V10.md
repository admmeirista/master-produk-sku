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
# Penyimpanan pemetaan Shopee di latar belakang

Tombol Setujui, Setujui & berikutnya, dan Simpan untuk diverifikasi langsung menutup popup. Antrean menyimpan satu permintaan pada satu waktu; status Disetujui hanya diterapkan dari hasil server, lalu baris dan ringkasan diperbarui tanpa mengambil ulang daftar. Setujui & berikutnya membuka produk berikutnya dari snapshot lokal, termasuk lintas halaman, melewati produk disetujui atau yang sudah berada di antrean. Hasil simpan tidak memindahkan popup untuk kedua kalinya.

Antrean menampilkan proses/gagal, menyediakan coba lagi dengan request key yang sama dan perbaikan pilihan. Permintaan belum dikonfirmasi disimpan per akun di sessionStorage untuk dipulihkan setelah refresh; ekspor baris yang sedang disimpan diblokir dan pembaruan aplikasi menunggu antrean selesai. Penyimpanan draft tidak berarti persetujuan.

Semua pembentukan kode paket (Paket Penjualan, Shopee, import paket, migrasi) memakai bundleAllocateSku_: MP + enam digit atau BD + enam digit, penghitung tersinkron dengan nomor yang sudah dipakai termasuk arsip/kode pendek lama. Batas enam digit divalidasi. Audit database 17 November 2026 menemukan 333 MP dan 1 BD, semuanya sudah enam digit; tidak ada penggantian kode master atau snapshot SKU Shopee. Pembuatan paket dan penggantian barcode Shopee memakai katalog komponen terpilih, bukan seluruh katalog.
# Penempatan SKU Shopee berdasarkan bentuk listing

Preview ekspor pada tabel dan popup memisahkan SKU Induk Shopee dari SKU Parent master. Struktur listing dihitung dari seluruh baris template privat, sebelum filter penjualan atau pemilihan baris ekspor: satu baris dengan nama variasi kosong berarti tanpa variasi (ID variasi tetap dipertahankan); beberapa model atau nama variasi terisi berarti bervariasi, termasuk listing dengan satu pilihan bernama. Informasi variasi tidak lengkap atau SKU Induk sumber bertentangan ditandai belum pasti dan diblokir saat ekspor.

Tanpa variasi: SKU barang/MP/BD target ditulis ke SKU Induk, SKU dikosongkan. Dengan variasi: SKU target ditulis ke SKU per variasi; SKU Induk memakai kode grup dari sumber, atau SHP + Kode Produk bila kosong. Kode SHP hanya grup listing, tidak dibuat sebagai SKU master. Grup tetap sama saat ekspor sebagian variasi. GTIN mengikuti barang/paket target. Perubahan hanya pada kolom SKU Induk, SKU, dan GTIN; ID/nama/harga/stok serta template tetap terjaga. Impor batch menggunakan bentuk listing dari manifest lengkap untuk membaca SKU efektif (SKU Induk untuk tanpa variasi), sehingga impor hasil pembaruan yang benar mempertahankan persetujuan.

Sumber aturan bersama ShopeePlacementCore.gs menghasilkan ShopeePlacement.html saat build; pengujian memastikan versi server/browser identik. Cache workspace dan parameter browser dinaikkan ke versi 3 untuk memuat metadata bentuk listing pada sesi lama.
# Login dan ruang tabel Kanal Penjualan

Halaman login memakai penjelasan fungsi sistem yang ringkas (data produk, paket penjualan, pemetaan kanal) dan ukuran form yang muat pada desktop 720 px. AuthLoading menampilkan logo/identitas SKU Master dan status autentikasi, akses akun, lalu penyiapan halaman awal. Form di belakang layar menjadi inert saat autentikasi; klik ganda dicegah. Layar ditutup ketika halaman siap atau login gagal; bila data awal menunggu lebih dari 12 detik, halaman dan indikator datanya ditampilkan. Tidak ada persentase buatan. Sesuai penyesuaian UX, layar tampil minimal 2 detik sejak mulai; proses yang lebih lambat tidak mendapat tambahan jeda. Kegagalan login tetap langsung menutup layar pemuatan. Pembaruan otomatis menunggu layar login selesai.

Kanal Penjualan memakai tindakan utama di header (Impor, Ekspor terpilih, Muat ulang), tindakan pilihan SKU di baris unggahan, cakupan data yang dapat dibuka, serta kartu status ringkas. Pada desktop, tabel mengisi sisa tinggi viewport dengan header tetap dan pagination di bawah; perangkat lebih kecil memakai tabel dengan gulir sendiri. Pemeriksaan browser lokal pada 1280 × 720 menemukan kartu sekitar 66 px dan area tabel sekitar 407 px; halaman tidak memerlukan gulir vertikal tambahan. Screenshot pratinjau memakai data contoh lokal, bukan data produksi.
# Tabel Shopee menyesuaikan lebar area kerja

Tabel menggunakan table-layout fixed dan colgroup dengan porsi untuk sembilan kolom, termasuk Status dan Aksi. Lebar minimum lama pada judul, master, kode dan preview dinonaktifkan; teks panjang dibungkus, bukan disembunyikan. Teks isi 11 px, kode/preview 10 px, dan header 9 px. Pada layar di bawah 1000 px, baris menjadi rincian per produk: variasi, SKU Shopee dan penjualan tetap tersedia di bagian produk; SKU master, preview, status dan tombol Periksa ditata dalam baris yang sama tanpa gulir horizontal.

Pemeriksaan browser dengan kode sumber yang panjang: lebar gulir sama dengan lebar area tabel pada viewport 1280 (983 px), 1024 (727 px), dan 390 (347 px). Status dan Periksa berada di dalam viewport. Periksa berhasil membuka popup dan Esc menutupnya. Layar startup kini juga memakai logo SKU Master asli dari aset inline yang sama dengan logo login, menggantikan monogram teks SKU; layar autentikasi tetap memakai logo dan minimum 2 detik.

### 22 November 2026 — SKU Induk dari master
- Variasi memakai parent master target; tanpa variasi tetap SKU target di SKU Induk, SKU kosong. Kode SHP tidak lagi dibentuk, parent lama pada template tidak dipakai untuk hasil ekspor.
- Preview, ekspor server, dan patch Excel memakai aturan yang sama. Parent kosong atau berbeda antarvariasi menahan ekspor.
- Audit seluruh record yang pernah disetujui saat workspace dimuat, mencakup di luar filter penjualan/batch; ringkasan dan alasan pemeriksaan tampil di atas tabel. Cache workspace dan listing dinaikkan versinya.
- Validasi: 164 tes lolos, 23 skrip frontend terkompilasi, 10 baris snapshot 18 November diuji patch lalu dibaca kembali: preview sama dengan Excel dan tanpa kode SHP. Pembacaan live 22 November terhalang 403 izin file Google; snapshot lama tidak diklaim sebagai audit live.

### 22 November 2026 — Motion logo saat login
- Loading login dan startup membentuk logo Meirista asli dari enam bagian dengan gerakan masuk halus, bingkai tergambar, lalu menyatu menjadi logo utuh. Berjalan sekali dan selesai dalam durasi minimum loading 2 detik yang sudah ada.
- Logo tetap lokal/inline, tanpa library animasi atau permintaan jaringan tambahan. Preferensi reduced motion menampilkan logo utuh tanpa animasi.
- Uji login tetap mencakup respons cepat/lambat, kegagalan, dan pembersihan timer; seluruh 164 tes lolos dan 24 skrip build terkompilasi.

### 22 November 2026 — Durasi layar logo
- Minimum loading login dinaikkan dari 2 menjadi 3,5 detik sejak tampil. Sesi tersimpan juga menampilkan overlay animasi sehingga masuk kembali tidak melewati logo terlalu cepat.
- Data/sesi tetap dimuat bersamaan; respons lebih lambat dari minimum tidak mendapat tambahan jeda. Kesalahan login tetap ditampilkan segera.
- 12 tes terkait auth, cache, dan parse frontend/backend lolos, termasuk regresi sesi tersimpan.

### 22 November 2026 — Sambutan logo dan gerbang login
- Pembentukan logo diperlambat menjadi 2,65 detik per bagian dengan stagger hingga 0,4 detik, easing masuk/keluar halus dan rotasi lebih kecil. Penyatuan final/bingkai selesai sekitar 3,4 detik.
- Pembukaan tanpa sesi sekarang menampilkan sambutan logo yang tidak berpindah otomatis. Tombol Masuk ke halaman login aktif setelah 3,5 detik dan membuka form hanya lewat klik pengguna.
- Timer sambutan dibersihkan ketika ditutup; klik ganda/tombol lama tidak mengganggu login berikutnya. Sesi tersimpan mengikuti alur pemuatan yang sudah ada.
- 12 pengujian auth, gerbang tombol, pembatalan timer, dan parse frontend/backend lolos.

### 23 November 2026 — Perbandingan sumber, master, dan ekspor
- Popup memakai satu tabel tiga kolom data: Shopee Saat Ini, Master Sistem, Hasil Ekspor Shopee. Lima baris sejajar mencakup nama, variasi, SKU Induk/Parent, SKU, GTIN; kolom hasil selalu mengikuti aturan ekspor yang sama dan mempertahankan nama/variasi Shopee.
- Form pemetaan di bawah tabel, filter jenis/brand berdampingan, komposisi master dapat dibuka bila perlu. Header nama produk dan tombol tindakan tetap terlihat saat konten digulir.
- Field Catatan Pemeriksaan dan kartu preview terpisah dihapus. Catatan lama tetap dipertahankan pada penyimpanan berikutnya.
- 168 tes suite lolos; satu regresi tambahan tabel Viva Air Mawar juga lolos bersama 16 tes pemetaan/UI. Pemeriksaan meliputi MP tanpa variasi di SKU Induk, SKU kosong, GTIN paket, dan perubahan pilihan master.

### 23 November 2026 — Label paket dan filter daftar tersimpan
- Paket Penjualan memakai label SKU Paket, Komposisi SKU Barang, dan Parent Produk (di bawah SKU Paket). API komponen menambahkan parentSku dari master produk tanpa mengubah identitas atau komposisi paket.
- Kolom Master Sistem menamai parent sebagai Parent Produk, MP/BD sebagai SKU Paket, dan satuan sebagai SKU Barang. Komposisi SKU Barang tampil langsung pada baris tersendiri; SKU Induk/SKU di kolom Shopee dan hasil ekspor tetap mengikuti template.
- Filter Produk, Paket Penjualan (termasuk tab konversi), dan Shopee disimpan per akun di sessionStorage dengan fallback memori. Pencarian, status, brand/kategori, urutan dan halaman dipulihkan saat kembali. Teks terbaru ikut ditangkap ketika keluar sebelum debounce; callback daftar lama diabaikan setelah meninggalkan halaman.
- 174 tes lolos, termasuk navigasi kembali pada ketiga menu, pencarian sebelum debounce, penyimpanan per akun, argumen eksplisit, dan pemulihan setelah refresh.

### 23 November 2026 — Analisis ulang SKU tidak tersedia
- Workspace menjalankan pencocokan read-only pada snapshot terbaru yang masuk cakupan penjualan/batch. Deteksi brand membatasi kandidat, lalu membandingkan nama produk, nama variasi (diutamakan atas judul gabungan), ukuran, jenis penjualan dan qty. Persetujuan, draf pengguna dan listing yang diabaikan tidak ditimpa.
- Usulan kuat (skor >=82, selisih >=8 dari kandidat berikutnya, serta pemeriksaan varian/ukuran/qty lolos) tampil sebagai Perlu diverifikasi. Nama mirip, ukuran berbeda, varian ambigu, BD/campuran/random tidak menjadi persetujuan otomatis. Tidak ada perubahan database sebelum pengguna menyimpan atau menyetujui.
- Bila SKU satuan dan qty jelas tetapi MP belum ada, siapkan komposisi di pemeriksaan untuk alur Buat paket baru. Tidak menggunakan MP dengan qty/komposisi berbeda atau membuat paket tanpa persetujuan.
- Kolom Kecocokan (%) dan alasan/kandidat tampil di daftar/pemeriksaan. Skor heuristik bukan probabilitas; 99 adalah batas atas. Nilai lama tidak ditampilkan untuk target yang sudah diganti manual. Kolom status dan Periksa tetap memiliki ruang pada layout desktop/mobile.
- Katalog ringan menghindari hashing seluruh master; signature lengkap hanya dihitung untuk usulan yang ditampilkan. Workspace cache dan schema browser dinaikkan ke versi 5; filter lokal tetap tidak memanggil ulang analisis.
- 184 tes lolos, termasuk brand/ukuran/qty/variasi, judul gabungan, shade, paket belum ada, kandidat ganda, tidak menimpa keputusan pengguna, serta usulan belum dapat diekspor sebelum disetujui. Uji benchmark memakai seed 12 November + master snapshot 18 November, bukan audit produksi terbaru.
- Pembacaan database langsung tanggal 23 November masih menerima 403 izin file. Hasil produksi dihitung di server saat workspace dibuka; jumlah hasil terkini belum dapat dibaca langsung oleh agen.

### 23 November 2026 — Persetujuan kandidat kuat secara eksplisit
- Tambahkan tindakan Setujui kecocokan kuat untuk menjalankan persetujuan massal atas instruksi pengguna; tidak berjalan otomatis saat daftar dibuka atau file baru diimpor.
- Rencana dibatasi cakupan penjualan/batch saat ini. Kriteria: skor >=97, kandidat unik, master aktif sudah ada, satuan/MP dengan komposisi jelas, barcode sumber tidak bertentangan, template cocok, preview ekspor siap, dan parent variasi konsisten. Paket belum dibuat, BD/campuran, draf/keputusan pengguna, dan kandidat ambigu dilewati.
- Simpan per 20 kandidat dalam transaksi. Setiap kandidat dihitung ulang dan dicek versi serta signature master di server. Request key mencegah penyimpanan berulang; setiap persetujuan dicatat dengan skor dan alasan di audit.
- UI menampilkan progres/jumlah persetujuan yang dikonfirmasi server dan memuat ulang daftar; sisanya tetap mengikuti tampilan biasa. Tidak ada kebijakan persetujuan otomatis untuk unggahan berikutnya.
- 187 tes lolos, mencakup kriteria, perubahan versi/master, barcode konflik, draf/abaikan, parent berbeda, izin peran dan pengulangan permintaan.

### 23 November 2026 — Status dan navigasi popup pemetaan
- Header popup menampilkan status pemetaan tersimpan di pojok kanan atas dengan warna status yang sama seperti daftar.
- Tombol Sebelumnya/Berikutnya dan posisi produk tampil di footer, mengikuti filter/urutan saat pemeriksaan dimulai dan dapat melintasi halaman tabel tanpa permintaan server baru.
- Navigasi tidak menyetujui atau menyimpan ke database. Pilihan SKU/qty/jenis/brand/barcode disimpan sementara dalam sesi pemeriksaan untuk dipulihkan ketika bolak-balik. Draf versi lama tidak menimpa data baru; item dalam antrean penyimpanan dilewati.
- Setujui & berikutnya tetap menyimpan melalui antrean yang ada. Tombol batas awal/akhir dinonaktifkan dan popup lama ditutup sebelum popup berikutnya dibuka.
- 189 tes suite lolos; 15 tes navigasi/review lulus kembali setelah guard popup lama ditambahkan. Mencakup status, draft, 35 baris lintas pagination, akhir/awal, dan tidak ada API tambahan saat navigasi.
