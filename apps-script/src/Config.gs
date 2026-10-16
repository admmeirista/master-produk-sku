/**
 * Retail Product Master — versi Google Apps Script + Google Sheets.
 *
 * Setiap tab spreadsheet = satu tabel. Baris 1 = header (jangan diubah manual).
 * Semua sel diformat TEKS ("@") agar barcode/SKU tidak berubah jadi angka / kehilangan nol di depan.
 * Kolom ber-akhiran angka (NUMERIC_COLS) dikonversi ke number saat dibaca; kolom *_json di-parse.
 *
 * PENTING: Web App dijalankan "Execute as: Me". Staf TIDAK perlu (dan sebaiknya TIDAK diberi) akses edit ke
 * spreadsheet — semua perubahan wajib lewat aplikasi agar validasi, approval & audit tidak terlewati.
 */

const APP_NAME = 'Master Produk & SKU';

/**
 * ID file database (Google Sheets terpisah di Drive). Skrip ini proyek Apps Script MANDIRI —
 * tidak menempel di spreadsheet. Ambil ID dari URL: docs.google.com/spreadsheets/d/<ID>/edit
 */
const DB_SPREADSHEET_ID = '11f_luP2oWDJHklnG4BjxWTjXXRA57XuO-un6tuAJbm4'; // file "Master Produk DB" di folder Drive "Master Produk Toko Kosmetik"

const SCHEMA = {
  Settings: ['key', 'value', 'updated_by', 'updated_at'],
  Users: ['id', 'email', 'full_name', 'role', 'is_active', 'pw_salt', 'pw_hash', 'failed_logins', 'locked_until', 'last_login_at', 'created_at', 'updated_at'],
  Sequences: ['name', 'value'],
  Brands: ['id', 'code', 'name', 'name_norm', 'manufacturer', 'notes', 'status', 'proposed_by', 'approved_by', 'approved_at', 'created_at', 'updated_at', 'version'],
  Categories: ['id', 'code', 'name', 'name_norm', 'notes', 'status', 'proposed_by', 'approved_by', 'approved_at', 'created_at', 'updated_at', 'version'],
  Products: ['id', 'product_no', 'brand_id', 'category_id', 'product_code', 'name', 'name_norm', 'token_key', 'product_type', 'description', 'base_unit', 'has_variants', 'status', 'is_legacy', 'version', 'created_by', 'created_at', 'updated_by', 'updated_at', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'activated_at', 'archived_at'],
  Variants: ['id', 'variant_no', 'product_id', 'variant_code', 'name', 'attributes_json', 'signature', 'is_default', 'status', 'sort_order', 'created_by', 'created_at'],
  SKUs: ['id', 'sku_no', 'sku_code', 'product_id', 'variant_id', 'sku_type', 'pack_qty', 'sales_unit', 'display_name', 'status', 'sku_source', 'purchase_price', 'selling_price', 'created_by', 'created_at', 'updated_at'],
  Components: ['id', 'bundle_sku_id', 'component_sku_id', 'quantity'],
  Barcodes: ['code', 'barcode_type', 'symbology', 'status', 'verified_official', 'request_key', 'notes', 'allocated_by', 'allocated_at'],
  BarcodeAssignments: ['id', 'code', 'product_id', 'variant_id', 'sku_id', 'assigned_by', 'assigned_at', 'unassigned_by', 'unassigned_at', 'reason'],
  Prices: ['id', 'sku_id', 'price_type', 'amount', 'effective_from', 'effective_to', 'reason', 'created_by'],
  SkuCodeHistory: ['id', 'sku_id', 'old_code', 'new_code', 'reason', 'request_id', 'changed_by', 'changed_at'],
  Mappings: ['id', 'sku_id', 'system', 'external_sku', 'external_product_id', 'external_variation_id', 'listing_name', 'mapping_status', 'is_active', 'last_exported_at', 'last_confirmed_at', 'last_error', 'notes', 'created_by', 'created_at', 'updated_at'],
  Requests: ['id', 'request_no', 'request_type', 'product_id', 'status', 'reason', 'payload_json', 'before_json', 'submitted_by', 'submitted_at', 'reviewed_by', 'reviewed_at', 'review_reason'],
  ApprovalHistory: ['id', 'request_id', 'entity_type', 'entity_id', 'action', 'from_status', 'to_status', 'actor', 'reason', 'created_at'],
  AuditLog: ['id', 'created_at', 'actor', 'action', 'entity_type', 'entity_id', 'before_json', 'after_json', 'meta_json'],
  ImportBatches: ['id', 'batch_no', 'import_type', 'file_name', 'sheet_name', 'content_hash', 'status', 'total_rows', 'committed_rows', 'error_rows', 'skipped_rows', 'created_by', 'created_at'],
  ImportErrors: ['batch_id', 'row_number', 'severity', 'code', 'message'],
  Dismissals: ['id', 'entity_a', 'entity_b', 'reason', 'dismissed_by', 'created_at'],
};

