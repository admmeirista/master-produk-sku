/**
 * Smart Product Master — Google Apps Script + Google Sheets (v3).
 *
 * Hierarki data:
 *   Brand + Kategori → Product Master → Product Variant (SKU internal) → Variant Barcode (GTIN / internal)
 *                                                     └→ Packaging & Unit Conversion (per varian, opsional)
 *
 * Setiap tab spreadsheet = satu tabel. Baris 1 = header (jangan diubah manual).
 * Semua sel berformat TEKS ("@") agar barcode/SKU tidak berubah jadi angka / kehilangan nol di depan.
 * Relasi antar-tab memakai ID stabil (UUID), tidak pernah nomor baris / nama.
 *
 * Web App dijalankan "Execute as: Me". Staf TIDAK perlu (dan sebaiknya TIDAK diberi) akses edit ke
 * spreadsheet — semua perubahan wajib lewat aplikasi agar validasi & audit tidak terlewati.
 */

const APP_NAME = 'Master Produk & SKU';

/**
 * ID file database (Google Sheets terpisah di Drive). Ambil dari URL: docs.google.com/spreadsheets/d/<ID>/edit
 */
const DB_SPREADSHEET_ID = '11f_luP2oWDJHklnG4BjxWTjXXRA57XuO-un6tuAJbm4'; // file "Master Produk DB" di folder Drive "Master Produk Toko Kosmetik"

