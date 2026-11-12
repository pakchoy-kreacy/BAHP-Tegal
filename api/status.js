// Publik: cek status dengan kode booking. Hanya status, tanggal, lokasi.
const { getDb } = require('../lib/firebase');
const { route, HttpError } = require('../lib/http');
const { KODE_RE } = require('../lib/validate');
const { batasi } = require('../lib/ratelimit');
const { labelTanggal } = require('../lib/tanggal');

module.exports = route(['GET'], async ({ req, query }) => {
  const db = getDb();
  await batasi(db, req, 'status', 30, 600);
  const kode = String(query.kode || '').trim().toUpperCase();
  if (!KODE_RE.test(kode)) throw new HttpError(400, 'Format kode salah. Contoh: BAP-20261120-001');
  const s = await db.collection('pemohon').doc(kode).get();
  if (!s.exists) throw new HttpError(404, 'Kode booking tidak ditemukan.');
  const d = s.data();
  return { kode, status: d.status, tanggal: d.tanggal, tanggalLabel: labelTanggal(d.tanggal), lokasi: d.lokasi };
});
