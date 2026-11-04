# REVISI V9 — Design system SMS selaras FMS Meirista

Referensi: repo FMS lokal `meirista_fulfillment_system/src/Css.html` (dibaca saja, tidak diubah), blok terbaru
**v109 “Modern Warm Luxury Minimalist”** + v67. SMS berasal dari basis kode yang sama (nama kelas komponen sama), sehingga
penyelarasan dilakukan di level token & komponen tanpa mengubah logika.

## 1. Pemetaan komponen FMS → SMS

| Komponen | FMS (v109) | SMS sebelum | SMS sesudah |
|---|---|---|---|
| Font | Plus Jakarta Sans | Nunito | **Plus Jakarta Sans** |
| Radius | kartu 12 · tombol/input 8 | 10–18 campur | 12 / 8 |
| Tombol | 38 px, 13,5/600, sm 32 px, fokus outline 2 px | 38 px, radius 10 | sama dengan FMS; HP min 44 px |
| Input/select | 38 px, ring fokus 3 px | 40 px, ring 4 px | 38 px (HP 44 px, 16 px agar tidak zoom), chevron SVG seragam |
| Judul halaman | 26/700 | 26/700 | 26/700 (HP 21) |
| Judul panel | 16/600 | 15/800 | 16/600 |
| KPI | 32/700 tabular, ikon 28 px r8 | 34/900 | 32/700 tabular |
| Tabel | header 12/600 tanpa kapital, sel 12 px, hover hangat | header kapital 10,5 | sama dengan FMS |
| Badge | pil + titik, 11,5/600 | 11/700 | sama dengan FMS |
| Modal | radius 16, latar gelap tanpa blur | radius 18, blur | sama dengan FMS |
| Toast | netral gelap / hijau / merah / kuning tua | — | sama dengan FMS (warna mocha) |
| Sidebar | 232 px, seksi 11/600 kapital, aktif ink-3 r10, ikon aktif aksen | 252 px | 232 px, sama; ciut 72 px |
| Filter HP | tombol “Filter” + panel | semua filter terbuka | tombol **Filter (jumlah aktif)** + Reset/Terapkan |
| Ikon | SVG garis inline (stroke 2) | sama | tetap (satu pustaka) |

## 2. Token final (Champagne Mocha)

```
--ink #62564D  --ink-2 #6C5F55 (hover)  --ink-3 #76685E (aktif)  --sage #F1E8DE  --sage-2 #E3D5C6
--bg #F8F5EF  --card #FFFDF9  --bg-2 #F2ECE3  --line #E9E1D6  --fg #302923  --fg-2 #4F453D  --muted #716860
--acc #996A51  --acc-2 #80553F  --acc-soft #F4E9E1  --champ #C9A98B  --copper #A65F49
--ok #36795D  --warn #8A5D1C (teks) / #A87429 (titik)  --err #B9433D  --info #557A91
grafik: --ch-1 #996A51 · --ch-2 #C9A98B · --ch-3 #A65F49 · --ch-4 #76685E · --ch-5 #D9C4AE · track #F2ECE3
--r 12  --r-sm 8  spasi 4/8/12/16/24/32  bayangan 0 1 2 / 0 2 8 (sangat tipis)
```

Grafik: batang “SKU Produk per brand” memakai urutan warna seri palet; meter kelengkapan: hijau (≥ 90 %),
kuning tua (≥ 50 %), copper (< 50 %).

## 3. Branding
Pojok kiri atas (sidebar & bilah atas HP): **Meirista · SKU MANAGEMENT SYSTEM** dengan logo SMS. Judul halaman /
manifest: “Meirista SKU Management System”, nama pendek di layar HP: “SMS Meirista”.

## 4. File diubah
`src/Styles.html` (blok v7 di akhir: token + komponen, font), `src/Scripts.html` (nama, brand, `enhanceFilters`),
`src/Config.gs`, `src/Mobile.html`, `pages/manifest.webmanifest`, `tools/build-pages.cjs`.

## 5. Pengujian
- `npm test` 74 lulus (logika tidak berubah).
- Emulator: desktop 1280 (dashboard, Master Produk: font Plus Jakarta Sans, tombol 38 px/radius 8), tablet 768 dan
  HP 375 — 15 halaman dibuka tanpa error & tanpa geser horizontal; filter HP: buka, hitung filter aktif, Terapkan, Reset.
- Belum: uji di perangkat fisik & scan kamera nyata.

## 6. Belum / catatan
- Tidak dibuat paket komponen bersama FMS–SMS (dua deployment Apps Script terpisah; menambah kompleksitas deploy).
  Token & kelas sudah bernama sama sehingga bisa disalin bila perlu.
- Bottom sheet belum dipakai untuk filter (panel lipat di tempat, seperti FMS).
