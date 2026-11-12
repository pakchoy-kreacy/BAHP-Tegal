// Login admin dengan PIN. Sesi = cookie bertanda tangan (HMAC), 12 jam.
// PIN disimpan sebagai hash scrypt di tabel pengaturan. ADMIN_PIN (env) = PIN cadangan/awal.
const crypto = require('crypto');
const { q } = require('./db');
const { HttpError } = require('./http');

const DURASI = 12 * 3600;
const COOKIE = 'bhap_sess';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const samaAman = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`;
}
function cocokHash(pin, hash) {
  const [alg, salt, h] = String(hash || '').split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(String(pin), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function hashTersimpan() {
  const [r] = await q("select nilai from pengaturan where kunci = 'admin_pin'");
  return r ? r.nilai.hash : null;
}
const versi = (hash) => (hash ? hash.slice(-12) : 'env');

async function cekPin(pin) {
  const p = String(pin == null ? '' : pin);
  if (!p || p.length > 64) return false;
  const hash = await hashTersimpan();
  if (hash && cocokHash(p, hash)) return true;
  const env = process.env.ADMIN_PIN;
  return !!env && samaAman(p, env);
}

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) throw new HttpError(500, 'Server belum dikonfigurasi (SESSION_SECRET).');
  return s;
}
const ttd = (isi) => crypto.createHmac('sha256', secret()).update(isi).digest('base64url');

async function buatCookie(req) {
  const isi = Buffer.from(JSON.stringify({ e: Math.floor(Date.now() / 1000) + DURASI, v: versi(await hashTersimpan()) })).toString('base64url');
  const aman = (req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL) ? '; Secure' : '';
  return `${COOKIE}=${isi}.${ttd(isi)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${DURASI}${aman}`;
}
const cookieHapus = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0`;

async function requireAdmin(req) {
  if (req.method !== 'GET' && req.headers['x-bhap'] !== '1') throw new HttpError(403, 'Permintaan tidak valid.');
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  const [isi, sig] = m ? m[1].split('.') : [];
  if (!isi || !sig || !samaAman(sig, ttd(isi))) throw new HttpError(401, 'Silakan login dengan PIN.');
  let d; try { d = JSON.parse(Buffer.from(isi, 'base64url').toString()); } catch { throw new HttpError(401, 'Sesi tidak valid.'); }
  if (!d.e || d.e < Date.now() / 1000 || d.v !== versi(await hashTersimpan())) throw new HttpError(401, 'Sesi berakhir. Login ulang.');
  return true;
}

async function simpanPin(pinBaru) {
  await q(`insert into pengaturan (kunci, nilai) values ('admin_pin', $1)
           on conflict (kunci) do update set nilai = excluded.nilai`, [JSON.stringify({ hash: hashPin(pinBaru) })]);
}

module.exports = { requireAdmin, cekPin, buatCookie, cookieHapus, simpanPin, hashPin, cocokHash };
