// Publik: pantau BAP.
//   ?kode=BAP-...            -> status satu booking
//   ?tanggal=yyyy-MM-dd[&lokasi=..] -> daftar booking hari itu, nama disamarkan, tanpa HP/email
const { q } = require('../lib/db');
const { route, HttpError } = require('../lib/http');
const { KODE_RE } = require('../lib/validate');
const { batasi } = require('../lib/ratelimit');
const { labelTanggal, todayWIB, validIso, selisihHari } = require('../lib/tanggal');
const { lokasiByNama } = require('../lib/config');

// "Setio utomo priono" -> "Set** U. P."
function samarkan(nama) {
  const k = String(nama || '').trim().split(/\s+/).filter(Boolean);
  if (!k.length) return '-';
  const awal = k[0].length <= 3 ? k[0][0] + '**' : k[0].slice(0, 3) + '*'.repeat(Math.min(k[0].length - 3, 4));
  return [awal, ...k.slice(1).map((x) => x[0].toUpperCase() + '.')].join(' ');
}

module.exports = route(['GET'], async ({ req, query }) => {
  await batasi(req, 'status', 30, 600);
  if (query.tanggal !== undefined) {
    const t = String(query.tanggal);
    if (!validIso(t)) throw new HttpError(400, 'Tanggal tidak valid.');
    const beda = selisihHari(todayWIB(), t);
    if (Math.abs(beda) > 60) throw new HttpError(400, 'Hanya bisa melihat 60 hari ke belakang / ke depan.');
    const lok = query.lokasi ? lokasiByNama(query.lokasi) : null;
    const p = [t]; let f = '';
    if (lok) { p.push(lok.nama); f = ' and lokasi = $2'; }
    const rows = await q(`select kode, nama, lokasi, status from pemohon where tanggal = $1${f} order by kode`, p);
    return { tanggal: t, tanggalLabel: labelTanggal(t), data: rows.map((r) => ({ kode: r.kode, nama: samarkan(r.nama), lokasi: r.lokasi, status: r.status })) };
  }
  const kode = String(query.kode || '').trim().toUpperCase();
  if (!KODE_RE.test(kode)) throw new HttpError(400, 'Format kode salah. Contoh: BAP-20261120-001');
  const [d] = await q('select status, tanggal, lokasi from pemohon where kode = $1', [kode]);
  if (!d) throw new HttpError(404, 'Kode booking tidak ditemukan.');
  return { kode, status: d.status, tanggal: d.tanggal, tanggalLabel: labelTanggal(d.tanggal), lokasi: d.lokasi };
});

module.exports.samarkan = samarkan;
