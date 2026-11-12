// Publik: daftar tanggal + sisa kuota (30 hari ke depan). Tanpa data pribadi.
const { getDb } = require('../lib/firebase');
const { route } = require('../lib/http');
const { todayWIB, addDays, labelTanggal } = require('../lib/tanggal');
const { HARI_KE_DEPAN } = require('../lib/config');

module.exports = route(['GET'], async () => {
  const hariIni = todayWIB();
  const snap = await getDb().collection('jadwal')
    .where('tanggal', '>=', hariIni).where('tanggal', '<=', addDays(hariIni, HARI_KE_DEPAN)).get();
  return snap.docs.map((s) => s.data()).filter((j) => !j.tutup)
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.lokasi.localeCompare(b.lokasi))
    .map((j) => ({
      tanggal: j.tanggal, lokasi: j.lokasi, label: labelTanggal(j.tanggal),
      sisa: Math.max(0, j.kuota - (j.terpakai || 0))
    }));
}, { cache: 'public, s-maxage=10, stale-while-revalidate=20' });
