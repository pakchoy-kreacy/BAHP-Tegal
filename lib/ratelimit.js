const crypto = require('crypto');
const { q } = require('./db');
const { HttpError } = require('./http');

function ipDari(req) {
  const h = req.headers || {};
  const x = String(h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim();
  return x || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Batas per IP (di-hash) per jendela waktu. Jika ip=false -> batas global untuk nama itu.
async function batasi(req, nama, maks, detik, { global = false } = {}) {
  const hash = global ? 'all' : crypto.createHash('sha256')
    .update((process.env.RATE_SALT || 'bhap') + '|' + ipDari(req)).digest('hex').slice(0, 24);
  const jendela = Math.floor(Date.now() / 1000 / detik);
  const [r] = await q(
    `insert into ratelimit (kunci, n, hapus_pada) values ($1, 1, to_timestamp($2))
     on conflict (kunci) do update set n = ratelimit.n + 1 returning n`,
    [`${nama}_${hash}_${jendela}`, (jendela + 2) * detik]);
  if (Math.random() < 0.05) q('delete from ratelimit where hapus_pada < now()').catch(() => {});
  if (r.n > maks) throw new HttpError(429, 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.');
}

module.exports = { batasi, ipDari };
