/**
 * Pekerjaan foto produk: Staf Foto (HP) & Admin — hak akses, daftar kerja, scan, simpan & lanjut, anti salah timpa,
 * minta foto ulang, penugasan, review opsional. File .gs asli dijalankan di emulator (harness.cjs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness.cjs');

const G = createGas();
const call = (tok, a, p) => JSON.parse(JSON.stringify(G.ctx.api(tok, a, JSON.parse(JSON.stringify(p === undefined ? null : p)))));
const ok = (r) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data;
};
const fail = (r, code) => {
  assert.equal(r.ok, false, 'seharusnya gagal');
  if (code) assert.equal(r.error.code, code, r.error.message);
  return r.error;
};
function gtin(body12) {
  let sum = 0;
  for (let i = 11, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body12[i]) * w;
  return body12 + ((10 - (sum % 10)) % 10);
}
const jpeg = (seed) => 'data:image/jpeg;base64,' + Buffer.alloc(4000, seed).toString('base64');
let A, S, S2, P, VIDS;

test('persiapan: produk 3 SKU, Staf Foto', () => {
  const out = JSON.parse(JSON.stringify(G.ctx.setup()));
  A = ok(call(null, 'auth.login', { email: out.admin.email, password: out.admin.password })).token;
  const b = ok(call(A, 'brand.create', { name: 'Hanasui' }));
  const cat = G.ctx.db_('MASTER_CATEGORIES').rows().find((c) => c.CategoryName === 'Serum & Essence Wajah');
  P = ok(call(A, 'product.save', { input: { brandId: b.id, categoryId: cat.CategoryID, name: 'Power Serum', baseUnit: 'PCS', acknowledgeSimilar: true, variants: ['Bright', 'Acne', 'Barrier'].map((t, i) => ({ attributes: [{ name: 'Variant', value: t }, { name: 'Volume', value: '20 ml' }], barcode: { mode: 'gtin', code: gtin('89988245530' + i) } })) } }));
  VIDS = P.variants.map((v) => v.id);
  for (const e of ['foto1@toko.local', 'foto2@toko.local']) ok(call(A, 'user.create', { email: e, fullName: e, role: 'photo_staff', password: 'Password#2026' }));
  S = ok(call(null, 'auth.login', { email: 'foto1', password: 'Password#2026' })).token;
  S2 = ok(call(null, 'auth.login', { email: 'foto2', password: 'Password#2026' })).token;
});

test('Staf Foto: hanya akses pekerjaan foto (backend menolak data master)', () => {
  const me = ok(call(S, 'auth.me', {}));
  assert.deepEqual(me.permissions, ['photo.work']);
  fail(call(S, 'product.list', {}), 'FORBIDDEN');
  fail(call(S, 'product.save', { input: {} }), 'FORBIDDEN');
  fail(call(S, 'brand.create', { name: 'X' }), 'FORBIDDEN');
  fail(call(S, 'photo.assign', { variantIds: VIDS }), 'FORBIDDEN');
  ok(call(S, 'user.changePassword', { oldPassword: 'Password#2026', newPassword: 'Password#2027' }));
  ok(call(S, 'user.changePassword', { oldPassword: 'Password#2027', newPassword: 'Password#2026' }));
});

test('ringkasan & daftar kerja; cari nama / scan GTIN', () => {
  const s = ok(call(S, 'photo.summary', {}));
  assert.deepEqual([s.total, s.todo, s.done, s.retake], [3, 3, 0, 0]);
  const l = ok(call(S, 'photo.list', { filter: 'todo' }));
  assert.equal(l.total, 3);
  assert.equal(l.rows[0].stateLabel, 'Belum difoto');
  assert.equal(ok(call(S, 'photo.list', { filter: 'todo', q: 'acne' })).total, 1);
  const hit = ok(call(S, 'photo.find', { code: gtin('899882455301') }));
  assert.equal(hit.variantId, VIDS[1]);
  assert.equal(ok(call(S, 'photo.find', { code: '8999999999994' })), null, 'barcode tak dikenal → null, tidak membuat produk');
});

test('simpan & lanjut: foto tertaut ke VariantID, riwayat tercatat, SKU berikutnya disarankan', () => {
  fail(call(S, 'photo.save', { variantId: VIDS[0], dataUrl: 'data:image/jpeg;base64,AAAA', expectFileId: '' }));
  const r = ok(call(S, 'photo.save', { variantId: VIDS[0], dataUrl: jpeg(1), expectFileId: '', requestKey: 'k1' }));
  assert.equal(r.state, 'DONE');
  assert.match(r.thumb, /=s240$/);
  const v = G.ctx.db_('PRODUCT_VARIANTS').byId(VIDS[0]);
  assert.equal(v.ImageFileId, r.fileId);
  assert.equal(v.PhotoBy, 'foto1@toko.local');
  // kirim ulang (koneksi putus) dengan requestKey sama → tidak ada file / riwayat ganda
  const again = call(S, 'photo.save', { variantId: VIDS[0], dataUrl: jpeg(1), expectFileId: '', requestKey: 'k1' });
  assert.equal(again.replayed, true);
  assert.equal(G.ctx.db_('PRODUCT_PHOTOS').rows().length, 1);
  assert.equal(G.ctx.DriveApp._files.length, 1);
  const next = ok(call(S, 'photo.next', { after: VIDS[0] }));
  assert.ok(next && next.variantId !== VIDS[0]);
  assert.deepEqual([ok(call(S, 'photo.summary', {})).done, ok(call(S, 'photo.summary', {})).doneToday], [1, 1]);
});

test('anti salah timpa: staf lain sudah mengganti foto → CONFLICT, kecuali "tetap ganti"', () => {
  const cur = ok(call(S2, 'photo.get', { variantId: VIDS[0] }));
  ok(call(S, 'photo.save', { variantId: VIDS[0], dataUrl: jpeg(2), expectFileId: cur.fileId, replace: false }));
  fail(call(S2, 'photo.save', { variantId: VIDS[0], dataUrl: jpeg(3), expectFileId: cur.fileId }), 'CONFLICT');
  ok(call(S2, 'photo.save', { variantId: VIDS[0], dataUrl: jpeg(3), expectFileId: cur.fileId, replace: true }));
  const h = G.ctx.db_('PRODUCT_PHOTOS').rows().filter((x) => x.VariantID === VIDS[0]);
  assert.equal(h.length, 3);
  assert.equal(h.filter((x) => !x.ReplacedAt).length, 1, 'hanya satu foto utama aktif, lainnya tercatat diganti');
});

test('Admin: minta foto ulang (alasan terlihat staf), penugasan, review opsional', () => {
  fail(call(A, 'photo.retake', { variantIds: [VIDS[0]], note: '' }));
  ok(call(A, 'photo.retake', { variantIds: [VIDS[0]], note: 'Blur, tulisan tidak terbaca' }));
  const l = ok(call(S, 'photo.list', { filter: 'todo' }));
  assert.equal(l.rows[0].variantId, VIDS[0], 'perlu foto ulang tampil paling atas');
  assert.equal(l.rows[0].note, 'Blur, tulisan tidak terbaca');
  // penugasan: foto2 hanya melihat SKU yang ditugaskan kepadanya
  ok(call(A, 'photo.assign', { variantIds: [VIDS[2]], assignee: G.ctx.db_('Users').rows().find((u) => u.email === 'foto2@toko.local').id }));
  assert.deepEqual(ok(call(S2, 'photo.list', { filter: 'all' })).rows.map((r) => r.variantId), [VIDS[2]]);
  assert.ok(ok(call(S, 'photo.list', { filter: 'all' })).rows.every((r) => r.variantId !== VIDS[2]), 'SKU milik staf lain tidak tampil');
  // review aktif → foto baru menunggu review sampai disetujui
  ok(call(A, 'settings.save', { photo_review_required: true }));
  ok(call(S2, 'photo.save', { variantId: VIDS[2], dataUrl: jpeg(4), expectFileId: '' }));
  assert.equal(ok(call(A, 'photo.list', { filter: 'review' })).total, 1);
  ok(call(A, 'photo.approve', { variantIds: [VIDS[2]] }));
  assert.equal(ok(call(A, 'photo.list', { filter: 'review' })).total, 0);
  assert.equal(ok(call(A, 'photo.get', { variantId: VIDS[2] })).state, 'DONE');
  assert.ok(ok(call(A, 'photo.staff', {})).length >= 2);
});
