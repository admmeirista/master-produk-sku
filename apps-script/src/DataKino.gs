/**
 * Data import Kino Personal Care (dari "Kino Personal Care utk SR Putra.xlsx": kode barang = GTIN, isi per karton).
 * Singkatan di file dibaca: ESK = Eskulin, C / COL = Cologne, MW = Micellar Water, WHT LUMI YAMBEAN = Bengkoang,
 * P KEWANITAAN = Pembersih Kewanitaan, BTL = botol. Isi per karton masuk ke kemasan BOX (sama seperti import lain).
 * GTIN yang sudah terdaftar → SKU itu dilengkapi (BOX) dan tidak dibuat ulang; SKU Parent yang sudah ada dipakai.
 * Ovale H2O Glow: kode di file hanya 12 digit (899341707231, kemungkinan terpotong) → tidak dipakai sebagai GTIN.
 * Dijalankan SEKALI otomatis oleh runDataJobs_() lewat jalur import produk yang sama dengan tombol Import.
 */
const KINO_ROWS_ = [
  ['No', 'Brand', 'Nama Produk Induk', 'Kategori', 'Jenis Variasi 1', 'Pilihan Variasi 1', 'Jenis Variasi 2', 'Pilihan Variasi 2', 'GTIN / Barcode', 'Satuan Terkecil', 'Isi per BOX (pcs)'],
  // Eskulin — Eau de Parfum (SKU Parent baru)
  ['1', 'Eskulin', 'Eau De Parfum', 'Parfum & Wewangian', 'Aroma', 'Twilight Amour', 'Volume', '30 ml', '8993417111143', 'PCS', '36'],
  ['2', 'Eskulin', 'Eau De Parfum', 'Parfum & Wewangian', 'Aroma', 'Twilight Enchanted Petal', 'Volume', '30 ml', '8993417111150', 'PCS', '36'],
  // Eskulin — Cologne Gel (sudah ada, GTIN cocok → dilengkapi)
  ['3', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Romantic Purple', 'Volume', '100 ml', '8993417112270', 'PCS', '36'],
  ['4', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Enchanting White', 'Volume', '100 ml', '8993417112232', 'PCS', '36'],
  ['5', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Enchanting White', 'Volume', '50 ml', '8993417112133', 'PCS', '36'],
  ['6', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Amusing Vanilla', 'Volume', '100 ml', '8993417212246', 'PCS', '36'],
  ['7', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Amusing Vanilla', 'Volume', '50 ml', '8993417212147', 'PCS', '36'],
  ['8', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Adorable Pink', 'Volume', '100 ml', '8993417212222', 'PCS', '36'],
  ['9', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Adorable Pink', 'Volume', '50 ml', '8993417212123', 'PCS', '36'],
  ['10', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Glamorous Red', 'Volume', '100 ml', '8993417212260', 'PCS', '36'],
  ['11', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Glamorous Red', 'Volume', '50 ml', '8993417212161', 'PCS', '36'],
  ['12', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Confident Peach', 'Volume', '100 ml', '8993417212253', 'PCS', '36'],
  ['13', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Confident Peach', 'Volume', '50 ml', '8993417212154', 'PCS', '36'],
  ['14', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Gleeful Yellow', 'Volume', '100 ml', '8993417212277', 'PCS', '36'],
  ['15', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Gleeful Yellow', 'Volume', '50 ml', '8993417212178', 'PCS', '36'],
  ['16', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Dreamy Blue', 'Volume', '100 ml', '8993417212215', 'PCS', '36'],
  ['17', 'Eskulin', 'Cologne Gel', 'Parfum & Wewangian', 'Aroma', 'Dreamy Blue', 'Volume', '50 ml', '8993417212116', 'PCS', '36'],
  // Ovale — Facial Lotion Bengkoang (sudah ada: "2 In 1 Facial Lotion Bengkoang", GTIN cocok)
  ['18', 'Ovale', '2 In 1 Facial Lotion Bengkoang', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '200 ml', '', '', '8993417001376', 'PCS', '36'],
  ['19', 'Ovale', '2 In 1 Facial Lotion Bengkoang', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '100 ml', '', '', '8993417001277', 'PCS', '36'],
  ['20', 'Ovale', '2 In 1 Facial Lotion Bengkoang', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '60 ml', '', '', '8993417001178', 'PCS', '36'],
  // Ovale — Facial Lotion lain (SKU Parent baru, kategori sama dengan Bengkoang)
  ['21', 'Ovale', 'Facial Lotion Anti Acne', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '200 ml', '', '', '8993417001369', 'PCS', '36'],
  ['22', 'Ovale', 'Facial Lotion Anti Acne', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '100 ml', '', '', '8993417001260', 'PCS', '36'],
  ['23', 'Ovale', 'Facial Lotion Anti Acne', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '60 ml', '', '', '8993417001161', 'PCS', '36'],
  ['24', 'Ovale', 'Facial Lotion Lemon', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '200 ml', '', '', '8993417020032', 'PCS', '36'],
  ['25', 'Ovale', 'Facial Lotion Lemon', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '100 ml', '', '', '8993417010033', 'PCS', '36'],
  ['26', 'Ovale', 'Facial Lotion Lemon', 'Perawatan Wajah > Pembersih Wajah', 'Volume', '60 ml', '', '', '8993417006036', 'PCS', '36'],
  // Ovale — H2O Micellar Water (SKU Parent baru)
  ['27', 'Ovale', 'H2O Micellar Water', 'Kosmetik > Pembersih Make Up', 'Tipe', 'Glow With Hydra', 'Volume', '300 ml', '', 'PCS', '24'],
  ['28', 'Ovale', 'H2O Micellar Water', 'Kosmetik > Pembersih Make Up', 'Tipe', 'Acne With Hydra', 'Volume', '300 ml', '8993417072321', 'PCS', '24'],
  // Resik-V — Khasiat Manjakani (sudah ada; 50 ml cocok GTIN → dilengkapi, 90 ml ditambahkan)
  ['29', 'Resik-V', 'Khasiat Manjakani', 'Perawatan Kewanitaan', 'Volume', '90 ml', '', '', '8993417165115', 'PCS', '36'],
  ['30', 'Resik-V', 'Khasiat Manjakani', 'Perawatan Kewanitaan', 'Volume', '50 ml', '', '', '8993417165016', 'PCS', '72'],
  // Resik-V — SKU Parent baru
  ['31', 'Resik-V', 'Manjakani White', 'Perawatan Kewanitaan', 'Volume', '90 ml', '', '', '8993417165238', 'PCS', '36'],
  ['32', 'Resik-V', 'Manjakani White', 'Perawatan Kewanitaan', 'Volume', '50 ml', '', '', '8993417165139', 'PCS', '72'],
  ['33', 'Resik-V', 'Ramuan Madura', 'Perawatan Kewanitaan', 'Volume', '90 ml', '', '', '8993417165221', 'PCS', '36'],
  ['34', 'Resik-V', 'Ramuan Madura', 'Perawatan Kewanitaan', 'Volume', '50 ml', '', '', '8993417165122', 'PCS', '72'],
  ['35', 'Resik-V', 'Godokan Sirih Soap Free', 'Perawatan Kewanitaan', 'Volume', '100 ml', '', '', '8993417168215', 'PCS', '36'],
  ['36', 'Resik-V', 'Pembersih Kewanitaan Anggrek', 'Perawatan Kewanitaan', 'Volume', '90 ml', '', '', '8993417162138', 'PCS', '36'],
];
