// GET: pola + libur. PUT: simpan libur. POST: isi jadwal otomatis.
const { q } = require('../../lib/db');
const { bacaAutoKonfirmasi } = require('../../lib/booking');
const { route, HttpError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { POLA_LAYANAN, ISI_HARI_KE_DEPAN, PESAN_DOKUMEN } = require('../../lib/config');
const { rencanaJadwal } = require('../../lib/jadwal-auto');
const { todayWIB, validIso } = require('../../lib/tanggal');

async function bacaLibur() {
  const [r] = await q("select nilai from pengaturan where kunci = 'libur'");
  return r ? r.nilai.tanggal || [] : [];
}

module.exports = route(['GET', 'PUT', 'POST'], async ({ req, body }) => {
  await requireAdmin(req);
  if (req.method === 'GET') return { pola: POLA_LAYANAN, libur: await bacaLibur(), hariKeDepan: ISI_HARI_KE_DEPAN, autoKonfirmasi: await bacaAutoKonfirmasi(), pesanDokumen: PESAN_DOKUMEN };
  if (req.method === 'PUT' && body.autoKonfirmasi !== undefined) {
    const nilai = body.autoKonfirmasi === true;
    await q(`insert into pengaturan (kunci, nilai) values ('auto_konfirmasi', $1) on conflict (kunci) do update set nilai = excluded.nilai`, [JSON.stringify(nilai)]);
    return { autoKonfirmasi: nilai };
  }
  if (req.method === 'PUT') {
    const libur = [...new Set((Array.isArray(body.libur) ? body.libur : []).map(String))].sort();
    if (libur.length > 400 || libur.some((t) => !validIso(t))) throw new HttpError(400, 'Format tanggal libur tidak valid (yyyy-MM-dd).');
    await q(`insert into pengaturan (kunci, nilai) values ('libur', $1) on conflict (kunci) do update set nilai = excluded.nilai`, [JSON.stringify({ tanggal: libur })]);
    return { libur };
  }
  const hari = body.hari === undefined ? ISI_HARI_KE_DEPAN : Number(body.hari);
  if (!Number.isInteger(hari) || hari < 1 || hari > 120) throw new HttpError(400, 'Jumlah hari 1 sampai 120.');
  const { hasil, dilewati } = rencanaJadwal(todayWIB(), hari, POLA_LAYANAN, await bacaLibur());
  // on conflict do nothing -> jadwal lama (termasuk yang ditutup / sudah dipesan) tidak tersentuh
  const r = await q(
    `insert into jadwal (tanggal, lokasi, kuota) select * from unnest($1::date[], $2::text[], $3::int[]) on conflict do nothing returning 1`,
    [hasil.map((x) => x.tanggal), hasil.map((x) => x.lokasi), hasil.map((x) => x.kuota)]);
  return { ditambah: r.length, sudahAda: hasil.length - r.length, hariLiburDilewati: dilewati.length };
});
