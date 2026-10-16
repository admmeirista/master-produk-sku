# 01 — Analisis Template Excel `Template_Master_Produk_SKU_BeeCloud Fix.xlsx`

Analisis dilakukan terhadap **seluruh 6 sheet** dengan skrip (bukan pengamatan manual), lalu diuji ulang dengan
memigrasikan workbook asli ke database aplikasi (menu Import & Export di aplikasi). Angka di bawah adalah hasil nyata.

## 1. Ringkasan isi workbook

| Sheet | Isi | Volume |
|---|---|---|
| Petunjuk | Aturan pakai template, format SKU, catatan barcode internal & risiko stok minus | 41 baris |
| Referensi Kode | Daftar brand (nama + kode 3 huruf) dan kategori (nama + kode 3 huruf), dipakai VLOOKUP | 121 brand, 76 kategori |
| Master Produk | 1 baris = 1 SKU (satuan atau paket). Kolom kode brand/kategori & SKU berupa rumus | 672 baris terisi |
| Generator Barcode Internal | EAN-13 prefix `200` + check digit (rumus), status Tersedia/Terpakai manual | 500 kode, 3 terpakai |
| Data Performa Produk 8 AGS - 6… | Ekspor performa Shopee (ID produk, ID variasi, SKU, penjualan) | 1.414 listing, 983 produk |
| Sheet3 | Draf struktur produk–variasi berbasis listing Shopee (Kode Produk = ID Shopee) | 140 baris, 53 listing |

## 2. Kelemahan desain & kesalahan data yang ditemukan

### A. Struktur SKU & identitas

1. **Dokumentasi format SKU tidak konsisten.** Petunjuk & judul sheet menulis `KODE BRAND - KODE KATEGORI - GTIN`
   (3 bagian), tetapi rumus sebenarnya `BRAND-KATEGORI-KODEPRODUK-GTIN-ISI` (5 bagian), mis. `PRB-BSR-GH180-8999225912415-1`.
2. **SKU bergantung pada barcode.** Bila barcode internal kelak diganti GTIN resmi (atau GTIN dikoreksi), SKU ikut
   berubah sehingga hubungan ke BeeCloud/Shopee putus. Panjang SKU 30–31 karakter (maks. 31).
3. **Satu barang fisik punya beberapa “identitas”.** GTIN `8992796011501` (Viva Air Mawar 100ml) terdaftar dua kali:
   kode `VAM100` (isi 1/3/6/10) dan `AIM100` (isi 1/3/6/12/24) → **9 SKU untuk 1 barang**. Sheet3 memakai kode ketiga
   (`AM100`). Ini melanggar aturan template sendiri (“1 barang fisik = 1 baris master”) dan tidak terdeteksi karena
   pewarnaan duplikat hanya visual.
4. **Kode produk tidak konsisten antar-sheet untuk GTIN yang sama**, contoh: Gatsby `GSG30` vs `PSG`; Pixy `FOC100` vs
   `FAA`; Viva `VN30/VK30/VP30` vs `LF30`; Lavojoy GTIN `8991748018100` muncul sebagai `LCB180`, `LG20`, `LG50`, `SB`.
   Kode juga tidak cocok dengan isi nama: `THC30` untuk produk 25gr, `FPG33` untuk “30gr”.
5. **Varian tidak dimodelkan.** Tiap shade/aroma menjadi “produk” terpisah (4 shade Lavojoy SPF50, 3 shade Viva Liquid
   Foundation, 3 varian Viva Milk Cleanser…). Akibatnya tidak ada “keluarga produk”; fuzzy matching di aplikasi
   menandai 9 pasangan ini sebagai “nama mirip” setelah migrasi (bisa ditandai *bukan duplikat* oleh reviewer).

### B. Kelengkapan & kebenaran data

6. **113 baris (563–675) tidak lengkap**: GTIN & nama ada, tetapi Nama Brand, Nama Kategori, Kode Produk kosong →
   SKU tidak terbentuk (mis. Spalding, Gatsby Deodorant, Marina, My Baby). Baris ini **ditolak** saat migrasi dan
   tercantum di laporan error.
7. **Harga hampir kosong**: hanya 30 baris punya Harga Beli, 2 baris Harga Jual, 0 baris Stok Awal.
8. **Bug rumus Harga Beli**: baris 5–34 memakai `=H5*$L$4` — referensi absolut ke harga **GH180** (baris 4) untuk
   semua produk (WG180, SF180, CB180, …). Kebetulan sama-sama 29.000, tetapi akan salah diam-diam bila harga berbeda.
