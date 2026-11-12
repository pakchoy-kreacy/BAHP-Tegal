const { q } = require('../../lib/db');
const { route, HttpError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { rentang } = require('../../lib/query');
const { lokasiByNama } = require('../../lib/config');
const { todayWIB, addDays, validIso, labelTanggal } = require('../../lib/tanggal');

function kuotaValid(k) {
  const n = Number(k);
  if (k === '' || k === null || !Number.isInteger(n) || n < 0 || n > 500) throw new HttpError(400, 'Kuota harus angka bulat 0 sampai 500.');
  return n;
}
function kunci(src) {
  const lok = lokasiByNama(src.lokasi);
  if (!lok) throw new HttpError(400, 'Lokasi tidak valid.');
  if (!validIso(src.tanggal)) throw new HttpError(400, 'Tanggal tidak valid.');
  return { tanggal: src.tanggal, lokasi: lok.nama };
}

module.exports = route(['GET', 'POST', 'PATCH', 'DELETE'], async ({ req, query, body }) => {
  await requireAdmin(req);
  if (req.method === 'GET') {
    const h = todayWIB();
    const r = rentang(query, h, addDays(h, 60));
    const rows = await q('select tanggal, lokasi, kuota, terpakai, tutup from jadwal where tanggal >= $1 and tanggal <= $2 order by tanggal, lokasi', [r.dari, r.sampai]);
    return rows.map((j) => ({ ...j, label: labelTanggal(j.tanggal) }));
  }
  const { tanggal, lokasi } = kunci(req.method === 'DELETE' ? query : body);

  if (req.method === 'POST') { // tambah tanggal baru
    const kuota = kuotaValid(body.kuota);
    if (tanggal < todayWIB()) throw new HttpError(400, 'Tanggal sudah lewat.');
    const r = await q('insert into jadwal (tanggal, lokasi, kuota) values ($1, $2, $3) on conflict do nothing returning 1', [tanggal, lokasi, kuota]);
    if (!r.length) throw new HttpError(409, 'Jadwal tanggal dan lokasi itu sudah ada. Ubah kuotanya saja.');
    return { tanggal, lokasi, kuota };
  }
  const [j] = await q('select terpakai from jadwal where tanggal = $1 and lokasi = $2', [tanggal, lokasi]);
  if (!j) throw new HttpError(404, 'Jadwal tidak ditemukan.');

  if (req.method === 'PATCH') { // ubah kuota / tutup-buka (atomik: kuota tidak boleh < terpakai)
    const kuota = body.kuota === undefined ? null : kuotaValid(body.kuota);
    const tutup = body.tutup === undefined ? null : !!body.tutup;
    const r = await q(
      `update jadwal set kuota = coalesce($3::int, kuota), tutup = coalesce($4::boolean, tutup)
       where tanggal = $1 and lokasi = $2 and coalesce($3::int, kuota) >= terpakai returning kuota, tutup, terpakai`,
      [tanggal, lokasi, kuota, tutup]);
    if (!r.length) throw new HttpError(409, `Sudah ada ${j.terpakai} booking aktif. Kuota tidak boleh di bawah itu.`);
    return { tanggal, lokasi, kuota: r[0].kuota, tutup: r[0].tutup };
  }
  // DELETE: hanya bila tidak ada booking aktif
  const r = await q('delete from jadwal where tanggal = $1 and lokasi = $2 and terpakai = 0 returning 1', [tanggal, lokasi]);
  if (!r.length) throw new HttpError(409, `Masih ada ${j.terpakai} booking aktif. Batalkan dulu bookingnya, atau pakai Tutup.`);
  return { tanggal, lokasi, dihapus: true };
});
