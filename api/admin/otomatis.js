// GET: pola + libur (juga dipakai untuk cek login admin). PUT: simpan libur. POST: isi jadwal otomatis.
const { getDb } = require('../../lib/firebase');
const { route, HttpError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { POLA_LAYANAN, ISI_HARI_KE_DEPAN, lokasiByNama } = require('../../lib/config');
const { rencanaJadwal } = require('../../lib/jadwal-auto');
const { jadwalId } = require('../../lib/booking');
const { todayWIB, validIso } = require('../../lib/tanggal');

async function bacaLibur(db) {
  const s = await db.collection('pengaturan').doc('libur').get();
  return s.exists ? (s.data().tanggal || []) : [];
}

module.exports = route(['GET', 'PUT', 'POST'], async ({ req, body }) => {
  const { email } = await requireAdmin(req);
  const db = getDb();
  if (req.method === 'GET') {
    return { email, pola: POLA_LAYANAN, libur: await bacaLibur(db), hariKeDepan: ISI_HARI_KE_DEPAN };
  }
  if (req.method === 'PUT') {
    const libur = [...new Set((Array.isArray(body.libur) ? body.libur : []).map(String))].sort();
    if (libur.length > 400 || libur.some((t) => !validIso(t))) throw new HttpError(400, 'Format tanggal libur tidak valid (yyyy-MM-dd).');
    await db.collection('pengaturan').doc('libur').set({ tanggal: libur });
    return { libur };
  }
  const hari = body.hari === undefined ? ISI_HARI_KE_DEPAN : Number(body.hari);
  if (!Number.isInteger(hari) || hari < 1 || hari > 120) throw new HttpError(400, 'Jumlah hari 1 sampai 120.');
  const { hasil, dilewati } = rencanaJadwal(todayWIB(), hari, POLA_LAYANAN, await bacaLibur(db));
  // create() gagal bila dokumen sudah ada -> jadwal lama (termasuk yang ditutup / sudah dipesan) tidak tersentuh.
  const out = await Promise.all(hasil.map(async (j) => {
    try {
      await db.collection('jadwal').doc(jadwalId(j.tanggal, lokasiByNama(j.lokasi).nama))
        .create({ ...j, terpakai: 0, tutup: false });
      return true;
    } catch (e) { if (e.code === 6) return false; throw e; }
  }));
  const ditambah = out.filter(Boolean).length;
  return { ditambah, sudahAda: out.length - ditambah, hariLiburDilewati: dilewati.length };
});
