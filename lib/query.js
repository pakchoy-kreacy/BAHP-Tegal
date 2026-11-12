const { KODE_RE, normalisasiHp } = require('./validate');
const { labelTanggal, validIso, selisihHari, todayWIB, addDays } = require('./tanggal');
const { HttpError } = require('./http');

const MAKS_RENTANG = 370;

function rentang(q, defDari, defSampai) {
  const dari = q.dari || defDari, sampai = q.sampai || defSampai;
  if (!validIso(dari) || !validIso(sampai) || sampai < dari) throw new HttpError(400, 'Rentang tanggal tidak valid.');
  if (selisihHari(dari, sampai) > MAKS_RENTANG) throw new HttpError(400, 'Rentang tanggal maksimal 1 tahun.');
  return { dari, sampai };
}

function barisPemohon(d) {
  const hp = String(d.hp || '');
  const wa = normalisasiHp(hp);
  return {
    kode: d.kode, nama: d.nama, hp, wa: /^62\d{8,13}$/.test(wa) ? wa : '',
    email: d.email || '', jenis: d.jenis, lokasi: d.lokasi, tanggal: d.tanggal,
    tanggalLabel: d.tanggal ? labelTanggal(d.tanggal) : '', jam: d.jam || '', status: d.status,
    petugas: d.petugas || '', keterangan: d.keterangan || '',
    dibuat: d.dibuat && d.dibuat.toDate ? d.dibuat.toDate().toISOString() : ''
  };
}

// Query hanya memakai rentang pada 'tanggal' (indeks otomatis Firestore);
// filter lokasi/status/pencarian dikerjakan di server.
async function ambilPemohon(db, { dari, sampai, lokasi, status, q }) {
  const cari = String(q || '').trim();
  let rows;
  if (cari && KODE_RE.test(cari.toUpperCase())) {
    const s = await db.collection('pemohon').doc(cari.toUpperCase()).get();
    rows = s.exists ? [barisPemohon(s.data())] : [];
  } else {
    const snap = await db.collection('pemohon').where('tanggal', '>=', dari).where('tanggal', '<=', sampai).limit(5000).get();
    rows = snap.docs.map((s) => barisPemohon(s.data()));
    if (lokasi) rows = rows.filter((r) => r.lokasi === lokasi);
    if (status) rows = rows.filter((r) => r.status === status);
    if (cari) {
      const k = cari.toLowerCase(), digit = cari.replace(/\D/g, '');
      rows = rows.filter((r) => r.nama.toLowerCase().includes(k) || r.kode.toLowerCase().includes(k) ||
        (digit.length >= 4 && r.hp.replace(/\D/g, '').includes(digit.replace(/^0/, ''))));
    }
  }
  return rows.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.kode.localeCompare(b.kode));
}

async function ambilRekap(db, { dari, sampai, lokasi }) {
  const [pem, jad] = await Promise.all([
    ambilPemohon(db, { dari, sampai, lokasi }),
    db.collection('jadwal').where('tanggal', '>=', dari).where('tanggal', '<=', sampai).get()
  ]);
  const peta = new Map();
  const ambil = (tanggal, lok) => {
    const key = tanggal + '|' + lok;
    if (!peta.has(key)) peta.set(key, { tanggal, lokasi: lok, kuota: 0, menunggu: 0, terjadwal: 0, selesai: 0, dibatalkan: 0, aktif: 0 });
    return peta.get(key);
  };
  jad.docs.forEach((s) => { const j = s.data(); if (!lokasi || j.lokasi === lokasi) ambil(j.tanggal, j.lokasi).kuota = j.kuota; });
  pem.forEach((p) => {
    const r = ambil(p.tanggal, p.lokasi);
    r[p.status.toLowerCase()]++;
    if (p.status !== 'Dibatalkan') r.aktif++;
  });
  return [...peta.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.lokasi.localeCompare(b.lokasi));
}

module.exports = { rentang, ambilPemohon, ambilRekap, todayWIB, addDays };
