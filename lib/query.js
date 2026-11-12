const { q } = require('./db');
const { KODE_RE, normalisasiHp } = require('./validate');
const { labelTanggal, validIso, selisihHari } = require('./tanggal');
const { HttpError } = require('./http');

const MAKS_RENTANG = 370;

function rentang(qs, defDari, defSampai) {
  const dari = qs.dari || defDari, sampai = qs.sampai || defSampai;
  if (!validIso(dari) || !validIso(sampai) || sampai < dari) throw new HttpError(400, 'Rentang tanggal tidak valid.');
  if (selisihHari(dari, sampai) > MAKS_RENTANG) throw new HttpError(400, 'Rentang tanggal maksimal 1 tahun.');
  return { dari, sampai };
}

function barisPemohon(d) {
  const wa = normalisasiHp(d.hp);
  return {
    kode: d.kode, nama: d.nama, hp: d.hp, wa: /^62\d{8,13}$/.test(wa) ? wa : '',
    email: d.email || '', jenis: d.jenis, lokasi: d.lokasi, tanggal: d.tanggal,
    tanggalLabel: labelTanggal(d.tanggal), jam: d.jam || '', status: d.status,
    petugas: d.petugas || '', keterangan: d.keterangan || '',
    dibuat: d.dibuat ? new Date(d.dibuat).toISOString() : ''
  };
}

async function ambilPemohon({ dari, sampai, lokasi, status, q: cari }) {
  cari = String(cari || '').trim();
  if (cari && KODE_RE.test(cari.toUpperCase())) {
    return (await q('select * from pemohon where kode = $1', [cari.toUpperCase()])).map(barisPemohon);
  }
  const w = ['tanggal >= $1', 'tanggal <= $2'], p = [dari, sampai];
  if (lokasi) { p.push(lokasi); w.push(`lokasi = $${p.length}`); }
  if (status) { p.push(status); w.push(`status = $${p.length}`); }
  if (cari) {
    p.push('%' + cari.replace(/[\\%_]/g, '\\$&') + '%'); const i = p.length;
    const digit = cari.replace(/\D/g, '').replace(/^0/, '');
    let cond = `nama ilike $${i} or kode ilike $${i}`;
    if (digit.length >= 4) { p.push('%' + digit + '%'); cond += ` or hp like $${p.length}`; }
    w.push(`(${cond})`);
  }
  return (await q(`select * from pemohon where ${w.join(' and ')} order by tanggal, kode limit 5000`, p)).map(barisPemohon);
}

async function ambilRekap({ dari, sampai, lokasi }) {
  const p = [dari, sampai]; let f = '';
  if (lokasi) { p.push(lokasi); f = ' and lokasi = $3'; }
  const [jad, pem] = await Promise.all([
    q(`select tanggal, lokasi, kuota from jadwal where tanggal >= $1 and tanggal <= $2${f}`, p),
    q(`select tanggal, lokasi,
         count(*) filter (where status = 'Menunggu')::int menunggu, count(*) filter (where status = 'Terkonfirmasi')::int terkonfirmasi, count(*) filter (where status = 'Terjadwal')::int terjadwal,
         count(*) filter (where status = 'Selesai')::int selesai, count(*) filter (where status = 'Dibatalkan')::int dibatalkan
       from pemohon where tanggal >= $1 and tanggal <= $2${f} group by tanggal, lokasi`, p)
  ]);
  const peta = new Map();
  const ambil = (tanggal, lok) => {
    const k = tanggal + '|' + lok;
    if (!peta.has(k)) peta.set(k, { tanggal, lokasi: lok, kuota: 0, menunggu: 0, terkonfirmasi: 0, terjadwal: 0, selesai: 0, dibatalkan: 0, aktif: 0 });
    return peta.get(k);
  };
  jad.forEach((j) => { ambil(j.tanggal, j.lokasi).kuota = j.kuota; });
  pem.forEach((x) => {
    const r = ambil(x.tanggal, x.lokasi);
    Object.assign(r, { menunggu: x.menunggu, terkonfirmasi: x.terkonfirmasi, terjadwal: x.terjadwal, selesai: x.selesai, dibatalkan: x.dibatalkan });
    r.aktif = x.menunggu + x.terkonfirmasi + x.terjadwal + x.selesai;
  });
  return [...peta.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.lokasi.localeCompare(b.lokasi));
}

module.exports = { rentang, ambilPemohon, ambilRekap };
