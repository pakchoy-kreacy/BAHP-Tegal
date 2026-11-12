const { admin } = require('./firebase');
const { HttpError } = require('./http');

function daftarAdmin() {
  return (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Verifikasi ID token Firebase + email harus ada di ADMIN_EMAILS.
async function requireAdmin(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer (.+)$/.exec(h);
  if (!m) throw new HttpError(401, 'Silakan login dulu.');
  let tok;
  try { tok = await admin.auth().verifyIdToken(m[1]); }
  catch { throw new HttpError(401, 'Sesi login tidak valid. Login ulang.'); }
  const email = String(tok.email || '').toLowerCase();
  if (!tok.email_verified || !email || !daftarAdmin().includes(email)) {
    throw new HttpError(403, 'Email ini tidak punya akses admin.');
  }
  return { email };
}

module.exports = { requireAdmin, daftarAdmin };
