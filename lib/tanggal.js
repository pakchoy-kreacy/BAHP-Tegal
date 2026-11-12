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

// yyyy-mm-dd..., dd/mm/yyyy, d-m-yyyy, nomor seri Excel -> yyyy-mm-dd (atau null)
function tanggalBebas(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) { const k = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s); if (k) m = [0, k[3], k[2], k[1]]; }
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return validIso(iso) ? iso : null;
}

module.exports = { tanggalBebas, validIso, todayWIB, addDays, hariKe, selisihHari, labelTanggal, HARI, BULAN };
