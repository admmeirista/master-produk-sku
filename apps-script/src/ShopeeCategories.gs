/**
 * Kategori resmi Shopee Indonesia — kategori utama "Perawatan & Kecantikan" saja (120 simpul, 98 kategori akhir).
 * Sumber: Kategori_Shopee_Indonesia_2026-10-18.xlsx (sheet Hierarki & Kategori; API resmi seller.shopee.co.id global_category).
 * Kolom: [ID Shopee, ID induk Shopee, tingkat, nama, jalur lengkap, kategori akhir (1/0)].
 * Disalin ke MASTER_CATEGORIES otomatis (syncShopeeCategories_) — naikkan SHOPEE_CATEGORY_VERSION bila daftar diperbarui.
 */
const SHOPEE_CATEGORY_VERSION = '2026-10-18';
const SHOPEE_BEAUTY_CATEGORIES = [
  ["100630","",1,"Perawatan & Kecantikan","Perawatan & Kecantikan",0],
  ["100658","100630",2,"Perawatan Tangan, Kaki & Kuku","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku",0],
  ["100865","100658",3,"Perawatan Tangan","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Tangan",0],
  ["101607","100865",4,"Masker Tangan","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Tangan > Masker Tangan",1],
  ["101608","100865",4,"Lotion, Cream & Scrub","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Tangan > Lotion, Cream & Scrub",1],
  ["101609","100865",4,"Sabun Cuci Tangan","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Tangan > Sabun Cuci Tangan",1],
  ["100866","100658",3,"Perawatan Kaki","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kaki",0],
  ["101611","100866",4,"Deodoran Kaki","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kaki > Deodoran Kaki",1],
  ["101612","100866",4,"Masker Kaki","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kaki > Masker Kaki",1],
  ["101613","100866",4,"Lotion, Cream & Scrub","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kaki > Lotion, Cream & Scrub",1],
  ["100867","100658",3,"Perawatan Kuku","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kuku",0],
  ["101615","100867",4,"Base & Top Coat","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kuku > Base & Top Coat",1],
  ["102029","100867",4,"Cat Kuku","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kuku > Cat Kuku",1],
  ["102030","100867",4,"Pembersih Cat Kuku","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kuku > Pembersih Cat Kuku",1],
  ["102031","100867",4,"Treatment Kuku","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kuku > Treatment Kuku",1],
  ["102032","100867",4,"Kuku Palsu","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kuku > Kuku Palsu",1],
  ["102033","100867",4,"Nail Art & Sticker","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kuku > Nail Art & Sticker",1],
  ["102034","100867",4,"Alat & Mesin Manicure","Perawatan & Kecantikan > Perawatan Tangan, Kaki & Kuku > Perawatan Kuku > Alat & Mesin Manicure",1],
  ["100659","100630",2,"Perawatan Rambut","Perawatan & Kecantikan > Perawatan Rambut",0],
  ["100869","100659",3,"Shampo","Perawatan & Kecantikan > Perawatan Rambut > Shampo",1],
  ["100870","100659",3,"Pewarna Rambut","Perawatan & Kecantikan > Perawatan Rambut > Pewarna Rambut",1],
  ["100871","100659",3,"Treatment Rambut","Perawatan & Kecantikan > Perawatan Rambut > Treatment Rambut",1],
  ["100872","100659",3,"Kondisioner Rambut dan Kulit Kepala","Perawatan & Kecantikan > Perawatan Rambut > Kondisioner Rambut dan Kulit Kepala",1],
  ["100873","100659",3,"Hair Styling","Perawatan & Kecantikan > Perawatan Rambut > Hair Styling",1],
  ["100660","100630",2,"Perawatan Pria","Perawatan & Kecantikan > Perawatan Pria",0],
  ["100875","100660",3,"Perawatan Tubuh","Perawatan & Kecantikan > Perawatan Pria > Perawatan Tubuh",1],
  ["100876","100660",3,"Perawatan Wajah","Perawatan & Kecantikan > Perawatan Pria > Perawatan Wajah",0],
  ["101616","100876",4,"Pembersih Wajah","Perawatan & Kecantikan > Perawatan Pria > Perawatan Wajah > Pembersih Wajah",1],
  ["101617","100876",4,"Pelembab & Treatment","Perawatan & Kecantikan > Perawatan Pria > Perawatan Wajah > Pelembab & Treatment",1],
  ["100877","100660",3,"Shaving & Grooming","Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming",0],
  ["101619","100877",4,"Perawatan Setelah Bercukur","Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming > Perawatan Setelah Bercukur",1],
  ["101620","100877",4,"Cream, Foam & Gel","Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming > Cream, Foam & Gel",1],
  ["101621","100877",4,"Pisau Cukur","Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming > Pisau Cukur",1],
  ["101622","100877",4,"Alat Cukur","Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming > Alat Cukur",1],
  ["101623","100877",4,"Sikat Cukur","Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming > Sikat Cukur",1],
  ["101624","100877",4,"Trimmers, Gunting & Groomer Multi-fungsi","Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming > Trimmers, Gunting & Groomer Multi-fungsi",1],
  ["101625","100877",4,"Aksesoris Cukur","Perawatan & Kecantikan > Perawatan Pria > Shaving & Grooming > Aksesoris Cukur",1],
  ["100878","100660",3,"Perawatan Rambut","Perawatan & Kecantikan > Perawatan Pria > Perawatan Rambut",1],
  ["100661","100630",2,"Parfum & Wewangian","Perawatan & Kecantikan > Parfum & Wewangian",1],
  ["100662","100630",2,"Kosmetik","Perawatan & Kecantikan > Kosmetik",0],
  ["100881","100662",3,"Kosmetik Wajah","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah",0],
  ["101627","100881",4,"Make Up Base & Primer","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah > Make Up Base & Primer",1],
  ["101628","100881",4,"Foundation","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah > Foundation",1],
  ["101629","100881",4,"BB & CC Cream","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah > BB & CC Cream",1],
  ["101630","100881",4,"Bedak","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah > Bedak",1],
  ["101631","100881",4,"Concealer & Corrector","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah > Concealer & Corrector",1],
  ["101632","100881",4,"Bronzer, Contour & Highlighter","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah > Bronzer, Contour & Highlighter",1],
  ["101633","100881",4,"Setting & Finishing Spray","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah > Setting & Finishing Spray",1],
  ["101634","100881",4,"Blush","Perawatan & Kecantikan > Kosmetik > Kosmetik Wajah > Blush",1],
  ["100882","100662",3,"Kosmetik Mata","Perawatan & Kecantikan > Kosmetik > Kosmetik Mata",0],
  ["101636","100882",4,"Eyeshadow","Perawatan & Kecantikan > Kosmetik > Kosmetik Mata > Eyeshadow",1],
  ["101637","100882",4,"Primer Mata","Perawatan & Kecantikan > Kosmetik > Kosmetik Mata > Primer Mata",1],
  ["101638","100882",4,"Eyeliner","Perawatan & Kecantikan > Kosmetik > Kosmetik Mata > Eyeliner",1],
  ["101639","100882",4,"Maskara","Perawatan & Kecantikan > Kosmetik > Kosmetik Mata > Maskara",1],
  ["101640","100882",4,"Eyebrow","Perawatan & Kecantikan > Kosmetik > Kosmetik Mata > Eyebrow",1],
  ["100883","100662",3,"Kosmetik Bibir","Perawatan & Kecantikan > Kosmetik > Kosmetik Bibir",0],
  ["101642","100883",4,"Lipstik","Perawatan & Kecantikan > Kosmetik > Kosmetik Bibir > Lipstik",1],
  ["101643","100883",4,"Lip Gloss","Perawatan & Kecantikan > Kosmetik > Kosmetik Bibir > Lip Gloss",1],
  ["101644","100883",4,"Lip Liner","Perawatan & Kecantikan > Kosmetik > Kosmetik Bibir > Lip Liner",1],
  ["101645","100883",4,"Lip Tint","Perawatan & Kecantikan > Kosmetik > Kosmetik Bibir > Lip Tint",1],
  ["101646","100883",4,"Lip Plumper","Perawatan & Kecantikan > Kosmetik > Kosmetik Bibir > Lip Plumper",1],
  ["100884","100662",3,"Pembersih Make Up","Perawatan & Kecantikan > Kosmetik > Pembersih Make Up",1],
  ["100663","100630",2,"Alat Kecantikan","Perawatan & Kecantikan > Alat Kecantikan",0],
  ["100885","100663",3,"Aksesoris Make Up","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up",0],
  ["101649","100885",4,"Kapas","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Kapas",1],
  ["101650","100885",4,"Tas Make Up","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Tas Make Up",1],
  ["101651","100885",4,"Kaca / Cermin","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Kaca / Cermin",1],
  ["101652","100885",4,"Pembersih Make Up Brush","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Pembersih Make Up Brush",1],
  ["101653","100885",4,"Make Up Brush","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Make Up Brush",1],
  ["101654","100885",4,"Make Up Sponge & Applicator","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Make Up Sponge & Applicator",1],
  ["101655","100885",4,"Penjepit Bulu Mata","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Penjepit Bulu Mata",1],
  ["101656","100885",4,"Eyebrow Template","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Eyebrow Template",1],
  ["101657","100885",4,"Bulu Mata Palsu","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Bulu Mata Palsu",1],
  ["101658","100885",4,"Skot Mata","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Skot Mata",1],
  ["101659","100885",4,"Rautan","Perawatan & Kecantikan > Alat Kecantikan > Aksesoris Make Up > Rautan",1],
  ["100886","100663",3,"Alat Perawatan Wajah","Perawatan & Kecantikan > Alat Kecantikan > Alat Perawatan Wajah",0],
  ["101660","100886",4,"Facial Steamer","Perawatan & Kecantikan > Alat Kecantikan > Alat Perawatan Wajah > Facial Steamer",1],
  ["101661","100886",4,"Alat Pelangsing & Pijat Wajah","Perawatan & Kecantikan > Alat Kecantikan > Alat Perawatan Wajah > Alat Pelangsing & Pijat Wajah",1],
  ["101662","100886",4,"Alat Pembersih Wajah","Perawatan & Kecantikan > Alat Kecantikan > Alat Perawatan Wajah > Alat Pembersih Wajah",1],
  ["100887","100663",3,"Alat Pelangsing Tubuh","Perawatan & Kecantikan > Alat Kecantikan > Alat Pelangsing Tubuh",1],
  ["100888","100663",3,"Alat Penghilang Bulu Rambut","Perawatan & Kecantikan > Alat Kecantikan > Alat Penghilang Bulu Rambut",1],
  ["100889","100663",3,"Alat Rambut","Perawatan & Kecantikan > Alat Kecantikan > Alat Rambut",0],
  ["101664","100889",4,"Sisir","Perawatan & Kecantikan > Alat Kecantikan > Alat Rambut > Sisir",1],
  ["101665","100889",4,"Hair Dryer","Perawatan & Kecantikan > Alat Kecantikan > Alat Rambut > Hair Dryer",1],
  ["101666","100889",4,"Peralatan Styling Rambut","Perawatan & Kecantikan > Alat Kecantikan > Alat Rambut > Peralatan Styling Rambut",1],
  ["101667","100889",4,"Alat Styling Heatless","Perawatan & Kecantikan > Alat Kecantikan > Alat Rambut > Alat Styling Heatless",1],
  ["100664","100630",2,"Perawatan Wajah","Perawatan & Kecantikan > Perawatan Wajah",0],
  ["100891","100664",3,"Pembersih Wajah","Perawatan & Kecantikan > Perawatan Wajah > Pembersih Wajah",1],
  ["100892","100664",3,"Toner","Perawatan & Kecantikan > Perawatan Wajah > Toner",1],
  ["100893","100664",3,"Pelembab Wajah","Perawatan & Kecantikan > Perawatan Wajah > Pelembab Wajah",1],
  ["100894","100664",3,"Minyak Wajah","Perawatan & Kecantikan > Perawatan Wajah > Minyak Wajah",1],
  ["100896","100664",3,"Serum & Essence Wajah","Perawatan & Kecantikan > Perawatan Wajah > Serum & Essence Wajah",1],
  ["100897","100664",3,"Scrub & Peel Wajah","Perawatan & Kecantikan > Perawatan Wajah > Scrub & Peel Wajah",1],
  ["100898","100664",3,"Masker Wajah","Perawatan & Kecantikan > Perawatan Wajah > Masker Wajah",1],
  ["100899","100664",3,"Treatment Mata","Perawatan & Kecantikan > Perawatan Wajah > Treatment Mata",0],
  ["101669","100899",4,"Cream Mata","Perawatan & Kecantikan > Perawatan Wajah > Treatment Mata > Cream Mata",1],
  ["101670","100899",4,"Masker Mata","Perawatan & Kecantikan > Perawatan Wajah > Treatment Mata > Masker Mata",1],
  ["101671","100899",4,"Serum Alis & Bulu Mata","Perawatan & Kecantikan > Perawatan Wajah > Treatment Mata > Serum Alis & Bulu Mata",1],
  ["100900","100664",3,"Treatment Bibir","Perawatan & Kecantikan > Perawatan Wajah > Treatment Bibir",0],
  ["101673","100900",4,"Pelembab Bibir","Perawatan & Kecantikan > Perawatan Wajah > Treatment Bibir > Pelembab Bibir",1],
  ["101674","100900",4,"Scrub & Exfoliator Bibir","Perawatan & Kecantikan > Perawatan Wajah > Treatment Bibir > Scrub & Exfoliator Bibir",1],
  ["101675","100900",4,"Masker Bibir","Perawatan & Kecantikan > Perawatan Wajah > Treatment Bibir > Masker Bibir",1],
  ["100901","100664",3,"Sunscreen Wajah","Perawatan & Kecantikan > Perawatan Wajah > Sunscreen Wajah",1],
  ["100902","100664",3,"Perawatan Wajah After Sun","Perawatan & Kecantikan > Perawatan Wajah > Perawatan Wajah After Sun",1],
  ["100903","100664",3,"Kertas Minyak","Perawatan & Kecantikan > Perawatan Wajah > Kertas Minyak",1],
  ["100904","100664",3,"Treatment Jerawat","Perawatan & Kecantikan > Perawatan Wajah > Treatment Jerawat",1],
  ["100665","100630",2,"Paket & Set Kecantikan","Perawatan & Kecantikan > Paket & Set Kecantikan",1],
  ["102002","100630",2,"Perawatan Tubuh","Perawatan & Kecantikan > Perawatan Tubuh",0],
  ["102003","102002",3,"Sabun Mandi","Perawatan & Kecantikan > Perawatan Tubuh > Sabun Mandi",1],
  ["102004","102002",3,"Scrub & Peel Tubuh","Perawatan & Kecantikan > Perawatan Tubuh > Scrub & Peel Tubuh",1],
  ["102005","102002",3,"Masker Tubuh","Perawatan & Kecantikan > Perawatan Tubuh > Masker Tubuh",1],
  ["102006","102002",3,"Minyak Tubuh","Perawatan & Kecantikan > Perawatan Tubuh > Minyak Tubuh",1],
  ["102007","102002",3,"Body Cream, Body Lotion & Body Butter","Perawatan & Kecantikan > Perawatan Tubuh > Body Cream, Body Lotion & Body Butter",1],
  ["102008","102002",3,"Deodoran","Perawatan & Kecantikan > Perawatan Tubuh > Deodoran",1],
  ["102009","102002",3,"Minyak Pijat","Perawatan & Kecantikan > Perawatan Tubuh > Minyak Pijat",1],
  ["102010","102002",3,"Cream & Wax Penghilang Bulu Rambut","Perawatan & Kecantikan > Perawatan Tubuh > Cream & Wax Penghilang Bulu Rambut",1],
  ["102011","102002",3,"Sun Care","Perawatan & Kecantikan > Perawatan Tubuh > Sun Care",0],
  ["102014","102011",4,"Sunscreen & Aftersun Tubuh","Perawatan & Kecantikan > Perawatan Tubuh > Sun Care > Sunscreen & Aftersun Tubuh",1],
  ["102015","102011",4,"Tanning Oil & Self Tanners","Perawatan & Kecantikan > Perawatan Tubuh > Sun Care > Tanning Oil & Self Tanners",1],
  ["102012","102002",3,"Perawatan Payudara","Perawatan & Kecantikan > Perawatan Tubuh > Perawatan Payudara",1],
];

