/**
 * Retail Product Master — Google Apps Script + Google Sheets.
 *
 * Hierarki data:
 *   Brand + Kategori → Product Master → Product Variant (SKU + GTIN/barcode) → Satuan Kemasan & Konversi
 *
 * Setiap tab spreadsheet = satu tabel. Baris 1 = header (jangan diubah manual).
 * Semua sel berformat TEKS ("@") agar barcode/SKU tidak berubah jadi angka / kehilangan nol di depan.
 * Relasi antar-tab memakai ID stabil (UUID), tidak pernah nomor baris.
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
  Sequences: ['name', 'value'],
  AuditLog: ['id', 'created_at', 'actor', 'action', 'entity_type', 'entity_id', 'before_json', 'after_json', 'meta_json'],
  TX_JOURNAL: ['TxID', 'Part', 'Status', 'CreatedAt', 'Plan'],
  // ---- master
  MASTER_BRANDS: ['BrandID', 'BrandCode', 'BrandName', 'NameKey', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  MASTER_CATEGORIES: ['CategoryID', 'CategoryCode', 'CategoryName', 'NameKey', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  MASTER_PRODUCTS: ['ProductID', 'ProductNo', 'BrandID', 'CategoryID', 'ProductName', 'NameKey', 'ProductCode', 'BaseUnit', 'HasVariants', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'Version'],
  PRODUCT_VARIANTS: ['VariantID', 'ProductID', 'VariantCode', 'VariantName', 'VariantAttributes', 'AttributeKey', 'SKU', 'GTIN', 'InternalBarcode', 'IsDefault', 'Status', 'SortOrder', 'CreatedBy', 'CreatedAt', 'UpdatedAt'],
  UNIT_CONVERSIONS: ['ConversionID', 'VariantID', 'ProductID', 'UnitName', 'ConversionFactor', 'ContainsUnit', 'BaseUnitEquivalent', 'IsBaseUnit', 'IsTradeItem', 'SKU', 'GTIN', 'InternalBarcode', 'Status', 'SortOrder', 'CreatedAt', 'UpdatedAt'],
  // ---- identitas & integrasi
  BARCODE_REGISTRY: ['Code', 'BarcodeType', 'Symbology', 'Status', 'VerifiedOfficial', 'RequestKey', 'Notes', 'AllocatedBy', 'AllocatedAt'],
  BARCODE_ASSIGNMENTS: ['AssignmentID', 'Code', 'ProductID', 'VariantID', 'ConversionID', 'AssignedBy', 'AssignedAt', 'UnassignedBy', 'UnassignedAt', 'Reason'],
  SKU_MAPPINGS: ['MappingID', 'SKU', 'System', 'ExternalSku', 'ExternalProductId', 'ExternalVariationId', 'ListingName', 'MappingStatus', 'IsActive', 'LastExportedAt', 'LastConfirmedAt', 'LastError', 'Notes', 'CreatedBy', 'CreatedAt', 'UpdatedAt'],
};

/** Penjelasan tiap tab (ditulis ke tab "Tentang" di file database). */
const TAB_DESCRIPTION = {
  Settings: 'Pengaturan aplikasi (template SKU, daftar satuan, jenis atribut)',
  Users: 'Akun pengguna aplikasi & role (password tersimpan sebagai hash)',
  Sequences: 'Nomor urut: nomor produk, barcode internal',
  AuditLog: 'Audit trail perubahan data penting (nilai sebelum & sesudah)',
  TX_JOURNAL: 'Jurnal transaksi penyimpanan (untuk rollback otomatis bila penyimpanan terputus)',
  MASTER_BRANDS: 'Master brand: nama & kode otomatis (permanen)',
  MASTER_CATEGORIES: 'Master kategori: nama & kode otomatis (permanen)',
  MASTER_PRODUCTS: 'Product master (keluarga produk) + satuan dasar',
  PRODUCT_VARIANTS: 'Varian fisik: atribut, SKU, GTIN / barcode internal',
  UNIT_CONVERSIONS: 'Satuan kemasan & faktor konversi per varian (opsional SKU/GTIN kemasan)',
  BARCODE_REGISTRY: 'Registry barcode GTIN produsen & barcode internal',
  BARCODE_ASSIGNMENTS: 'Histori pemasangan barcode ke varian / kemasan',
  SKU_MAPPINGS: 'Mapping SKU ke BeeCloud & Shopee',
};

