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

/**
 * Skema tab. Kolom baru selalu DITAMBAHKAN DI UJUNG KANAN agar tab yang sudah berisi data tetap kompatibel
 * (setup() menolak menimpa header yang berbeda). Nama tab konseptual pada dokumen arsitektur:
 *   PRODUCT_PARENTS = MASTER_PRODUCTS · PRODUCT_ATTRIBUTES = VARIANT_ATTRIBUTES (+ ATTRIBUTE_VALUES)
 *   PRODUCT_BARCODES = VARIANT_BARCODES · PACKAGING_UNITS / PACKAGING_IDENTITIES = UNIT_CONVERSIONS (+ VARIANT_BARCODES)
 *   CHANNEL_SKU_MAPPING = EXTERNAL_SKU_MAPPINGS (juga menyimpan Legacy SKU, System = "legacy")
 */
const SCHEMA = {
  // ---- sistem
  Settings: ['key', 'value', 'updated_by', 'updated_at'],
  Users: ['id', 'email', 'full_name', 'role', 'is_active', 'pw_salt', 'pw_hash', 'failed_logins', 'locked_until', 'last_login_at', 'created_at', 'updated_at'],
  SYSTEM_COUNTERS: ['CounterName', 'Value', 'UpdatedAt'],
  AUDIT_LOGS: ['LogID', 'CreatedAt', 'Actor', 'Action', 'EntityType', 'EntityID', 'BeforeJson', 'AfterJson', 'MetaJson'],
  TX_JOURNAL: ['TxID', 'Part', 'Status', 'CreatedAt', 'Plan'],
  IMPORT_BATCHES: ['BatchID', 'ImportType', 'FileName', 'ContentHash', 'Status', 'TotalRows', 'CreatedRows', 'SkippedRows', 'ErrorRows', 'ReportJson', 'CreatedBy', 'CreatedAt'],
  IMPORT_ERRORS: ['ErrorID', 'BatchID', 'RowNumber', 'Severity', 'Message', 'CreatedAt'],
  GTIN_LOOKUP_CACHE: ['GTIN', 'Provider', 'Status', 'FetchedAt', 'ExpiresAt', 'ResultJson', 'Message'],
  // ---- master
  MASTER_BRANDS: ['BrandID', 'BrandCode', 'BrandName', 'NameKey', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  MASTER_CATEGORIES: ['CategoryID', 'CategoryCode', 'CategoryName', 'NameKey', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  MASTER_PRODUCTS: ['ProductID', 'ProductNo', 'BrandID', 'CategoryID', 'ProductName', 'NameKey', 'ProductCode', 'BaseUnit', 'HasVariants', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'Version', 'LegacyCode', 'Description', 'ImageUrl', 'DataSource'],
  PRODUCT_VARIANTS: ['VariantID', 'ProductID', 'VariantCode', 'VariantName', 'VariantAttributes', 'AttributeKey', 'SKU', 'GTIN', 'InternalBarcode', 'IsDefault', 'Status', 'SortOrder', 'CreatedBy', 'CreatedAt', 'UpdatedAt', 'Stockable', 'BatchTracking', 'ExpiryTracking', 'ShelfLifeMonths', 'PurchaseUnit', 'SalesUnit', 'ReplacedByVariantID'],
  VARIANT_ATTRIBUTES: ['VariantAttributeID', 'VariantID', 'ProductID', 'AttributeName', 'AttributeValue', 'SortOrder'],
  ATTRIBUTE_VALUES: ['AttributeValueID', 'AttributeName', 'Value', 'ValueKey', 'Status', 'CreatedBy', 'CreatedAt'],
  VARIANT_BARCODES: ['BarcodeID', 'Code', 'BarcodeType', 'Symbology', 'Status', 'ProductID', 'VariantID', 'ConversionID', 'VerifiedOfficial', 'RequestKey', 'Notes', 'CreatedBy', 'CreatedAt', 'RetiredBy', 'RetiredAt', 'Reason', 'BundleID'],
  UNIT_CONVERSIONS: ['ConversionID', 'VariantID', 'ProductID', 'UnitName', 'ConversionFactor', 'ContainsUnit', 'BaseUnitEquivalent', 'IsBaseUnit', 'IsTradeItem', 'SKU', 'GTIN', 'InternalBarcode', 'Status', 'SortOrder', 'CreatedAt', 'UpdatedAt', 'EffectiveFrom'],
  PACKAGING_HISTORY: ['HistoryID', 'ConversionID', 'VariantID', 'ProductID', 'UnitName', 'OldFactor', 'NewFactor', 'OldContainsUnit', 'NewContainsUnit', 'OldEquivalent', 'NewEquivalent', 'EffectiveFrom', 'ChangedBy', 'Reason'],
  BUNDLE_MASTERS: ['BundleID', 'BundleSKU', 'BundleType', 'BundleName', 'NameKey', 'StockMode', 'Stockable', 'PickQuantity', 'Status', 'Description', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'Version'],
  BUNDLE_COMPONENTS: ['ComponentID', 'BundleID', 'VariantID', 'Quantity', 'Selectable', 'Status', 'SortOrder', 'CreatedAt'],
  MASTER_SUPPLIERS: ['SupplierID', 'SupplierCode', 'SupplierName', 'NameKey', 'ContactName', 'Phone', 'Email', 'Notes', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  SUPPLIER_PRODUCT_MAPPING: ['SupplierMapID', 'SupplierID', 'SupplierProductCode', 'SupplierCodeKey', 'SupplierProductName', 'VariantID', 'ProductID', 'PurchaseUnit', 'ConversionFactor', 'MinimumOrderQuantity', 'SpecMismatch', 'SpecNote', 'Status', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  EXTERNAL_SKU_MAPPINGS: ['MappingID', 'System', 'ExternalSku', 'ProductID', 'VariantID', 'ConversionID', 'InternalSku', 'ExternalProductId', 'ExternalVariationId', 'ListingName', 'MappingStatus', 'IsActive', 'LastExportedAt', 'LastConfirmedAt', 'LastError', 'Notes', 'CreatedBy', 'CreatedAt', 'UpdatedAt', 'StoreAccount', 'ExternalParentSku', 'BundleID'],
  PRODUCT_LIFECYCLE_HISTORY: ['HistoryID', 'EntityType', 'EntityID', 'ProductID', 'FromStatus', 'ToStatus', 'Reason', 'ChangedBy', 'ChangedAt'],
};

/** Penjelasan tiap tab (ditulis ke tab "Tentang" di file database). */
const TAB_DESCRIPTION = {
  Settings: 'Pengaturan aplikasi (daftar satuan, jenis atribut, ambang kemiripan nama)',
  Users: 'Akun pengguna aplikasi & role (password tersimpan sebagai hash)',
  SYSTEM_COUNTERS: 'Penghitung kode otomatis: Parent SKU (PRD), Child SKU (SKU), multipack (MP), bundle (BDL), supplier (SUP), barcode internal',
  AUDIT_LOGS: 'Audit trail perubahan data penting (nilai sebelum & sesudah)',
  TX_JOURNAL: 'Jurnal transaksi penyimpanan (rollback otomatis bila penyimpanan multi-sheet terputus)',
  IMPORT_BATCHES: 'Riwayat import (migrasi Excel, supplier, channel) + ringkasan laporan',
  IMPORT_ERRORS: 'Baris import yang ditolak / perlu dicek manual',
  GTIN_LOOKUP_CACHE: 'Cache hasil pencarian GTIN ke penyedia eksternal (Open Beauty Facts) — sumber, waktu, status',
  MASTER_BRANDS: 'Master brand: nama & kode otomatis (permanen)',
  MASTER_CATEGORIES: 'Master kategori: nama & kode otomatis (permanen), dipakai lintas brand',
  MASTER_PRODUCTS: 'PRODUCT PARENT (non-stockable): Parent SKU PRD otomatis, brand, kategori, satuan dasar, kode lama',
  PRODUCT_VARIANTS: 'CHILD SKU (barang fisik, stockable): SKU internal, GTIN/barcode aktif, satuan stok/beli/jual, konfigurasi batch & expiry',
  VARIANT_ATTRIBUTES: 'Atribut varian (Aroma, Volume, Shade, …) — satu baris per atribut',
  ATTRIBUTE_VALUES: 'Master nilai atribut terstandar (opsional) untuk generator varian',
  VARIANT_BARCODES: 'PRODUCT BARCODES: GTIN produsen & barcode internal per Child SKU / kemasan / bundle, termasuk histori',
  UNIT_CONVERSIONS: 'PACKAGING UNITS: satuan kemasan & faktor konversi per Child SKU (opsional identitas kemasan trade item)',
  PACKAGING_HISTORY: 'Histori perubahan faktor konversi kemasan (tanggal efektif)',
  BUNDLE_MASTERS: 'Multipack & mixed bundle (virtual / dirakit), Bundle SKU',
  BUNDLE_COMPONENTS: 'Bill of Materials bundle: komponen Child SKU & jumlah',
  MASTER_SUPPLIERS: 'Master supplier',
  SUPPLIER_PRODUCT_MAPPING: 'Kode produk supplier → Child SKU internal (satuan beli, faktor konversi, MOQ)',
  EXTERNAL_SKU_MAPPINGS: 'CHANNEL SKU MAPPING & LEGACY SKU: Shopee, TikTok Shop, Tokopedia, BeeCloud, SKU lama',
  PRODUCT_LIFECYCLE_HISTORY: 'Histori perubahan status lifecycle Parent / Child SKU / bundle',
};

/** Tab versi lama (v1 & v2). Tidak dihapus; datanya dimigrasikan oleh setup(). */
const LEGACY_TABS = ['Brands', 'Categories', 'Products', 'Variants', 'SKUs', 'Components', 'Barcodes', 'BarcodeAssignments', 'Prices', 'SkuCodeHistory', 'Mappings', 'Requests', 'ApprovalHistory', 'AuditLog', 'ImportBatches', 'ImportErrors', 'Dismissals', 'Sequences', 'BARCODE_REGISTRY', 'BARCODE_ASSIGNMENTS', 'SKU_MAPPINGS'];

const NUMBER_COLS = { ProductNo: 1, ConversionFactor: 1, BaseUnitEquivalent: 1, SortOrder: 1, Version: 1, Part: 1, failed_logins: 1, TotalRows: 1, CreatedRows: 1, SkippedRows: 1, ErrorRows: 1, ShelfLifeMonths: 1, OldFactor: 1, NewFactor: 1, OldEquivalent: 1, NewEquivalent: 1, Quantity: 1, PickQuantity: 1, MinimumOrderQuantity: 1, RowNumber: 1 };
const BOOL_COLS = { HasVariants: 1, IsDefault: 1, IsBaseUnit: 1, IsTradeItem: 1, VerifiedOfficial: 1, IsActive: 1, is_active: 1, BatchTracking: 1, ExpiryTracking: 1, Selectable: 1, SpecMismatch: 1 };
const JSON_COLS = { VariantAttributes: 1, BeforeJson: 1, AfterJson: 1, MetaJson: 1, ReportJson: 1, ResultJson: 1 };

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
  attribute_types: ['Warna', 'Shade', 'Aroma', 'Ukuran', 'Volume', 'Berat', 'Isi', 'Jenis', 'Tipe'],
  channels: ['shopee', 'tiktok', 'tokopedia', 'beecloud', 'lainnya'],
  gtin_lookup_enabled: true,
};

/** Penyedia pencarian GTIN eksternal (urutan dicoba). Lihat GtinLookupService.gs. */
const GTIN_PROVIDERS = ['openbeautyfacts'];
const GTIN_LOOKUP_CONTACT = 'MeiristaMasterSKU/4.0 (adm.meirista@gmail.com)';
const CHANNEL_LABEL = { shopee: 'Shopee', tiktok: 'TikTok Shop', tokopedia: 'Tokopedia', beecloud: 'BeeCloud', lainnya: 'Kanal lain', legacy: 'SKU lama' };

/**
 * Identifier otomatis — permanen, unik, tidak bergantung pada brand/kategori/GTIN yang bisa dikoreksi.
 *   Product Code: PRD000123      SKU internal (varian & kemasan trade item): SKU000456
 * Dialokasikan dari SYSTEM_COUNTERS di dalam script lock (aman untuk permintaan bersamaan).
 */
const PRODUCT_CODE_PREFIX = 'PRD';
const SKU_PREFIX = 'SKU';
const CODE_DIGITS = 6;
const MULTIPACK_PREFIX = 'MP';
const BUNDLE_PREFIX = 'BDL';
const SUPPLIER_PREFIX = 'SUP';
const MAX_COMBINATIONS = 100; // kombinasi varian yang dibentuk sekaligus
const MAX_VARIANTS = 300; // varian per produk

const STATUS = { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', DISCONTINUED: 'DISCONTINUED', ARCHIVED: 'ARCHIVED', DELETED: 'DELETED' };
const STATUS_LABEL = { DRAFT: 'Draft', ACTIVE: 'Aktif', INACTIVE: 'Nonaktif', DISCONTINUED: 'Discontinued', ARCHIVED: 'Diarsipkan', DELETED: 'Dihapus' };

/**
 * Lifecycle Parent SKU, Child SKU & bundle — transisi eksplisit.
 *   DRAFT        : tersimpan, belum tersedia untuk sistem downstream
 *   ACTIVE       : dipakai downstream (pembelian, penjualan, stock opname)
 *   INACTIVE     : tidak untuk penggunaan baru (sementara)
 *   DISCONTINUED : tidak untuk pembelian baru; tetap tertelusur untuk histori & sisa stok
 *   ARCHIVED     : referensi historis saja
 * Tidak ada hapus: data yang pernah dipakai tetap tersimpan.
 */
const LIFECYCLE = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['INACTIVE', 'DISCONTINUED'],
  INACTIVE: ['ACTIVE', 'DISCONTINUED', 'ARCHIVED'],
  DISCONTINUED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};
/** Transisi yang wajib disertai alasan. */
const LIFECYCLE_REASON = { INACTIVE: 1, DISCONTINUED: 1, ARCHIVED: 1 };
/** Status yang masih relevan untuk stock opname / sisa stok (diekspor ke sistem inventory). */
const INVENTORY_STATUSES = { ACTIVE: 1, INACTIVE: 1, DISCONTINUED: 1 };

/**
 * KOLOM EKSPOR BEECLOUD — BELUM DIVERIFIKASI terhadap template import resmi BeeCloud.
 * Cocokkan dengan template dari menu Import Produk BeeCloud, lalu ubah HANYA di sini.
 */
const BEECLOUD_EXPORT_COLUMNS = [
  ['SKU', 'sku'], ['Nama Produk', 'display_name'], ['Satuan', 'unit'], ['Isi', 'base_qty'], ['Barcode', 'barcode'],
  ['Brand', 'brand_name'], ['Kategori', 'category_name'],
];
