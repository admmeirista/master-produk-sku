const test=require('node:test'),assert=require('node:assert/strict'),{createGas}=require('./harness.cjs');

test('alokasi MP dan BD enam digit berbagi urutan semua jalur dan melewati nomor lama/arsip walaupun counter tertinggal',()=>{
 const {ctx:c}=createGas();c.setup();
 c.withLock_(()=>{
   c.db_('BUNDLE_MASTERS').insert({BundleID:'legacy',BundleSKU:'MP0002',BundleType:'MULTIPACK',Status:'ARCHIVED'});
   c.db_('BUNDLE_MASTERS').insert({BundleID:'bd',BundleSKU:'BD000017',BundleType:'MIXED',Status:'ACTIVE'});
   c.setSeq_('multipack_no',1);c.setSeq_('bundle_no',1);
   assert.equal(c.bundleAllocateSku_('MULTIPACK'),'MP000003');
   assert.equal(c.bundleAllocateSku_('MULTIPACK'),'MP000004');
   assert.equal(c.bundleAllocateSku_('MIXED'),'BD000018');
   assert.equal(c.bundleAllocateSku_('MIXED'),'BD000019');
 });
});

test('alokasi tidak menghasilkan digit ketujuh atau menerima jenis paket tidak dikenal',()=>{
 const {ctx:c}=createGas();c.setup();c.withLock_(()=>{c.setSeq_('multipack_no',1000000);assert.throws(()=>c.bundleAllocateSku_('MULTIPACK'),/enam digit/);assert.throws(()=>c.bundleAllocateSku_('asal'),/tidak valid/);});
});
