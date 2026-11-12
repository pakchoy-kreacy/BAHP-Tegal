const crypto = require('crypto');
const { FieldValue, Timestamp } = require('./firebase');
const { HttpError } = require('./http');

function ipDari(req) {
  const h = req.headers || {};
  const x = String(h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim();
  return x || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Batas sederhana per IP per jendela waktu, disimpan di Firestore (IP di-hash).
// Opsional: aktifkan TTL Firestore pada koleksi "ratelimit" field "hapusPada".
async function batasi(db, req, nama, maks, detik) {
  const salt = process.env.RATE_SALT || 'bhap';
  const hash = crypto.createHash('sha256').update(salt + '|' + ipDari(req)).digest('hex').slice(0, 24);
  const jendela = Math.floor(Date.now() / 1000 / detik);
  const ref = db.collection('ratelimit').doc(`${nama}_${hash}_${jendela}`);
  const n = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const c = (s.exists ? s.data().n : 0) + 1;
    tx.set(ref, { n: c, hapusPada: Timestamp.fromMillis((jendela + 2) * detik * 1000) });
    return c;
  });
  if (n > maks) throw new HttpError(429, 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.');
}

module.exports = { batasi, ipDari };
