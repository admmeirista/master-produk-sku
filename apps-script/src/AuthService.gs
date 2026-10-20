/**
 * Login aplikasi sendiri (email + password), karena Web App dijalankan "Execute as Me":
 * untuk akun Gmail biasa, Session.getActiveUser() tidak mengembalikan email pengunjung.
 * Password disimpan sebagai hash SHA-256 ber-salt dan di-iterasi; sesi = token acak di CacheService (8 jam).
 */

const SESSION_TTL_SEC = 8 * 3600;
const PW_ITERATIONS = 300;

function hashPassword_(password, salt) {
  let h = salt + '|' + password;
  for (let i = 0; i < PW_ITERATIONS; i++) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8);
    h = Utilities.base64Encode(bytes);
  }
  return h;
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function createUser_(input, actor) {
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Email tidak valid');
  if (ROLES.indexOf(input.role) < 0) throw new AppError('Role tidak valid');
  if (!input.password || String(input.password).length < 10) throw new AppError('Password minimal 10 karakter');
  if (cleanText(input.fullName).length < 2) throw new AppError('Nama wajib diisi');
  const t = db_('Users');
  if (t.find((u) => u.email === email)) throw new AppError('Email sudah terdaftar');
  const salt = newSalt_();
  const rec = t.insert({
    id: uuid_(),
    email,
    full_name: cleanText(input.fullName),
    role: input.role,
    is_active: true,
    pw_salt: salt,
    pw_hash: hashPassword_(input.password, salt),
    failed_logins: 0,
    created_at: now_(),
    updated_at: now_(),
  });
  audit_(actor ? actor.email : 'system', 'user.create', 'user', rec.id, null, { email, role: input.role });
  return publicUser_(rec);
}

function publicUser_(u) {
  return { id: u.id, email: u.email, fullName: u.full_name, role: u.role, isActive: u.is_active, lastLoginAt: u.last_login_at };
}

function login_(email, password) {
  return withLock_(() => {
    const id = String(email || '').trim().toLowerCase();
    // username = bagian email sebelum "@" (mis. adm.meirista); hanya dipakai bila unik
    const byUser = id.indexOf('@') < 0 ? db_('Users').filter((x) => String(x.email).split('@')[0] === id) : [];
    const u = id.indexOf('@') >= 0 ? db_('Users').find((x) => x.email === id) : byUser.length === 1 ? byUser[0] : null;
    const fail = new AppError('Username atau password salah', [], 'BAD_CREDENTIALS');
    if (!u) {
      hashPassword_(String(password), 'timing'); // samakan waktu respons
      throw fail;
    }
    if (!u.is_active) throw new AppError('Akun dinonaktifkan. Hubungi admin.');
    if (u.locked_until && new Date(u.locked_until) > new Date()) throw new AppError('Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.');
    if (hashPassword_(String(password), u.pw_salt) !== u.pw_hash) {
      const n = (u.failed_logins || 0) + 1;
      db_('Users').update(u, { failed_logins: n, locked_until: n >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : u.locked_until });
      throw fail;
    }
    db_('Users').update(u, { failed_logins: 0, locked_until: '', last_login_at: now_() });
    const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
    CacheService.getScriptCache().put('sess_' + token, u.id, SESSION_TTL_SEC);
    audit_(u.email, 'auth.login', 'user', u.id);
    return { token, user: publicUser_(u), permissions: ROLE_PERMISSIONS[u.role] };
  });
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return true;
}

/** Validasi sesi di setiap panggilan. Role & status aktif dibaca ulang dari sheet (user dinonaktifkan langsung terblokir). */
function sessionUser_(token) {
  if (!token) throw new AppError('Silakan login terlebih dahulu', [], 'UNAUTHENTICATED');
  const id = CacheService.getScriptCache().get('sess_' + token);
  if (!id) throw new AppError('Sesi berakhir, silakan login kembali', [], 'UNAUTHENTICATED');
  const u = db_('Users').byId(id);
  if (!u || !u.is_active) throw new AppError('Akun tidak aktif', [], 'UNAUTHENTICATED');
  CacheService.getScriptCache().put('sess_' + token, u.id, SESSION_TTL_SEC); // perpanjang (sliding)
  return { id: u.id, email: u.email, fullName: u.full_name, role: u.role };
}

function can_(user, perm) {
  return !!user && (ROLE_PERMISSIONS[user.role] || []).indexOf(perm) >= 0;
}
function assertPerm_(user, perm) {
  if (!can_(user, perm)) throw new AppError('Anda tidak memiliki hak akses untuk tindakan ini', [], 'FORBIDDEN');
}