const SCHEMA = {
  // ---- sistem
  Settings: ['key', 'value', 'updated_by', 'updated_at'],
  Users: ['id', 'email', 'full_name', 'role', 'is_active', 'pw_salt', 'pw_hash', 'failed_logins', 'locked_until', 'last_login_at', 'created_at', 'updated_at'],
  SYSTEM_COUNTERS: ['CounterName', 'Value', 'UpdatedAt'],
  AUDIT_LOGS: ['LogID', 'CreatedAt', 'Actor', 'Action', 'EntityType', 'EntityID', 'BeforeJson', 'AfterJson', 'MetaJson'],
  TX_JOURNAL: ['TxID', 'Part', 'Status', 'CreatedAt', 'Plan'],
  IMPORT_BATCHES: ['BatchID', 'ImportType', 'FileName', 'ContentHash', 'Status', 'TotalRows', 'CreatedRows', 'SkippedRows', 'ErrorRows', 'ReportJson', 'CreatedBy', 'CreatedAt'],
  // ---- master
  MASTER_BRANDS: ['BrandID', 'BrandCode', 'BrandName', 'NameKey', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  MASTER_CATEGORIES: ['CategoryID', 'CategoryCode', 'CategoryName', 'NameKey', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  MASTER_PRODUCTS: ['ProductID', 'ProductNo', 'BrandID', 'CategoryID', 'ProductName', 'NameKey', 'ProductCode', 'BaseUnit', 'HasVariants', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'Version', 'LegacyCode'],
  PRODUCT_VARIANTS: ['VariantID', 'ProductID', 'VariantCode', 'VariantName', 'VariantAttributes', 'AttributeKey', 'SKU', 'GTIN', 'InternalBarcode', 'IsDefault', 'Status', 'SortOrder', 'CreatedBy', 'CreatedAt', 'UpdatedAt'],
  VARIANT_ATTRIBUTES: ['VariantAttributeID', 'VariantID', 'ProductID', 'AttributeName', 'AttributeValue', 'SortOrder'],
  VARIANT_BARCODES: ['BarcodeID', 'Code', 'BarcodeType', 'Symbology', 'Status', 'ProductID', 'VariantID', 'ConversionID', 'VerifiedOfficial', 'RequestKey', 'Notes', 'CreatedBy', 'CreatedAt', 'RetiredBy', 'RetiredAt', 'Reason'],
  UNIT_CONVERSIONS: ['ConversionID', 'VariantID', 'ProductID', 'UnitName', 'ConversionFactor', 'ContainsUnit', 'BaseUnitEquivalent', 'IsBaseUnit', 'IsTradeItem', 'SKU', 'GTIN', 'InternalBarcode', 'Status', 'SortOrder', 'CreatedAt', 'UpdatedAt'],
  EXTERNAL_SKU_MAPPINGS: ['MappingID', 'System', 'ExternalSku', 'ProductID', 'VariantID', 'ConversionID', 'InternalSku', 'ExternalProductId', 'ExternalVariationId', 'ListingName', 'MappingStatus', 'IsActive', 'LastExportedAt', 'LastConfirmedAt', 'LastError', 'Notes', 'CreatedBy', 'CreatedAt', 'UpdatedAt'],
};

/** Penjelasan tiap tab (ditulis ke tab "Tentang" di file database). */
const TAB_DESCRIPTION = {
  Settings: 'Pengaturan aplikasi (daftar satuan, jenis atribut, ambang kemiripan nama)',
  Users: 'Akun pengguna aplikasi & role (password tersimpan sebagai hash)',
  SYSTEM_COUNTERS: 'Penghitung kode otomatis: nomor produk (PRD), SKU internal (SKU), barcode internal',
  AUDIT_LOGS: 'Audit trail perubahan data penting (nilai sebelum & sesudah)',
  TX_JOURNAL: 'Jurnal transaksi penyimpanan (rollback otomatis bila penyimpanan multi-sheet terputus)',
  IMPORT_BATCHES: 'Riwayat import data lama dari Excel + laporannya',
  MASTER_BRANDS: 'Master brand: nama & kode otomatis (permanen)',
  MASTER_CATEGORIES: 'Master kategori: nama & kode otomatis (permanen)',
  MASTER_PRODUCTS: 'Product master (keluarga produk): kode PRD otomatis, satuan dasar, kode lama (LegacyCode)',
  PRODUCT_VARIANTS: 'Varian fisik: SKU internal, GTIN / barcode internal aktif. VariantAttributes = salinan ringkas dari VARIANT_ATTRIBUTES',
  VARIANT_ATTRIBUTES: 'Atribut varian (Aroma, Volume, Shade, …) — satu baris per atribut',
  VARIANT_BARCODES: 'Barcode per varian / kemasan: GTIN produsen & barcode internal, termasuk histori yang dipensiunkan',
  UNIT_CONVERSIONS: 'Satuan kemasan & faktor konversi per varian (opsional SKU/GTIN kemasan trade item)',
  EXTERNAL_SKU_MAPPINGS: 'SKU lama (legacy) & SKU di BeeCloud / Shopee yang dipetakan ke varian / kemasan',
};

/** Tab versi lama (v1 & v2). Tidak dihapus; datanya dimigrasikan oleh setup(). */
const LEGACY_TABS = ['Brands', 'Categories', 'Products', 'Variants', 'SKUs', 'Components', 'Barcodes', 'BarcodeAssignments', 'Prices', 'SkuCodeHistory', 'Mappings', 'Requests', 'ApprovalHistory', 'AuditLog', 'ImportBatches', 'ImportErrors', 'Dismissals', 'Sequences', 'BARCODE_REGISTRY', 'BARCODE_ASSIGNMENTS', 'SKU_MAPPINGS'];

const NUMBER_COLS = { ProductNo: 1, ConversionFactor: 1, BaseUnitEquivalent: 1, SortOrder: 1, Version: 1, Part: 1, failed_logins: 1, TotalRows: 1, CreatedRows: 1, SkippedRows: 1, ErrorRows: 1 };
const BOOL_COLS = { HasVariants: 1, IsDefault: 1, IsBaseUnit: 1, IsTradeItem: 1, VerifiedOfficial: 1, IsActive: 1, is_active: 1 };
const JSON_COLS = { VariantAttributes: 1, BeforeJson: 1, AfterJson: 1, MetaJson: 1, ReportJson: 1 };

const ROLES = ['admin', 'data_entry', 'viewer'];
const ROLE_LABEL = { admin: 'Admin', data_entry: 'Admin Data', viewer: 'Viewer' };
const ALL_PERMS = ['product.read', 'product.write', 'master.write', 'barcode.allocate', 'mapping.write', 'export.run', 'audit.read', 'import.run', 'user.manage', 'settings.manage'];
const ROLE_PERMISSIONS = {
  admin: ALL_PERMS,
  data_entry: ['product.read', 'product.write', 'master.write', 'barcode.allocate', 'mapping.write', 'export.run', 'audit.read'],
  viewer: ['product.read', 'export.run'],
};
// role versi lama (workflow approval sudah dihapus) diperlakukan sebagai Admin Data
ROLE_PERMISSIONS.reviewer = ROLE_PERMISSIONS.data_entry;

const DEFAULT_SETTINGS = {
  master_code_length: 3,
  fuzzy_threshold: 0.82,
  internal_barcode_prefix: '200',
  base_units: ['PCS', 'BOTOL', 'TUBE', 'SACHET', 'JAR', 'PACK', 'POT', 'STICK'],
  pack_units: ['BOX', 'KARTON', 'PACK', 'LUSIN', 'INNER', 'DUS', 'BAL', 'SET'],
  attribute_types: ['Warna', 'Shade', 'Aroma', 'Ukuran', 'Volume', 'Isi', 'Jenis', 'Tipe'],
};

/**
 * Identifier otomatis — permanen, unik, tidak bergantung pada brand/kategori/GTIN yang bisa dikoreksi.
 *   Product Code: PRD000123      SKU internal (varian & kemasan trade item): SKU000456
 * Dialokasikan dari SYSTEM_COUNTERS di dalam script lock (aman untuk permintaan bersamaan).
 */
const PRODUCT_CODE_PREFIX = 'PRD';
const SKU_PREFIX = 'SKU';
const CODE_DIGITS = 6;
const MAX_COMBINATIONS = 100; // kombinasi varian yang dibentuk sekaligus
const MAX_VARIANTS = 300; // varian per produk

const STATUS = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', DELETED: 'DELETED' };
const STATUS_LABEL = { ACTIVE: 'Aktif', INACTIVE: 'Nonaktif', DELETED: 'Dihapus' };

/**
 * KOLOM EKSPOR BEECLOUD — BELUM DIVERIFIKASI terhadap template import resmi BeeCloud.
 * Cocokkan dengan template dari menu Import Produk BeeCloud, lalu ubah HANYA di sini.
 */
const BEECLOUD_EXPORT_COLUMNS = [
  ['SKU', 'sku'], ['Nama Produk', 'display_name'], ['Satuan', 'unit'], ['Isi', 'base_qty'], ['Barcode', 'barcode'],
  ['Brand', 'brand_name'], ['Kategori', 'category_name'],
];