/** Penjelasan tiap tab (ditulis ke tab "Tentang" di file database). */
const TAB_DESCRIPTION = {
  Settings: 'Pengaturan aplikasi (template SKU, maker-checker, ambang kemiripan nama)',
  Users: 'Akun pengguna aplikasi & role (password tersimpan sebagai hash)',
  Sequences: 'Nomor urut: ID produk, varian, SKU, permintaan, batch import, barcode internal',
  Brands: 'Master brand: nama resmi & kode unik',
  Categories: 'Master kategori: nama resmi & kode unik',
  Products: 'Product master (keluarga produk)',
  Variants: 'Varian fisik (shade, ukuran, aroma, dll.)',
  SKUs: 'Unit penjualan: satuan, multipack, bundle',
  Components: 'Daftar komponen bundle (BOM)',
  Barcodes: 'Registry barcode GTIN produsen & barcode internal',
  BarcodeAssignments: 'Histori pemasangan barcode ke varian/SKU',
  Prices: 'Histori harga beli & jual',
  SkuCodeHistory: 'Histori perubahan kode SKU',
  Mappings: 'Mapping SKU ke BeeCloud & Shopee',
  Requests: 'Registrasi produk & change request',
  ApprovalHistory: 'Riwayat keputusan persetujuan',
  AuditLog: 'Audit trail (nilai sebelum & sesudah)',
  ImportBatches: 'Riwayat import file',
  ImportErrors: 'Laporan error per baris import',
  Dismissals: 'Pasangan nama produk yang ditandai bukan duplikat',
};

const NUMERIC_COLS = { product_no: 1, variant_no: 1, sku_no: 1, pack_qty: 1, quantity: 1, amount: 1, purchase_price: 1, selling_price: 1, version: 1, sort_order: 1, failed_logins: 1, request_no: 1, batch_no: 1, total_rows: 1, committed_rows: 1, error_rows: 1, skipped_rows: 1, row_number: 1, value: 0 };
const BOOL_COLS = { has_variants: 1, is_legacy: 1, is_default: 1, is_active: 1, verified_official: 1 };

const ROLES = ['admin', 'data_entry', 'reviewer', 'viewer'];
const ROLE_LABEL = { admin: 'Admin', data_entry: 'Data Entry', reviewer: 'Reviewer', viewer: 'Viewer' };
const ALL_PERMS = ['product.read', 'product.write', 'product.submit', 'product.review', 'product.lifecycle', 'reference.read', 'reference.propose', 'reference.manage', 'barcode.allocate', 'price.write', 'mapping.write', 'import.run', 'export.run', 'audit.read', 'user.manage', 'settings.manage'];
const ROLE_PERMISSIONS = {
  admin: ALL_PERMS,
  data_entry: ['product.read', 'product.write', 'product.submit', 'reference.read', 'reference.propose', 'barcode.allocate', 'price.write', 'mapping.write', 'import.run', 'export.run'],
  reviewer: ['product.read', 'product.review', 'product.lifecycle', 'reference.read', 'reference.manage', 'mapping.write', 'export.run', 'audit.read'],
  viewer: ['product.read', 'reference.read', 'export.run'],
};

const DEFAULT_SETTINGS = {
  sku_template: '{BRAND}-{CATEGORY}-{PRODUCT}{VARIANT}-{BARCODE}-{QTY}',
  maker_checker: true,
  auto_activate_on_approve: false,
  fuzzy_threshold: 0.82,
  internal_barcode_prefix: '200',
};

const STATUS_LABEL = { draft: 'Draft', pending_review: 'Menunggu Review', approved: 'Disetujui', active: 'Aktif', rejected: 'Ditolak', inactive: 'Nonaktif', archived: 'Diarsipkan' };
const TRANSITIONS = {
  draft: { submit: 'pending_review', archive: 'archived' },
  pending_review: { approve: 'approved', reject: 'rejected' },
  approved: { activate: 'active', reject: 'rejected' },
  active: { deactivate: 'inactive' },
  rejected: { revise: 'draft', archive: 'archived' },
  inactive: { reactivate: 'active', archive: 'archived' },
  archived: {},
};
const ACTION_PERM = { submit: 'product.submit', revise: 'product.write', approve: 'product.review', reject: 'product.review', activate: 'product.review', deactivate: 'product.lifecycle', reactivate: 'product.lifecycle', archive: 'product.lifecycle' };
const REASON_REQUIRED = ['reject', 'deactivate', 'archive', 'reactivate'];
const SALES_UNITS = ['PCS', 'PACK', 'BOX', 'SET', 'LUSIN'];
const ATTRIBUTE_TYPES = { shade: 'Shade', color: 'Warna', size: 'Ukuran', volume: 'Volume / Isi', scent: 'Aroma', formula: 'Formulasi', type: 'Tipe', other: 'Lainnya' };

/**
 * KOLOM EKSPOR BEECLOUD — BELUM DIVERIFIKASI terhadap template import resmi BeeCloud.
 * Cocokkan dengan template dari menu Import Produk BeeCloud, lalu ubah HANYA di sini.
 */
const BEECLOUD_EXPORT_COLUMNS = [
  ['SKU', 'sku_code'], ['Nama Produk', 'display_name'], ['Satuan', 'sales_unit'], ['Isi', 'pack_qty'], ['Barcode', 'barcode'],
  ['Brand', 'brand_name'], ['Kategori', 'category_name'], ['Harga Beli', 'purchase_price'], ['Harga Jual', 'selling_price'], ['Stok Awal', 'opening_stock'],
];