9. **Contoh baris kontradiktif**: baris 5 (GH180 isi 3) harga jual 25.000 < harga beli 87.000, dan keterangannya
   “kode diambil dari Generator Barcode Internal” padahal memakai GTIN resmi.
10. **Satuan kosong** pada 464 baris (baris 200–562); set isi paket tidak seragam (1/3/6/10, 1/3/6/12/24, 1/2/3/6/12, 5).
11. **Kolom No** hanya terisi 53 baris (rumus `ROW()` tidak diteruskan).
12. **GTIN disimpan sebagai angka** di 642 baris → rawan notasi ilmiah / hilang nol di depan saat diekspor ke CSV.
13. **Validasi dropdown brand tidak seragam**: 31 sel memakai rentang `'Referensi Kode'!$A$3:$A$19` (hanya 17 brand
    pertama), sisanya `$A$3:$A$1000` — pada sel tersebut Viva/Purbasari dkk. tidak bisa dipilih.

### C. Data referensi

14. **Bukan brand di daftar brand**: `Kuas`, `Paket`, `Parfum`, `Pasta Gigi`, `Sikat Gigi`, `Skin Care`, `Others`,
    `Free Gift`. Nama brand terpotong/berisi nama produk: `N`, `Pi`, `QL`, `Sca`, `Lovillea Anti`, `Listerine Cool`,
    `Acnes Creamy`, `Spalding Deo`, `Freshcare Minyak`, `Qlsabun Lulur`. Salah ketik: `Yarong Beuatician`.
15. **Kategori tumpang-tindih**: Facial Cleanser / Facial Foam / Milk Cleanser; Fragrance / Cologne / Parfum;
    Body Care Package / Skincare Package. Enam kategori terakhir ditambahkan di luar urutan (penambahan ad-hoc).
    Contoh salah klasifikasi: “Ovale 2in1 Facial **Lotion**” di kategori Facial Cleanser padahal ada kategori Facial Lotion.
16. Kode brand sama dengan kode kategori (`BDL`, `FRG`, `OTH`) — tidak bentrok secara teknis (namespace terpisah)
    tetapi membingungkan saat membaca SKU.

### D. Barcode internal

17. **Alokasi manual tidak aman untuk multi-user**: dua staf bisa mengambil baris “Tersedia” yang sama sebelum
    menandai “Terpakai”.
18. **Duplikat nyata sudah terjadi**: `2000000000015` “Tancho Pomade Nourishing 20gr” dan `2000000000039`
    “Tancho Nourishing Pomade 20gr” — barang yang sama dengan ejaan berbeda mendapat dua kode. Sheet3 mencatat
    barang yang sama (`PN20`) sebagai “GTIN Not Available”.
19. Prefix `200` sudah benar (rentang *restricted circulation* GS1) dan seluruh 500 check digit valid. Catatan
    operasional: sebagian POS/timbangan menafsirkan prefix `2x` sebagai barcode berat/harga — **perlu dicek di scanner &
    POS BeeCloud** yang dipakai.

### E. Sheet3 & data Shopee

20. **“GTIN” rekaan** untuk bundling/varian (16 kode, mis. `9917348265012`): berawalan `99` (rentang **kupon** GS1) dan
    check digit-nya salah. Tidak boleh dipakai sebagai barcode produk.
21. Format SKU berbeda dari Master Produk (tanpa isi; ada “SKU Induk”), 7 grup SKU ID ganda, 1 baris brand `#N/A`.
22. Harga Beli Sheet3 dalam satuan ribuan (`27.36`) vs rupiah penuh di Master (`29000`).
23. Data Performa Shopee: hanya **125 dari 1.414 listing (≈9%)** memakai SKU yang ada di master; **1.163** memakai kode
    lain (mis. `SKU/02593`, teks bebas “BUNDLING GLUTA HYA + CYBRIGHT”), **114** tanpa SKU. Satu SKU dipakai beberapa
    listing (12 kasus) — ini memang diizinkan oleh Petunjuk.

## 3. Hasil uji migrasi workbook asli

| Langkah | Hasil |
|---|---|
| Referensi Kode | 121 brand + 76 kategori (dilewati bila sudah ada — idempoten) |
| Generator Barcode Internal | 3 kode terpakai didaftarkan; peringatan “dua kode untuk satu barang” (Tancho) |
| Master Produk | 672 baris → **554 SKU** termigrasi (114 product master, 114 SKU satuan, 440 multipack); **118 baris ditolak**: 113 tidak lengkap, 5 duplikat barcode `AIM100` |
| Data Performa Shopee | **125 listing** dipetakan (status *confirmed*); 1.163 SKU tidak dikenal + 114 tanpa SKU dilaporkan |
| Waktu proses (emulator) | < 1 detik untuk validasi + simpan |

