const { getDb, FieldValue } = require('../../lib/firebase');
const { route, HttpError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { rentang } = require('../../lib/query');
const { jadwalId } = require('../../lib/booking');
const { lokasiByNama } = require('../../lib/config');
const { todayWIB, addDays, validIso, labelTanggal } = require('../../lib/tanggal');

function kuotaValid(k) {
  const n = Number(k);
  if (!Number.isInteger(n) || n < 0 || n > 500) throw new HttpError(400, 'Kuota harus angka bulat 0 sampai 500.');
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
  const db = getDb();
  if (req.method === 'GET') {
    const h = todayWIB();
    const r = rentang(query, h, addDays(h, 60));
    const snap = await db.collection('jadwal').where('tanggal', '>=', r.dari).where('tanggal', '<=', r.sampai).get();
    return snap.docs.map((s) => s.data())
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.lokasi.localeCompare(b.lokasi))
      .map((j) => ({ ...j, terpakai: j.terpakai || 0, tutup: !!j.tutup, label: labelTanggal(j.tanggal) }));
  }
  const src = req.method === 'DELETE' ? query : body;
  const { tanggal, lokasi } = kunci(src);
  const ref = db.collection('jadwal').doc(jadwalId(tanggal, lokasi));

  if (req.method === 'POST') { // tambah tanggal baru
    const kuota = kuotaValid(body.kuota);
    if (tanggal < todayWIB()) throw new HttpError(400, 'Tanggal sudah lewat.');
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) throw new HttpError(409, 'Jadwal tanggal dan lokasi itu sudah ada. Ubah kuotanya saja.');
      tx.set(ref, { tanggal, lokasi, kuota, terpakai: 0, tutup: false });
    });
    return { tanggal, lokasi, kuota };
  }
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, 'Jadwal tidak ditemukan.');
    const j = s.data();
    if (req.method === 'PATCH') { // ubah kuota / tutup-buka
      const upd = {};
      if (body.kuota !== undefined) {
        upd.kuota = kuotaValid(body.kuota);
        if (upd.kuota < (j.terpakai || 0)) throw new HttpError(409, `Sudah ada ${j.terpakai} booking aktif. Kuota tidak boleh di bawah itu.`);
      }
      if (body.tutup !== undefined) upd.tutup = !!body.tutup;
      tx.update(ref, upd);
      return { tanggal, lokasi, ...upd };
    }
    // DELETE (hapus tanggal libur): hanya bila tidak ada booking aktif
    if ((j.terpakai || 0) > 0) throw new HttpError(409, `Masih ada ${j.terpakai} booking aktif. Batalkan dulu bookingnya, atau pakai Tutup.`);
    tx.delete(ref);
    return { tanggal, lokasi, dihapus: true };
  });
});
