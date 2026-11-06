/**
 * Paket Produk Sama (MULTIPACK, SKU MP000001…) dari listing Shopee '[N Pcs] …' (mass update 6 Nov 2026).
 * Hanya listing yang isinya pasti: 1 Child SKU (cocok barcode / nama kuat) × N pcs. 332 paket unik dari 355 listing.
 * Paket kombinasi (BD) TIDAK dibuat di sini — isinya perlu ditentukan manual dulu.
 * Kolom: [Child SKU, jumlah pcs, 1 = listing Shopee menulis 'boleh mix/campur'].
 * Paket yang komposisinya sudah ada dilewati (aman dijalankan ulang). Virtual: stok dihitung dari komponen.
 */
const SHOPEE_MP_ROWS_ = [
  ['PRD000003-001',3,0], // Purbasari Gluta Hya Body Serum 180 ml · 1 listing
  ['PRD000003-001',6,0], // Purbasari Gluta Hya Body Serum 180 ml · 2 listing
  ['PRD000003-001',12,0], // Purbasari Gluta Hya Body Serum 180 ml · 1 listing
  ['PRD000003-001',24,0], // Purbasari Gluta Hya Body Serum 180 ml · 1 listing
  ['PRD000004-001',2,0], // Purbasari White Glow Body Serum 180 ml · 1 listing
  ['PRD000004-001',3,0], // Purbasari White Glow Body Serum 180 ml · 1 listing
  ['PRD000004-001',4,0], // Purbasari White Glow Body Serum 180 ml · 1 listing
  ['PRD000004-001',6,0], // Purbasari White Glow Body Serum 180 ml · 1 listing
  ['PRD000005-001',3,0], // Purbasari Skin Firming Body Serum 180 ml · 1 listing
  ['PRD000005-001',6,0], // Purbasari Skin Firming Body Serum 180 ml · 1 listing
  ['PRD000006-001',3,0], // Purbasari Ceramide Barrier Body Serum 180 ml · 1 listing
  ['PRD000006-001',6,0], // Purbasari Ceramide Barrier Body Serum 180 ml · 1 listing
  ['PRD000007-001',3,0], // Purbasari Cybright Whitening Body Serum 180 ml · 1 listing
  ['PRD000007-001',6,0], // Purbasari Cybright Whitening Body Serum 180 ml · 1 listing
  ['PRD000008-001',3,0], // Purbasari Phyto Cell-C Body Serum 180 ml · 1 listing
  ['PRD000008-001',6,0], // Purbasari Phyto Cell-C Body Serum 180 ml · 1 listing
  ['PRD000009-001',3,0], // Viva Liquid Foundation Natural 30 ml · 1 listing
  ['PRD000009-001',6,0], // Viva Liquid Foundation Natural 30 ml · 1 listing
  ['PRD000009-001',12,0], // Viva Liquid Foundation Natural 30 ml · 1 listing
  ['PRD000009-001',24,0], // Viva Liquid Foundation Natural 30 ml · 1 listing
  ['PRD000009-002',3,0], // Viva Liquid Foundation Kuning Langsat 30 ml · 1 listing
  ['PRD000009-002',6,0], // Viva Liquid Foundation Kuning Langsat 30 ml · 1 listing
  ['PRD000009-002',12,0], // Viva Liquid Foundation Kuning Langsat 30 ml · 1 listing
  ['PRD000009-002',24,0], // Viva Liquid Foundation Kuning Langsat 30 ml · 1 listing
  ['PRD000009-003',3,0], // Viva Liquid Foundation Kuning Pengantin 30 ml · 1 listing
  ['PRD000009-003',6,0], // Viva Liquid Foundation Kuning Pengantin 30 ml · 2 listing
  ['PRD000009-003',12,0], // Viva Liquid Foundation Kuning Pengantin 30 ml · 2 listing
  ['PRD000009-003',24,0], // Viva Liquid Foundation Kuning Pengantin 30 ml · 2 listing
  ['PRD000010-001',3,0], // Tancho Hair Dye Hitam Alami 6 gr · 1 listing
  ['PRD000010-001',6,0], // Tancho Hair Dye Hitam Alami 6 gr · 1 listing
  ['PRD000010-002',12,0], // Tancho Hair Dye Brown Black 6 gr · 1 listing
  ['PRD000011-001',6,1], // Viva Air Mawar 100 ml · 2 listing
  ['PRD000011-001',10,0], // Viva Air Mawar 100 ml · 1 listing
  ['PRD000011-002',3,1], // Viva Air Mawar 200 ml · 1 listing
  ['PRD000011-002',6,0], // Viva Air Mawar 200 ml · 1 listing
  ['PRD000014-001',6,0], // Gatsby Treatment Hair Cream (THC) 25 gr · 1 listing
  ['PRD000014-001',12,0], // Gatsby Treatment Hair Cream (THC) 25 gr · 1 listing
  ['PRD000014-001',24,0], // Gatsby Treatment Hair Cream (THC) 25 gr · 1 listing
  ['PRD000014-004',2,0], // Gatsby Treatment Hair Cream (THC) 245 gr · 1 listing
  ['PRD000014-004',4,0], // Gatsby Treatment Hair Cream (THC) 245 gr · 2 listing
  ['PRD000014-007',2,0], // Gatsby Treatment Hair Cream (THC) Anti-Dandruff 70 gr · 1 listing
  ['PRD000015-002',2,0], // Gatsby Fiber Clay Matte Finish 80 gr · 1 listing
  ['PRD000015-002',3,0], // Gatsby Fiber Clay Matte Finish 80 gr · 1 listing
  ['PRD000016-001',6,0], // Gatsby Water Gloss Hyper Solid 30 gr · 1 listing
  ['PRD000016-002',3,0], // Gatsby Water Gloss Hyper Solid 75 gr · 1 listing
  ['PRD000016-002',6,0], // Gatsby Water Gloss Hyper Solid 75 gr · 1 listing
  ['PRD000016-003',3,0], // Gatsby Water Gloss Hyper Solid 100 gr · 1 listing
  ['PRD000016-005',2,0], // Gatsby Water Gloss Hyper Solid 300 gr · 1 listing
  ['PRD000016-006',6,0], // Gatsby Water Gloss Super Hard 30 gr · 1 listing
  ['PRD000016-006',12,0], // Gatsby Water Gloss Super Hard 30 gr · 1 listing
  ['PRD000016-008',3,0], // Gatsby Water Gloss Super Hard 100 gr · 1 listing
  ['PRD000016-010',3,0], // Gatsby Water Gloss Look Soft 100 gr · 1 listing
  ['PRD000016-011',3,0], // Gatsby Water Gloss Hard 100 gr · 1 listing
  ['PRD000016-012',3,0], // Gatsby Water Gloss Ultimate Hold 100 gr · 1 listing
  ['PRD000017-001',6,0], // Gatsby Fiber Pomade Glossy Finish 30 gr · 1 listing
  ['PRD000018-001',3,0], // Tancho Pomade Nourishing 20 gr · 1 listing
  ['PRD000018-001',12,0], // Tancho Pomade Nourishing 20 gr · 1 listing
  ['PRD000018-001',24,0], // Tancho Pomade Nourishing 20 gr · 1 listing
  ['PRD000020-001',6,0], // Dazzle Me Lock&Pop Mascara Longlash-Ting (Pink) · 1 listing
  ['PRD000020-002',3,0], // Dazzle Me Lock&Pop Mascara Volumax-Ing (Green) · 1 listing
  ['PRD000020-003',3,0], // Dazzle Me Lock&Pop Mascara 3D Curl-Ing (Iron Barbie) · 1 listing
  ['PRD000020-003',6,0], // Dazzle Me Lock&Pop Mascara 3D Curl-Ing (Iron Barbie) · 1 listing
  ['PRD000021-001',3,0], // Viva Pelembab with UV Filter Bengkuang 30 ml · 1 listing
  ['PRD000021-001',12,0], // Viva Pelembab with UV Filter Bengkuang 30 ml · 1 listing
  ['PRD000021-001',24,0], // Viva Pelembab with UV Filter Bengkuang 30 ml · 1 listing
  ['PRD000022-001',3,0], // Suria Snow White & Soft Cream 60 gr · 1 listing
  ['PRD000022-001',6,0], // Suria Snow White & Soft Cream 60 gr · 1 listing
  ['PRD000022-001',12,0], // Suria Snow White & Soft Cream 60 gr · 1 listing
  ['PRD000022-001',24,0], // Suria Snow White & Soft Cream 60 gr · 1 listing
  ['PRD000023-001',6,0], // Gatsby Pomade Supreme Grease 30 gr · 1 listing
  ['PRD000023-002',2,0], // Gatsby Pomade Supreme Grease 75 gr · 1 listing
  ['PRD000023-002',3,0], // Gatsby Pomade Supreme Grease 75 gr · 1 listing
  ['PRD000023-002',6,0], // Gatsby Pomade Supreme Grease 75 gr · 1 listing
  ['PRD000023-002',12,0], // Gatsby Pomade Supreme Grease 75 gr · 1 listing
  ['PRD000024-001',3,0], // Johnny Andrean Styling Cream Natural & Moisture 125 gr · 1 listing
  ['PRD000024-001',5,0], // Johnny Andrean Styling Cream Natural & Moisture 125 gr · 1 listing
  ['PRD000024-001',6,0], // Johnny Andrean Styling Cream Natural & Moisture 125 gr · 1 listing
  ['PRD000026-001',3,0], // Michido Cream 38 gr · 1 listing
  ['PRD000026-001',6,0], // Michido Cream 38 gr · 1 listing
  ['PRD000026-001',12,0], // Michido Cream 38 gr · 1 listing
  ['PRD000027-001',3,0], // Skiva Lipstick No. 21 · 1 listing
  ['PRD000027-001',24,0], // Skiva Lipstick No. 21 · 1 listing
  ['PRD000028-001',6,0], // Seger Snow Vanishing Cream 35 gr · 1 listing
  ['PRD000028-001',12,0], // Seger Snow Vanishing Cream 35 gr · 1 listing
  ['PRD000031-001',6,0], // Glow & Lovely Derma Glow Facial Foam 50 gr · 1 listing
  ['PRD000031-001',12,0], // Glow & Lovely Derma Glow Facial Foam 50 gr · 1 listing
  ['PRD000031-002',2,0], // Glow & Lovely Derma Glow Facial Foam 100 gr · 1 listing
  ['PRD000031-002',6,0], // Glow & Lovely Derma Glow Facial Foam 100 gr · 1 listing
  ['PRD000032-001',3,0], // Eskulin Cologne Gel Amusing Vanilla 50 ml · 1 listing
  ['PRD000032-001',4,0], // Eskulin Cologne Gel Amusing Vanilla 50 ml · 1 listing
  ['PRD000032-001',6,0], // Eskulin Cologne Gel Amusing Vanilla 50 ml · 1 listing
  ['PRD000032-001',12,0], // Eskulin Cologne Gel Amusing Vanilla 50 ml · 1 listing
  ['PRD000032-001',24,0], // Eskulin Cologne Gel Amusing Vanilla 50 ml · 1 listing
  ['PRD000032-002',3,1], // Eskulin Cologne Gel Amusing Vanilla 100 ml · 2 listing
  ['PRD000032-002',6,0], // Eskulin Cologne Gel Amusing Vanilla 100 ml · 1 listing
  ['PRD000032-003',6,0], // Eskulin Cologne Gel Enchanting White 50 ml · 2 listing
  ['PRD000032-003',12,0], // Eskulin Cologne Gel Enchanting White 50 ml · 1 listing
  ['PRD000032-004',3,0], // Eskulin Cologne Gel Enchanting White 100 ml · 1 listing
  ['PRD000032-005',3,0], // Eskulin Cologne Gel Adorable Pink 50 ml · 1 listing
  ['PRD000032-005',6,0], // Eskulin Cologne Gel Adorable Pink 50 ml · 1 listing
  ['PRD000032-005',12,0], // Eskulin Cologne Gel Adorable Pink 50 ml · 1 listing
  ['PRD000032-006',3,0], // Eskulin Cologne Gel Adorable Pink 100 ml · 1 listing
  ['PRD000032-007',3,0], // Eskulin Cologne Gel Dreamy Blue 50 ml · 1 listing
  ['PRD000032-007',6,0], // Eskulin Cologne Gel Dreamy Blue 50 ml · 1 listing
  ['PRD000032-007',12,0], // Eskulin Cologne Gel Dreamy Blue 50 ml · 1 listing
  ['PRD000032-008',3,1], // Eskulin Cologne Gel Dreamy Blue 100 ml · 2 listing
  ['PRD000032-009',6,0], // Eskulin Cologne Gel Romantic Purple 50 ml · 1 listing
  ['PRD000032-009',12,0], // Eskulin Cologne Gel Romantic Purple 50 ml · 1 listing
  ['PRD000032-010',3,1], // Eskulin Cologne Gel Romantic Purple 100 ml · 2 listing
  ['PRD000032-011',3,0], // Eskulin Cologne Gel Glamorous Red 50 ml · 1 listing
  ['PRD000032-011',6,0], // Eskulin Cologne Gel Glamorous Red 50 ml · 1 listing
  ['PRD000032-011',12,0], // Eskulin Cologne Gel Glamorous Red 50 ml · 1 listing
  ['PRD000032-012',3,1], // Eskulin Cologne Gel Glamorous Red 100 ml · 2 listing
  ['PRD000032-013',3,0], // Eskulin Cologne Gel Confident Peach 50 ml · 1 listing
  ['PRD000032-013',12,0], // Eskulin Cologne Gel Confident Peach 50 ml · 1 listing
  ['PRD000032-014',3,1], // Eskulin Cologne Gel Confident Peach 100 ml · 2 listing
  ['PRD000032-015',6,0], // Eskulin Cologne Gel Gleeful Yellow 50 ml · 1 listing
  ['PRD000032-015',12,0], // Eskulin Cologne Gel Gleeful Yellow 50 ml · 1 listing
  ['PRD000032-016',3,1], // Eskulin Cologne Gel Gleeful Yellow 100 ml · 2 listing
  ['PRD000033-001',3,0], // Viva Sunscreen Foundation Cream 22 gr · 1 listing
  ['PRD000033-001',6,0], // Viva Sunscreen Foundation Cream 22 gr · 1 listing
  ['PRD000033-001',36,0], // Viva Sunscreen Foundation Cream 22 gr · 1 listing
  ['PRD000035-001',3,0], // Viva Face Tonic Emollient 100 ml · 1 listing
  ['PRD000035-001',6,0], // Viva Face Tonic Emollient 100 ml · 1 listing
  ['PRD000035-003',3,0], // Viva Face Tonic Spirulina 100 ml · 1 listing
  ['PRD000035-003',6,0], // Viva Face Tonic Spirulina 100 ml · 1 listing
  ['PRD000035-003',10,0], // Viva Face Tonic Spirulina 100 ml · 1 listing
  ['PRD000035-004',3,0], // Viva Face Tonic Bengkuang 100 ml · 1 listing
  ['PRD000035-004',6,0], // Viva Face Tonic Bengkuang 100 ml · 1 listing
  ['PRD000035-004',10,0], // Viva Face Tonic Bengkuang 100 ml · 1 listing
  ['PRD000035-005',3,0], // Viva Face Tonic Green Tea 100 ml · 1 listing
  ['PRD000035-005',6,0], // Viva Face Tonic Green Tea 100 ml · 1 listing
  ['PRD000035-005',10,0], // Viva Face Tonic Green Tea 100 ml · 1 listing
  ['PRD000037-001',3,0], // Viva Milk Cleanser Mawar 100 ml · 1 listing
  ['PRD000037-001',6,0], // Viva Milk Cleanser Mawar 100 ml · 2 listing
  ['PRD000037-001',10,0], // Viva Milk Cleanser Mawar 100 ml · 1 listing
  ['PRD000037-003',3,0], // Viva Milk Cleanser Lemon 100 ml · 1 listing
  ['PRD000037-003',6,0], // Viva Milk Cleanser Lemon 100 ml · 1 listing
  ['PRD000037-004',3,0], // Viva Milk Cleanser Green Tea 100 ml · 1 listing
  ['PRD000037-004',6,0], // Viva Milk Cleanser Green Tea 100 ml · 1 listing
  ['PRD000037-004',10,0], // Viva Milk Cleanser Green Tea 100 ml · 1 listing
  ['PRD000037-005',3,0], // Viva Milk Cleanser Emollient 100 ml · 1 listing
  ['PRD000037-005',6,0], // Viva Milk Cleanser Emollient 100 ml · 1 listing
  ['PRD000037-006',3,0], // Viva Milk Cleanser Bengkuang 100 ml · 1 listing
  ['PRD000037-006',6,0], // Viva Milk Cleanser Bengkuang 100 ml · 1 listing
  ['PRD000037-006',10,0], // Viva Milk Cleanser Bengkuang 100 ml · 1 listing
  ['PRD000037-007',6,0], // Viva Milk Cleanser Spirulina 100 ml · 1 listing
  ['PRD000037-007',10,0], // Viva Milk Cleanser Spirulina 100 ml · 1 listing
  ['PRD000038-001',3,0], // Laurent L-Gluthatione Whitening Lotion 250 ml · 1 listing
  ['PRD000038-001',4,0], // Laurent L-Gluthatione Whitening Lotion 250 ml · 1 listing
  ['PRD000039-001',3,0], // Kelly Lemon Soap 15 gr · 1 listing
  ['PRD000039-001',6,0], // Kelly Lemon Soap 15 gr · 1 listing
  ['PRD000039-001',12,0], // Kelly Lemon Soap 15 gr · 1 listing
  ['PRD000039-002',3,0], // Kelly Lemon Soap 25 gr · 1 listing
  ['PRD000039-002',6,0], // Kelly Lemon Soap 25 gr · 1 listing
  ['PRD000039-002',12,0], // Kelly Lemon Soap 25 gr · 1 listing
  ['PRD000039-003',3,0], // Kelly Lemon Soap 75 gr · 1 listing
  ['PRD000039-003',6,0], // Kelly Lemon Soap 75 gr · 1 listing
  ['PRD000041-001',3,0], // Gatsby Deodorant Perfume Spray Gold 50 ml · 1 listing
  ['PRD000041-001',6,0], // Gatsby Deodorant Perfume Spray Gold 50 ml · 1 listing
  ['PRD000041-003',3,0], // Gatsby Deodorant Perfume Spray Gold 175 ml · 1 listing
  ['PRD000046-001',3,0], // Hanasui Vitamin C Serum 20 ml · 2 listing
  ['PRD000046-001',6,0], // Hanasui Vitamin C Serum 20 ml · 1 listing
  ['PRD000047-001',3,0], // Hanasui Whitening Gold Serum 20 ml · 1 listing
  ['PRD000047-001',6,0], // Hanasui Whitening Gold Serum 20 ml · 1 listing
  ['PRD000047-001',9,0], // Hanasui Whitening Gold Serum 20 ml · 1 listing
  ['PRD000047-001',12,0], // Hanasui Whitening Gold Serum 20 ml · 1 listing
  ['PRD000050-001',6,0], // Viva Compact Powder Kuning Langsat · 1 listing
  ['PRD000050-001',12,0], // Viva Compact Powder Kuning Langsat · 1 listing
  ['PRD000050-001',24,0], // Viva Compact Powder Kuning Langsat · 1 listing
  ['PRD000050-002',6,0], // Viva Compact Powder Natural · 1 listing
  ['PRD000050-002',12,0], // Viva Compact Powder Natural · 1 listing
  ['PRD000051-001',6,0], // Viva Compact Powder Lilac Kuning Langsat · 1 listing
  ['PRD000051-002',6,0], // Viva Compact Powder Lilac Natural · 1 listing
  ['PRD000052-001',6,0], // Kelly Pearl Cream 5 gr · 1 listing
  ['PRD000052-001',12,0], // Kelly Pearl Cream 5 gr · 1 listing
  ['PRD000052-002',3,0], // Kelly Pearl Cream 15 gr · 1 listing
  ['PRD000052-002',6,0], // Kelly Pearl Cream 15 gr · 1 listing
  ['PRD000052-002',12,0], // Kelly Pearl Cream 15 gr · 1 listing
  ['PRD000053-001',3,0], // Tancho Treatment Hair Dye Natural Black · 1 listing
  ['PRD000053-001',6,0], // Tancho Treatment Hair Dye Natural Black · 1 listing
  ['PRD000054-001',2,0], // Sariayu Bright Skin Putih Langsat Facial Foam 75 gr · 1 listing
  ['PRD000054-001',3,0], // Sariayu Bright Skin Putih Langsat Facial Foam 75 gr · 1 listing
  ['PRD000054-001',6,0], // Sariayu Bright Skin Putih Langsat Facial Foam 75 gr · 1 listing
  ['PRD000055-001',2,0], // Sariayu Acne Care Facial Foam 75 gr · 1 listing
  ['PRD000055-001',3,0], // Sariayu Acne Care Facial Foam 75 gr · 1 listing
  ['PRD000055-001',6,0], // Sariayu Acne Care Facial Foam 75 gr · 1 listing
  ['PRD000055-001',12,0], // Sariayu Acne Care Facial Foam 75 gr · 1 listing
  ['PRD000055-001',24,0], // Sariayu Acne Care Facial Foam 75 gr · 1 listing
  ['PRD000056-001',2,0], // Viva Glowing Bright Facial Foam 100 ml · 1 listing
  ['PRD000056-001',3,0], // Viva Glowing Bright Facial Foam 100 ml · 1 listing
  ['PRD000056-001',6,0], // Viva Glowing Bright Facial Foam 100 ml · 1 listing
  ['PRD000056-001',12,0], // Viva Glowing Bright Facial Foam 100 ml · 1 listing
  ['PRD000057-001',3,0], // Viva Hydra Lift Facial Foam 100 ml · 1 listing
  ['PRD000058-001',2,0], // Garnier Sakura Glow Ceramide Face Wash 50 ml · 1 listing
  ['PRD000060-001',3,0], // Meco Pearl Cream 12 gr · 1 listing
  ['PRD000060-001',6,0], // Meco Pearl Cream 12 gr · 1 listing
  ['PRD000060-001',9,0], // Meco Pearl Cream 12 gr · 1 listing
  ['PRD000060-001',12,0], // Meco Pearl Cream 12 gr · 1 listing
  ['PRD000061-001',2,0], // Gatsby Splash Cologne Musky Deep Ocean 175 ml · 1 listing
  ['PRD000061-001',3,0], // Gatsby Splash Cologne Musky Deep Ocean 175 ml · 1 listing
  ['PRD000062-001',3,0], // Gatsby Urban Cologne Infinity 125 ml · 1 listing
  ['PRD000062-002',3,0], // Gatsby Urban Cologne Ardent 125 ml · 1 listing
  ['PRD000062-003',3,0], // Gatsby Urban Cologne Dignity 125 ml · 1 listing
  ['PRD000062-007',3,0], // Gatsby Urban Cologne Energy 125 ml · 1 listing
  ['PRD000063-001',2,0], // Gatsby Pomade Perfect Rise 75 gr · 1 listing
  ['PRD000071-001',3,0], // Pixy White Aqua Gentle Facial Wash 100 gr · 1 listing
  ['PRD000075-001',12,1], // Pixy Stick Deodorant Woody A 34 gr · 1 listing
  ['PRD000075-002',12,1], // Pixy Stick Deodorant Chypre A 34 gr · 1 listing
  ['PRD000075-004',12,1], // Pixy Stick Deodorant Bouquet A 34 gr · 1 listing
  ['PRD000075-005',12,1], // Pixy Stick Deodorant Floriental 34 gr · 1 listing
  ['PRD000076-001',6,1], // Marcks Beauty Powder Creme 40 gr · 1 listing
  ['PRD000076-003',6,1], // Marcks Beauty Powder Invisible 40 gr · 1 listing
  ['PRD000076-004',6,1], // Marcks Beauty Powder Natural Beige 40 gr · 1 listing
  ['PRD000077-001',3,0], // Resik-V Khasiat Manjakani 50 ml · 1 listing
  ['PRD000077-001',12,0], // Resik-V Khasiat Manjakani 50 ml · 1 listing
  ['PRD000077-002',6,0], // Resik-V Khasiat Manjakani 90 ml · 1 listing
  ['PRD000078-001',2,0], // Seger Baby Aloe Vera & Sunflower 35 gr · 1 listing
  ['PRD000078-001',3,0], // Seger Baby Aloe Vera & Sunflower 35 gr · 1 listing
  ['PRD000078-002',3,0], // Seger Baby Chamomile & Citronella 35 gr · 1 listing
  ['PRD000078-003',3,0], // Seger Baby Rice Milk & Chamomile 35 gr · 2 listing
  ['PRD000078-003',6,0], // Seger Baby Rice Milk & Chamomile 35 gr · 1 listing
  ['PRD000079-001',3,0], // Seger Baby Calming Cream Moisturizer 35 gr · 1 listing
  ['PRD000079-001',6,0], // Seger Baby Calming Cream Moisturizer 35 gr · 1 listing
  ['PRD000079-001',12,0], // Seger Baby Calming Cream Moisturizer 35 gr · 1 listing
  ['PRD000080-005',12,0], // Marina Natural Nourished & Healthy 95 ml · 1 listing
  ['PRD000084-004',12,0], // Marina Natural Smooth & Glow 95 ml · 1 listing
  ['PRD000086-001',6,0], // My Baby Xmart Powder Cornstarch 50 gr · 1 listing
  ['PRD000086-001',12,0], // My Baby Xmart Powder Cornstarch 50 gr · 1 listing
  ['PRD000106-002',2,0], // Pixy UV Primer Sunscreen Aqua Gel 30 gr · 1 listing
  ['PRD000117-004',8,0], // Cussons Baby Cream Nourish & Care 50 gr · 1 listing
  ['PRD000118-001',2,0], // Purbasari Hand & Body Lotion Habbatus Sauda 200 ml · 1 listing
  ['PRD000118-001',3,0], // Purbasari Hand & Body Lotion Habbatus Sauda 200 ml · 1 listing
  ['PRD000118-001',5,0], // Purbasari Hand & Body Lotion Habbatus Sauda 200 ml · 1 listing
  ['PRD000118-002',2,0], // Purbasari Hand & Body Lotion Tin & Kurma 200 ml · 1 listing
  ['PRD000118-002',4,0], // Purbasari Hand & Body Lotion Tin & Kurma 200 ml · 1 listing
  ['PRD000118-005',3,0], // Purbasari Hand & Body Lotion Habbatus Sauda 100 ml · 1 listing
  ['PRD000118-005',6,0], // Purbasari Hand & Body Lotion Habbatus Sauda 100 ml · 1 listing
  ['PRD000119-001',3,0], // Purbasari Minyak Zaitun 150 ml · 1 listing
  ['PRD000119-001',6,0], // Purbasari Minyak Zaitun 150 ml · 1 listing
  ['PRD000121-005',2,0], // Purbasari Lulur Mandi Sakura Glow 200 gr · 1 listing
  ['PRD000122-001',2,0], // Purbasari Gluta-Hya Body Scrub 200 gr · 1 listing
  ['PRD000168-003',3,0], // Gatsby The Nature Styling Balm Clay 30 gr · 1 listing
  ['PRD000168-003',6,0], // Gatsby The Nature Styling Balm Clay 30 gr · 1 listing
  ['PRD000227-001',3,0], // Pixy Perfumed Talc Week End 90 gr · 1 listing
  ['PRD000232-001',2,0], // Spalding Perfumed Talc 90 gr · 1 listing
  ['PRD000232-001',3,0], // Spalding Perfumed Talc 90 gr · 1 listing
  ['PRD000243-008',3,0], // Cussons Baby Wash Deep Moisture 100 ml · 1 listing
  ['PRD000253-003',3,0], // Cussons Baby Cotton Buds Regular 100 Batang · 1 listing
  ['PRD000345-001',3,0], // Viva Peeling Serum 20 ml · 1 listing
  ['PRD000345-001',12,0], // Viva Peeling Serum 20 ml · 1 listing
  ['PRD000351-001',4,0], // Viva Acne Lotion 30 ml · 1 listing
  ['PRD000351-001',6,0], // Viva Acne Lotion 30 ml · 1 listing
  ['PRD000352-001',3,0], // Viva Acne Gel 15 gr · 1 listing
  ['PRD000352-001',6,0], // Viva Acne Gel 15 gr · 1 listing
  ['PRD000353-001',3,0], // Viva Acne Serum 20 ml · 1 listing
  ['PRD000353-001',12,0], // Viva Acne Serum 20 ml · 1 listing
  ['PRD000377-001',3,0], // Viva Glowing White Serum 20 ml · 1 listing
  ['PRD000377-001',12,0], // Viva Glowing White Serum 20 ml · 1 listing
  ['PRD000379-001',12,0], // Viva Anti Aging Serum 20 ml · 1 listing
  ['PRD000380-001',3,0], // Viva Vit C Collagen Serum 20 ml · 1 listing
  ['PRD000381-001',2,0], // Viva Gold Whitening Serum 20 ml · 1 listing
  ['PRD000381-001',3,0], // Viva Gold Whitening Serum 20 ml · 2 listing
  ['PRD000381-001',6,0], // Viva Gold Whitening Serum 20 ml · 1 listing
  ['PRD000381-001',12,0], // Viva Gold Whitening Serum 20 ml · 1 listing
  ['PRD000387-001',3,0], // Viva Acne Care Facial Foam 100 ml · 1 listing
  ['PRD000387-001',6,0], // Viva Acne Care Facial Foam 100 ml · 1 listing
  ['PRD000420-003',3,0], // Viva White Lip Color Choco Dreamer 4.2 gr · 1 listing
  ['PRD000420-004',3,0], // Viva White Lip Color Aloe Secret 4.2 gr · 1 listing
  ['PRD000429-001',3,0], // Hanasui Moisturizer Gel Ceramide Probiotics 30 gr · 1 listing
  ['PRD000433-004',2,0], // Hanasui Power Serum Bright 20 ml · 2 listing
  ['PRD000433-006',2,0], // Hanasui Power Serum Acne 20 ml · 1 listing
  ['PRD000435-001',2,0], // Hanasui Acne Expert Night Cream 15 gr · 1 listing
  ['PRD000437-001',3,0], // Hanasui Acne Expert Spot Gel 15 ml · 1 listing
  ['PRD000438-001',3,0], // Hanasui Glow Expert Gentle Cleanser 60 gr · 1 listing
  ['PRD000438-001',6,0], // Hanasui Glow Expert Gentle Cleanser 60 gr · 1 listing
  ['PRD000439-001',6,0], // Hanasui Glow Expert Day Cream 15 gr · 1 listing
  ['PRD000440-001',3,0], // Hanasui Glow Expert Night Cream 15 gr · 2 listing
  ['PRD000440-001',6,0], // Hanasui Glow Expert Night Cream 15 gr · 1 listing
  ['PRD000441-001',3,0], // Hanasui Glow Expert Essence 105 ml · 1 listing
  ['PRD000450-001',3,0], // Hanasui Soap White Rice 60 gr · 1 listing
  ['PRD000450-004',3,0], // Hanasui Soap Coffee 60 gr · 1 listing
  ['PRD000455-001',2,0], // Hanasui Body Serum Gel Aloe Vera 200 ml · 1 listing
  ['PRD000475-001',3,0], // Hanasui Fix & Glow Setting Spray 60 ml · 1 listing
  ['PRD000508-002',3,0], // My Baby Minyak Telon Plus Eucalyptus 60 ml · 1 listing
  ['PRD000508-002',6,0], // My Baby Minyak Telon Plus Eucalyptus 60 ml · 1 listing
  ['PRD000508-005',6,0], // My Baby Minyak Telon Plus Lavender 60 ml · 1 listing
  ['PRD000509-001',6,0], // Metal Fortis Long Life Shampoo Metal 60 ml · 1 listing
  ['PRD000509-003',2,0], // Metal Fortis Long Life Shampoo Metal 200 ml · 1 listing
  ['PRD000510-001',3,0], // Eskulin Eau De Parfum Twilight Amour 30 ml · 1 listing
  ['PRD000510-002',3,0], // Eskulin Eau De Parfum Twilight Enchanted Petal 30 ml · 1 listing
  ['PRD000514-002',3,0], // Resik-V Manjakani White 50 ml · 1 listing
  ['PRD000514-002',6,0], // Resik-V Manjakani White 50 ml · 1 listing
  ['PRD000518-003',6,0], // Marina UV White Hand & Body Lotion Nourish & Bright 92 ml · 1 listing
  ['PRD000518-004',6,0], // Marina UV White Hand & Body Lotion Healthy & Glow 92 ml · 1 listing
  ['PRD000518-005',6,0], // Marina UV White Hand & Body Lotion Dewy Bright 92 ml · 1 listing
  ['PRD000518-006',6,0], // Marina UV White Hand & Body Lotion E Collagen Asta 92 ml · 1 listing
  ['PRD000542-001',12,0], // Marina Brighten Up UV Compact Powder 01 Ivory 12 gr · 1 listing
  ['PRD000542-001',36,1], // Marina Brighten Up UV Compact Powder 01 Ivory 12 gr · 1 listing
  ['PRD000542-002',12,0], // Marina Brighten Up UV Compact Powder 02 Olive 12 gr · 1 listing
  ['PRD000542-002',36,1], // Marina Brighten Up UV Compact Powder 02 Olive 12 gr · 1 listing
  ['PRD000542-003',12,0], // Marina Brighten Up UV Compact Powder 03 Peach 12 gr · 1 listing
  ['PRD000542-003',24,1], // Marina Brighten Up UV Compact Powder 03 Peach 12 gr · 1 listing
  ['PRD000542-003',36,1], // Marina Brighten Up UV Compact Powder 03 Peach 12 gr · 1 listing
  ['PRD000542-004',12,0], // Marina Brighten Up UV Compact Powder 04 Natural 12 gr · 1 listing
  ['PRD000542-004',24,1], // Marina Brighten Up UV Compact Powder 04 Natural 12 gr · 1 listing
  ['PRD000542-004',36,1], // Marina Brighten Up UV Compact Powder 04 Natural 12 gr · 1 listing
  ['PRD000583-001',12,0], // My Baby Powder Calm & Relax 50 gr · 1 listing
  ['PRD000659-004',2,0], // Posh Anti-Perspirant Deodorant Soft and Smooth 50 ml · 1 listing
  ['PRD000664-006',2,0], // Emeron Lovely Naturals Hand & Body Lotion Apple Orange 200 ml · 1 listing
  ['PRD000664-006',3,0], // Emeron Lovely Naturals Hand & Body Lotion Apple Orange 200 ml · 1 listing
  ['PRD000664-006',6,0], // Emeron Lovely Naturals Hand & Body Lotion Apple Orange 200 ml · 1 listing
  ['PRD000667-003',2,0], // Emeron Naturals Body Serum Banana Strawberry 200 ml · 1 listing
  ['PRD000667-003',3,0], // Emeron Naturals Body Serum Banana Strawberry 200 ml · 1 listing
  ['PRD000671-002',3,0], // Garnier Bright Complete Brightening Foam 50 ml · 1 listing
  ['PRD000699-001',6,0], // Garnier Bright Complete UV Moisturizer 20 ml · 1 listing
  ['PRD000710-001',3,1], // Kodomo Pasta Gigi Strawberry 45 gr · 1 listing
  ['PRD000710-003',3,1], // Kodomo Pasta Gigi Melon 45 gr · 1 listing
  ['PRD000717-001',2,0], // Posh Men Active Deodorant Cool 50 ml · 1 listing
  ['PRD000717-003',3,0], // Posh Men Active Deodorant Pro 50 ml · 1 listing
  ['PRD000723-008',2,0], // Rexona Men Roll On Ice Cool 45 ml · 1 listing
  ['PRD000725-001',2,0], // Rexona Roll On Powder Dry 45 ml · 2 listing
  ['PRD000725-002',2,0], // Rexona Roll On Shower Clean 45 ml · 1 listing
  ['PRD000725-008',2,0], // Rexona Roll On Passion Fresh 45 ml · 1 listing
  ['PRD000743-001',2,0], // Seger Snow Lightening Cream 60 gr · 1 listing
  ['PRD000743-001',3,0], // Seger Snow Lightening Cream 60 gr · 1 listing
  ['PRD000743-001',4,0], // Seger Snow Lightening Cream 60 gr · 1 listing
  ['PRD000743-001',6,0], // Seger Snow Lightening Cream 60 gr · 2 listing
  ['PRD000743-001',12,0], // Seger Snow Lightening Cream 60 gr · 1 listing
  ['PRD000743-002',6,0], // Seger Snow Lightening Cream 35 gr · 2 listing
  ['PRD000743-002',12,0], // Seger Snow Lightening Cream 35 gr · 2 listing
  ['PRD000754-001',2,0], // Azzura Diamond Bright Serum 20 ml · 1 listing
];

