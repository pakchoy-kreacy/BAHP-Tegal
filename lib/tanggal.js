// Semua perhitungan tanggal memakai string yyyy-MM-dd (WIB, UTC+7 tetap).
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function validIso(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function todayWIB(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function hariKe(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }
function selisihHari(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
}
function labelTanggal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${HARI[hariKe(iso)]}, ${d} ${BULAN[m - 1]} ${y}`;
}

module.exports = { validIso, todayWIB, addDays, hariKe, selisihHari, labelTanggal, HARI, BULAN };