const SHOPEE_SOURCE = 'SHOPEE';
const SHOPEE_ROOT_ = 'Perawatan & Kecantikan > ';

function catIsLeaf_(c) {
  return c.IsLeaf === true || String(c.IsLeaf).toUpperCase() === 'TRUE';
}
function catIsShopee_(c) {
  return c && c.ExternalSource === SHOPEE_SOURCE;
}
/** Jalur tanpa kategori utama: "Perawatan Wajah > Toner". */
function catShortPath_(c) {
  return String((c && c.FullPath) || '').replace(SHOPEE_ROOT_, '');
}

/**
 * Salin kategori Shopee ke MASTER_CATEGORIES (aman diulang, dipanggil otomatis saat struktur diperbarui).
 *  - Simpul baru → ditambahkan (ID internal baru, ExternalID = ID Shopee).
 *  - Kategori lama dengan nama persis sama dengan SATU kategori akhir Shopee → ditautkan (ID & produknya tetap).
 *  - Kategori lain tidak diubah / dihapus; status (aktif/nonaktif) pilihan user tidak ditimpa.
 */
function syncShopeeCategories_() {
  const T = db_('MASTER_CATEGORIES');
  const ts = now_();
  const byExt = {};
  T.filter((c) => catIsShopee_(c)).forEach((c) => (byExt[c.ExternalID] = c));
  const leafKeys = {};
  SHOPEE_BEAUTY_CATEGORIES.forEach((n) => n[5] && (leafKeys[masterNameKey(n[3])] = (leafKeys[masterNameKey(n[3])] || 0) + 1));
  const out = { created: 0, linked: 0, updated: 0 };
  SHOPEE_BEAUTY_CATEGORIES.forEach(([ext, , level, name, path, leaf]) => {
    const key = masterNameKey(name);
    const fields = { CategoryName: name, NameKey: key, Level: level, FullPath: path, ExternalSource: SHOPEE_SOURCE, ExternalID: ext, IsLeaf: !!leaf };
    let rec = byExt[ext];
    if (rec) {
      if (rec.CategoryName !== name || rec.FullPath !== path || Number(rec.Level) !== level || catIsLeaf_(rec) !== !!leaf) {
        T.update(rec, Object.assign(fields, { UpdatedBy: 'shopee-sync', UpdatedAt: ts }));
        out.updated++;
      }
      return;
    }
    const legacy = leaf && leafKeys[key] === 1 ? T.filter((c) => !c.ExternalSource && c.Status !== STATUS.DELETED && c.NameKey === key) : [];
    if (legacy.length === 1) {
      rec = legacy[0];
      T.update(rec, Object.assign(fields, { UpdatedBy: 'shopee-sync', UpdatedAt: ts }));
      audit_('shopee-sync', 'category.linkShopee', 'category', rec.CategoryID, { name: legacy[0].CategoryName }, { name, shopeeId: ext, path });
      out.linked++;
    } else {
      rec = T.insert(Object.assign({ CategoryID: uuid_(), CategoryCode: '', Status: STATUS.ACTIVE, CreatedBy: 'shopee-sync', CreatedAt: ts, UpdatedBy: 'shopee-sync', UpdatedAt: ts, ParentID: '' }, fields));
      out.created++;
    }
    byExt[ext] = rec;
  });
  // induk diisi setelah semua simpul ada
  SHOPEE_BEAUTY_CATEGORIES.forEach(([ext, parentExt]) => {
    const rec = byExt[ext];
    const pid = parentExt && byExt[parentExt] ? byExt[parentExt].CategoryID : '';
    if (rec && (rec.ParentID || '') !== pid) T.update(rec, { ParentID: pid });
  });
  return out;
}
