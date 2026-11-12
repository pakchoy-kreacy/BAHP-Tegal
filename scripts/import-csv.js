#!/usr/bin/env node
// Impor SEKALI dari CSV (ekspor Google Sheet) ke Firestore.
//
//   node scripts/import-csv.js --pemohon data/pemohon.csv --jadwal data/jadwal.csv            (uji coba, tidak menulis)
//   node scripts/import-csv.js --pemohon data/pemohon.csv --jadwal data/jadwal.csv --commit   (benar-benar menulis)
//
// Butuh env FIREBASE_SERVICE_ACCOUNT (atau FIRESTORE_EMULATOR_HOST untuk uji lokal).
// Menolak jalan bila Firestore sudah berisi data, kecuali --force.
const fs = require('fs');
const { bacaCsv } = require('../lib/csv');
const { KODE_RE, normalisasiHp } = require('../lib/validate');
const { lokasiByNama, JENIS_BAP, STATUS } = require('../lib/config');
const { validIso } = require('../lib/tanggal');
const { jadwalId } = require('../lib/booking');

function tabel(text) {
  const rows = bacaCsv(text);
  const head = rows.shift().map((x) => x.trim().toUpperCase());
  return rows.map((r) => Object.fromEntries(head.map((k, i) => [k, (r[i] || '').trim()])));
}

