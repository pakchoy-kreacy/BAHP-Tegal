// Publik: cek status dengan kode booking. Hanya status, tanggal, lokasi.
const { q } = require('../lib/db');
const { route, HttpError } = require('../lib/http');
const { KODE_RE } = require('../lib/validate');
const { batasi } = require('../lib/ratelimit');
const { labelTanggal } = require('../lib/tanggal');

module.exports = route(['GET'], async ({ req, query }) => {
  await batasi(req, 'status', 30, 600);
  const kode = String(query.kode || '').trim().toUpperCase();
  if (!KODE_RE.test(kode)) throw new HttpError(400, 'Format kode salah. Contoh: BAP-20261120-001');
  const [d] = await q('select status, tanggal, lokasi from pemohon where kode = $1', [kode]);
  if (!d) throw new HttpError(404, 'Kode booking tidak ditemukan.');
  return { kode, status: d.status, tanggal: d.tanggal, tanggalLabel: labelTanggal(d.tanggal), lokasi: d.lokasi };
});