## 4. Rekomendasi desain (diterapkan di aplikasi)

| Masalah | Solusi di aplikasi |
|---|---|
| SKU sebagai identitas utama | ID internal UUID + nomor `PRD-xxxxxx` yang tidak pernah berubah; SKU hanyalah atribut unik |
| SKU berubah bila barcode berubah | SKU **dibekukan** setelah aktif; perubahan hanya via *change request* dengan histori `sku_code_history`; mapping eksternal otomatis ditandai *mismatch* |
| Varian tidak dimodelkan | Hierarki Brand → Kategori → Product Master → Varian (atribut + signature unik) → Sellable SKU |
| Multipack menyalin data induk | Multipack = baris SKU yang menunjuk varian yang sama + `pack_qty` (unik per varian) |
| Bundle tanpa struktur | Produk bertipe *bundle* dengan BOM (`packaging_components`) & kalkulasi biaya komponen |
| Duplikasi barcode / SKU | Unique index di database + validasi aplikasi; barcode punya registry & histori penugasan |
| Ejaan berbeda | Normalisasi nama + fuzzy matching (peringatan, tidak pernah auto-merge) + daftar “bukan duplikat” |
| Alokasi barcode manual | Sequence + row lock + unique index + `requestKey` idempoten |
| GTIN rekaan/kupon | Validasi check digit, tolak prefix 98x/99 dan prefix 2xx sebagai “GTIN produsen” |
| Barcode sebagai angka | Disimpan `varchar`; ekspor Excel memakai format teks |
| Harga tanpa histori | `product_prices` berlaku-dari/berlaku-sampai + alasan perubahan |
| Tidak ada kontrol | Workflow Draft → Review → Disetujui → Aktif, maker-checker, audit before/after |

### Evaluasi format SKU

* **Default tetap format lama** `{BRAND}-{CATEGORY}-{PRODUCT}{VARIANT}-{BARCODE}-{QTY}` (sesuai permintaan & kompatibel).
* **Rekomendasi untuk produk baru**: format stabil `{BRAND}-{CATEGORY}-{PRODUCT}{VARIANT}-{QTY}` (mis. `VIV-TON-FTB100-6`,
  ±15 karakter). Keunikan tetap terjamin oleh: kode produk unik per brand + kode varian unik per produk + isi unik per varian.
  Barcode tetap tersimpan di registry terpisah. Dapat diaktifkan di menu **Pengaturan** tanpa mengubah SKU lama.
* Yang **belum terverifikasi** dan wajib dicek sebelum memilih: batas panjang & karakter SKU di BeeCloud dan Seller SKU Shopee.

## 5. Strategi migrasi (bertahap, tanpa mengganti SKU lama otomatis)

1. **Bekukan template** — registrasi baru dilakukan di aplikasi; Excel hanya arsip.
2. **Referensi** — import Referensi Kode; admin merapikan nama brand (kode **tidak diubah** karena sudah ada di SKU).
   Brand “bukan brand” (Kuas, Pasta Gigi, …) dipertahankan sementara agar SKU lama valid; produk baru memakai brand asli.
3. **Barcode internal terpakai** — import sheet Generator agar kode 1–3 tidak dialokasikan ulang; putuskan kode Tancho mana
   yang benar-benar tercetak di label, lalu pensiunkan yang lain lewat change request.
4. **Master Produk** — import; perbaiki baris di *laporan error* (lengkapi 113 baris; untuk Viva Air Mawar tentukan keluarga
   SKU mana yang aktif di BeeCloud — `VAM100` sudah dipakai listing Shopee) lalu import ulang. Baris yang sudah masuk
   otomatis dilewati (idempoten).
5. **Shopee** — import ekspor Seller Center → mapping *confirmed*; tindak lanjuti daftar listing yang SKU-nya tidak
   dikenal dengan menyamakan Seller SKU secara manual di Seller Center, lalu import ulang.
6. **BeeCloud** — ekspor file BeeCloud, cocokkan format dengan template import resmi BeeCloud, upload; kemudian import
   daftar barang dari BeeCloud (menu *Daftar SKU BeeCloud*) untuk konfirmasi.
7. **Harga** — lengkapi ±500 SKU tanpa harga (tercatat sebagai histori).
8. **(Lanjutan)** Pengelompokan ulang produk-per-shade menjadi satu product master dengan varian, tanpa mengubah SKU —
   direkomendasikan sebagai fitur tahap berikutnya.
