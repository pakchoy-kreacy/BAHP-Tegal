// Publik: daftar tanggal + sisa kuota (30 hari ke depan). Tanpa data pribadi.
const { q } = require('../lib/db');
const { route } = require('../lib/http');
const { todayWIB, addDays, labelTanggal } = require('../lib/tanggal');
const { HARI_KE_DEPAN } = require('../lib/config');

module.exports = route(['GET'], async () => {
  const h = todayWIB();
  const rows = await q(
    `select tanggal, lokasi, greatest(kuota - terpakai, 0)::int as sisa from jadwal
     where tanggal >= $1 and tanggal <= $2 and not tutup order by tanggal, lokasi`, [h, addDays(h, HARI_KE_DEPAN)]);
  return rows.map((j) => ({ tanggal: j.tanggal, lokasi: j.lokasi, label: labelTanggal(j.tanggal), sisa: j.sisa }));
}, { cache: 'public, s-maxage=10, stale-while-revalidate=20' });