/** Tab versi lama (sebelum revisi). Tidak dihapus; datanya dimigrasikan oleh setup(). */
const LEGACY_TABS = ['Brands', 'Categories', 'Products', 'Variants', 'SKUs', 'Components', 'Barcodes', 'BarcodeAssignments', 'Prices', 'SkuCodeHistory', 'Mappings', 'Requests', 'ApprovalHistory', 'ImportBatches', 'ImportErrors', 'Dismissals'];

const NUMBER_COLS = { ProductNo: 1, ConversionFactor: 1, BaseUnitEquivalent: 1, SortOrder: 1, Version: 1, Part: 1, failed_logins: 1 };
const BOOL_COLS = { HasVariants: 1, IsDefault: 1, IsBaseUnit: 1, IsTradeItem: 1, VerifiedOfficial: 1, IsActive: 1, is_active: 1 };
const JSON_COLS = { VariantAttributes: 1, before_json: 1, after_json: 1, meta_json: 1 };

const ROLES = ['admin', 'data_entry', 'viewer'];
const ROLE_LABEL = { admin: 'Admin', data_entry: 'Admin Data', viewer: 'Viewer' };
const ALL_PERMS = ['product.read', 'product.write', 'master.write', 'barcode.allocate', 'mapping.write', 'export.run', 'audit.read', 'user.manage', 'settings.manage'];
const ROLE_PERMISSIONS = {
  admin: ALL_PERMS,
  data_entry: ['product.read', 'product.write', 'master.write', 'barcode.allocate', 'mapping.write', 'export.run', 'audit.read'],
  viewer: ['product.read', 'export.run'],
};
// role versi lama (workflow approval sudah dihapus) diperlakukan sebagai Admin Data
ROLE_PERMISSIONS.reviewer = ROLE_PERMISSIONS.data_entry;

const DEFAULT_SETTINGS = {
  sku_template: '{BRAND}-{CATEGORY}-{PRODUCT}-{VARIANT}',
  master_code_length: 3,
  fuzzy_threshold: 0.82,
  internal_barcode_prefix: '200',
  base_units: ['PCS', 'BOTOL', 'TUBE', 'SACHET', 'JAR', 'PACK', 'POT', 'STICK'],
  pack_units: ['BOX', 'KARTON', 'PACK', 'LUSIN', 'INNER', 'DUS', 'BAL', 'SET'],
  attribute_types: ['Warna', 'Shade', 'Aroma', 'Ukuran', 'Volume', 'Isi', 'Jenis', 'Tipe'],
};
/** Template SKU versi lama — diganti otomatis oleh setup() (SKU yang sudah tersimpan tidak berubah). */
const LEGACY_SKU_TEMPLATE = '{BRAND}-{CATEGORY}-{PRODUCT}{VARIANT}-{BARCODE}-{QTY}';

const STATUS = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' };
const STATUS_LABEL = { ACTIVE: 'Aktif', INACTIVE: 'Nonaktif' };

/**
 * KOLOM EKSPOR BEECLOUD — BELUM DIVERIFIKASI terhadap template import resmi BeeCloud.
 * Cocokkan dengan template dari menu Import Produk BeeCloud, lalu ubah HANYA di sini.
 */
const BEECLOUD_EXPORT_COLUMNS = [
  ['SKU', 'sku'], ['Nama Produk', 'display_name'], ['Satuan', 'unit'], ['Isi', 'base_qty'], ['Barcode', 'barcode'],
  ['Brand', 'brand_name'], ['Kategori', 'category_name'],
];
