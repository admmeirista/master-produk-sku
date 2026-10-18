# Meirista SKU Master — Master Data Produk & SKU (Google Apps Script)

Web App Google Apps Script dengan Google Sheets sebagai database: registrasi produk 6 langkah, varian, paket
1/6/12/24, bundle, barcode GTIN & internal, deteksi duplikasi, persetujuan maker-checker, import/export Excel,
mapping BeeCloud/Shopee, kualitas data, dan audit trail.

* Pasang di HP: buka https://admmeirista.github.io/master-produk-sku/ di Chrome/Safari → menu → **Tambahkan ke layar utama** (ikon & manifest di `apps-script/pages/`).
* Panduan pasang & deploy: [apps-script/README.md](apps-script/README.md)
* Analisis template Excel lama & strategi migrasi: [apps-script/ANALISIS-TEMPLATE-EXCEL.md](apps-script/ANALISIS-TEMPLATE-EXCEL.md)
* Kode yang disalin ke Apps Script: folder [apps-script/src](apps-script/src)

## Untuk developer (opsional)

```bash
npm install
```
```bash
npm test
```
```bash
npm run dev
```
`npm test` menjalankan 15 skenario di emulator Apps Script; `npm run dev` membuka pratinjau di http://localhost:8790.