function importShopeeMultipacks_(user, deadline, rows) {
  rows = rows || SHOPEE_MP_ROWS_;
  const B = db_('BUNDLE_MASTERS'), C = db_('BUNDLE_COMPONENTS'), V = db_('PRODUCT_VARIANTS');
  const bySku = {};
  V.rows().forEach((v) => v.Status === STATUS.ACTIVE && (bySku[v.SKU] = v));
  const have = {}, names = {}, used = {};
  const active = {};
  C.rows().forEach((c) => c.Status === STATUS.ACTIVE && (active[c.BundleID] = (active[c.BundleID] || []).concat([c])));
  B.rows().forEach((b) => {
    used[b.BundleSKU] = 1;
    if (b.Status === STATUS.ARCHIVED) return;
    names[b.NameKey] = 1;
    const cs = active[b.BundleID] || [];
    if (b.BundleType === 'MULTIPACK' && cs.length === 1) have[cs[0].VariantID + 'x' + cs[0].Quantity] = 1;
  });
  const rep = { created: 0, skipped: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    if (deadline && Date.now() > deadline) return Object.assign(rep, { done: false });
    const [sku, qty, mix] = rows[i];
    const v = bySku[sku];
    if (!v) { rep.errors.push(sku + ': Child SKU tidak aktif/tidak ada'); continue; }
    if (have[v.VariantID + 'x' + qty]) { rep.skipped++; continue; }
    let p;
    try { p = assertUsableVariant_(v, sku); } catch (e) { rep.errors.push(sku + ': ' + e.message); continue; }
    let name = cleanText('Paket ' + qty + ' ' + (p.BaseUnit || 'PCS') + ' ' + (v.ProductSKUName || p.ProductName + ' ' + v.VariantName)).slice(0, 120);
    if (names[masterNameKey(name)]) name = cleanText(name.slice(0, 105) + ' ' + sku);
    let code;
    do code = padCode_(MULTIPACK_PREFIX, nextSeq_('multipack_no'));
    while (used[code]);
    used[code] = 1;
    const ts = now_();
    const b = B.insert({ BundleID: uuid_(), BundleSKU: code, BundleType: 'MULTIPACK', BundleName: name, NameKey: masterNameKey(name), StockMode: 'VIRTUAL', Stockable: 'NON_STOCKABLE', PickQuantity: null, Status: STATUS.ACTIVE,
      Description: 'Paket jual Shopee' + (mix ? ' — listing menulis boleh mix varian (isi aktual dicek saat pemenuhan)' : ''), CreatedBy: user.email, CreatedAt: ts, UpdatedBy: user.email, UpdatedAt: ts, Version: 1 });
    C.insert({ ComponentID: uuid_(), BundleID: b.BundleID, VariantID: v.VariantID, Quantity: qty, Selectable: false, Status: STATUS.ACTIVE, SortOrder: 1, CreatedAt: ts });
    recordLifecycle_(user, 'bundle', b.BundleID, '', '', STATUS.ACTIVE, 'Registrasi paket dari listing Shopee');
    audit_(user.email, 'bundle.create', 'bundle', b.BundleID, null, { sku: code, type: 'MULTIPACK', name, component: sku, quantity: qty }, { source: 'shopee_mass_update_2026-11-06' });
    have[v.VariantID + 'x' + qty] = 1;
    names[masterNameKey(name)] = 1;
    rep.created++;
  }
  return Object.assign(rep, { done: true });
}
