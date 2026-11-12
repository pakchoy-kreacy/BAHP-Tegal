#!/usr/bin/env node
// Impor SEKALI dari CSV (ekspor Google Sheet) ke Postgres (Neon).
//
//   node scripts/import-csv.js --pemohon data/pemohon.csv --jadwal data/jadwal.csv            (uji coba, tidak menulis)
//   node scripts/import-csv.js --pemohon data/pemohon.csv --jadwal data/jadwal.csv --commit   (benar-benar menulis)
//
// Butuh env DATABASE_URL (connection string Neon). Skema (db/schema.sql) harus sudah dijalankan.
// Menolak jalan bila tabel pemohon/jadwal sudah berisi data, kecuali --force.
const fs = require('fs');
const { bacaCsv } = require('../lib/csv');
const { KODE_RE, normalisasiHp } = require('../lib/validate');
const { lokasiByNama, JENIS_BAP, STATUS } = require('../lib/config');
const { validIso } = require('../lib/tanggal');
const jadwalId = (t, lok) => `${t}|${lok}`;

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
  const jadwal = new Map(), pemohon = [], urutan = new Map(), hpAktif = new Map();

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
    let hp = normalisasiHp(String(r['NO HP AKTIF'] || r['NO HP'] || '').replace(/^="?|"$/g, ''));
    if (!/^628\d{7,12}$/.test(hp)) warn.push(`${baris} ${kode}: nomor HP tidak standar (${r['NO HP AKTIF'] || r['NO HP']}) - tetap diimpor`);
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
      if (hpAktif.has(kid)) warn.push(`${baris} ${kode}: HP ${hp} sudah punya booking aktif lain di ${t} (${hpAktif.get(kid)}) - data lama, tetap diimpor`);
      else hpAktif.set(kid, kode);
    }
  });
  for (const j of jadwal.values()) if (j.kuota < j.terpakai) { if (j.tutup) j.kuota = j.terpakai; else warn.push(`jadwal ${j.tanggal} ${j.lokasi}: terpakai ${j.terpakai} > kuota ${j.kuota}`); }
  return { err, warn, jadwal, pemohon, urutan };
}

async function main() {
  const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const fp = arg('--pemohon'), fj = arg('--jadwal'), commit = a.includes('--commit'), force = a.includes('--force');
  if (!fp || !fj) { console.error('Pemakaian: node scripts/import-csv.js --pemohon pemohon.csv --jadwal jadwal.csv [--commit] [--force]'); process.exit(2); }
  const s = siapkan(fs.readFileSync(fp, 'utf8'), fs.readFileSync(fj, 'utf8'));
  console.log(`Pemohon: ${s.pemohon.length} | Jadwal: ${s.jadwal.size} | Tanggal berurutan: ${s.urutan.size}`);
  s.warn.forEach((w) => console.log('PERINGATAN', w));
  s.err.forEach((e) => console.log('GALAT    ', e));
  if (s.err.length) { console.error(`\n${s.err.length} baris bermasalah. Perbaiki CSV lalu jalankan ulang. Tidak ada yang ditulis.`); process.exit(1); }
  if (!commit) { console.log('\nUji coba selesai (tidak ada yang ditulis). Tambahkan --commit untuk menulis.'); return; }

  const { q, tx, tutup } = require('../lib/db');
  try {
    if (!force) {
      for (const t of ['pemohon', 'jadwal']) {
        if ((await q(`select 1 from ${t} limit 1`)).length) { console.error(`Tabel "${t}" sudah berisi data. Impor dibatalkan (pakai --force bila yakin).`); process.exit(1); }
      }
    }
    await tx(async (query) => {
      const J = [...s.jadwal.values()];
      await query(`insert into jadwal (tanggal, lokasi, kuota, terpakai, tutup)
        select * from unnest($1::date[], $2::text[], $3::int[], $4::int[], $5::boolean[])
        on conflict (tanggal, lokasi) do update set kuota = excluded.kuota, terpakai = excluded.terpakai, tutup = excluded.tutup`,
        [J.map((x) => x.tanggal), J.map((x) => x.lokasi), J.map((x) => x.kuota), J.map((x) => x.terpakai), J.map((x) => x.tutup)]);
      for (let i = 0; i < s.pemohon.length; i += 500) {
        const P = s.pemohon.slice(i, i + 500), col = (k) => P.map((x) => x[k]);
        await query(`insert into pemohon (kode, nama, hp, email, jenis, lokasi, tanggal, jam, status, petugas, keterangan, dibuat)
          select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::date[], $8::text[], $9::text[], $10::text[], $11::text[], $12::timestamptz[])
          on conflict (kode) do update set nama = excluded.nama, hp = excluded.hp, email = excluded.email, jenis = excluded.jenis, lokasi = excluded.lokasi,
            tanggal = excluded.tanggal, jam = excluded.jam, status = excluded.status, petugas = excluded.petugas, keterangan = excluded.keterangan, dibuat = excluded.dibuat`,
          [col('kode'), col('nama'), col('hp'), col('email'), col('jenis'), col('lokasi'), col('tanggal'), col('jam'), col('status'), col('petugas'), col('keterangan'),
            P.map((x) => (x.dibuat || new Date()).toISOString())]);
      }
      const U = [...s.urutan.entries()];
      await query(`insert into urutan (tanggal, n) select * from unnest($1::date[], $2::int[])
        on conflict (tanggal) do update set n = greatest(urutan.n, excluded.n)`, [U.map((x) => x[0]), U.map((x) => x[1])]);
    });
    console.log(`Selesai: ${s.pemohon.length} pemohon, ${s.jadwal.size} jadwal.`);
  } finally { await tutup(); }
}

module.exports = { siapkan, tgl };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