// yyyy-mm-dd..., dd/mm/yyyy, d-m-yyyy -> yyyy-mm-dd
function tgl(s) {
  s = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) { const k = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s); if (k) m = [0, k[3], k[2], k[1]]; }
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return validIso(iso) ? iso : null;
}
function waktuDaftar(s, fallbackIso) {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
  const t = tgl(s);
  const d = new Date(`${t || fallbackIso}T${m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}` : '00:00:00'}+07:00`);
  return isNaN(d) ? null : d;
}

// Fungsi murni: CSV -> dokumen yang akan ditulis + daftar masalah.
function siapkan(pemText, jadText) {
  const err = [], warn = [];
  const jadwal = new Map(), pemohon = [], urutan = new Map(), kunci = new Map();

  tabel(jadText).forEach((r, i) => {
    const baris = `jadwal baris ${i + 2}`;
    const t = tgl(r.TANGGAL), lok = lokasiByNama(r.LOKASI), kuota = parseInt(r.KUOTA, 10);
    if (!t || !lok || !(kuota >= 0)) return err.push(`${baris}: tanggal/lokasi/kuota tidak valid (${r.TANGGAL} | ${r.LOKASI} | ${r.KUOTA})`);
    jadwal.set(jadwalId(t, lok.nama), { tanggal: t, lokasi: lok.nama, kuota, terpakai: 0, tutup: false });
  });

  tabel(pemText).forEach((r, i) => {
    const baris = `pemohon baris ${i + 2}`;
    const kode = (r['ID BAP'] || '').toUpperCase();
    const t = tgl(r.TANGGAL), lok = lokasiByNama(r.LOKASI);
    const jenis = (r['JENIS BAP'] || '').toUpperCase();
    const status = STATUS.find((s) => s.toLowerCase() === (r.STATUS || 'Menunggu').toLowerCase());
    if (!KODE_RE.test(kode)) return err.push(`${baris}: ID BAP tidak valid (${r['ID BAP']})`);
    if (!t || !lok) return err.push(`${baris} ${kode}: tanggal/lokasi tidak valid (${r.TANGGAL} | ${r.LOKASI})`);
    if (!JENIS_BAP.includes(jenis)) return err.push(`${baris} ${kode}: jenis BAP tidak dikenal (${r['JENIS BAP']})`);
    if (!status) return err.push(`${baris} ${kode}: status tidak dikenal (${r.STATUS})`);
    if (pemohon.some((p) => p.kode === kode)) return err.push(`${baris}: kode ganda ${kode}`);
    let hp = normalisasiHp(String(r['NO HP'] || '').replace(/^="?|"$/g, ''));
    if (!/^628\d{7,12}$/.test(hp)) warn.push(`${baris} ${kode}: nomor HP tidak standar (${r['NO HP']}) - tetap diimpor`);
    const dibuat = waktuDaftar(r['TANGGAL DAFTAR'], t);
    pemohon.push({ kode, nama: r.NAMA, hp, email: r.EMAIL || '', jenis, lokasi: lok.nama, tanggal: t, jam: r.JAM || '', status,
      petugas: r['PETUGAS PEMERIKSA'] || '', keterangan: r.KETERANGAN || '', dibuat });
    const n = parseInt(kode.split('-')[2], 10);
    if (n > (urutan.get(t) || 0)) urutan.set(t, n);
    const jid = jadwalId(t, lok.nama);
    if (status !== 'Dibatalkan') {
      if (!jadwal.has(jid)) { jadwal.set(jid, { tanggal: t, lokasi: lok.nama, kuota: 0, terpakai: 0, tutup: true }); warn.push(`${baris} ${kode}: jadwal ${t} ${lok.nama} tidak ada di CSV jadwal - dibuat dalam keadaan tutup`); }
      jadwal.get(jid).terpakai++;
      const kid = `${t}_${hp}`;
      if (kunci.has(kid)) warn.push(`${baris} ${kode}: HP ${hp} sudah punya booking aktif lain di ${t} (${kunci.get(kid)}) - data lama, tetap diimpor`);
      else kunci.set(kid, kode);
    }
  });
  for (const j of jadwal.values()) if (j.kuota < j.terpakai) { if (j.tutup) j.kuota = j.terpakai; else warn.push(`jadwal ${j.tanggal} ${j.lokasi}: terpakai ${j.terpakai} > kuota ${j.kuota}`); }
  return { err, warn, jadwal, pemohon, urutan, kunci };
}

async function main() {
  const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const fp = arg('--pemohon'), fj = arg('--jadwal'), commit = a.includes('--commit'), force = a.includes('--force');
  if (!fp || !fj) { console.error('Pemakaian: node scripts/import-csv.js --pemohon pemohon.csv --jadwal jadwal.csv [--commit] [--force]'); process.exit(2); }
  const s = siapkan(fs.readFileSync(fp, 'utf8'), fs.readFileSync(fj, 'utf8'));
  console.log(`Pemohon: ${s.pemohon.length} | Jadwal: ${s.jadwal.size} | Tanggal berurutan: ${s.urutan.size} | Kunci HP: ${s.kunci.size}`);
  s.warn.forEach((w) => console.log('PERINGATAN', w));
  s.err.forEach((e) => console.log('GALAT    ', e));
  if (s.err.length) { console.error(`\n${s.err.length} baris bermasalah. Perbaiki CSV lalu jalankan ulang. Tidak ada yang ditulis.`); process.exit(1); }
  if (!commit) { console.log('\nUji coba selesai (tidak ada yang ditulis). Tambahkan --commit untuk menulis.'); return; }

  const { getDb, Timestamp } = require('../lib/firebase');
  const db = getDb();
  if (!force) {
    for (const c of ['pemohon', 'jadwal']) {
      if (!(await db.collection(c).limit(1).get()).empty) { console.error(`Koleksi "${c}" sudah berisi data. Impor dibatalkan (pakai --force bila yakin).`); process.exit(1); }
    }
  }
  const tulis = [];
  s.pemohon.forEach((p) => tulis.push([db.collection('pemohon').doc(p.kode), { ...p, dibuat: Timestamp.fromDate(p.dibuat || new Date()) }]));
  s.jadwal.forEach((j, id) => tulis.push([db.collection('jadwal').doc(id), j]));
  s.urutan.forEach((n, t) => tulis.push([db.collection('urutan').doc(t), { n }]));
  s.kunci.forEach((kode, id) => tulis.push([db.collection('kunci').doc(id), { kode }]));
  for (let i = 0; i < tulis.length; i += 400) {
    const b = db.batch(); tulis.slice(i, i + 400).forEach(([ref, d]) => b.set(ref, d)); await b.commit();
  }
  console.log(`Selesai menulis ${tulis.length} dokumen.`);
}

module.exports = { siapkan, tgl };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
