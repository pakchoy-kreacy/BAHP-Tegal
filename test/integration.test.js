// Jalankan: DATABASE_URL=postgres://... npm run test:db   (database KOSONG khusus tes! tabel akan dikosongkan)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

if (!process.env.DATABASE_URL || !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  throw new Error('Tes ini mengosongkan tabel. Jalankan hanya dengan DATABASE_URL ke database lokal.');
}
process.env.ADMIN_PIN = '246810';
process.env.SESSION_SECRET = 'rahasia-tes-rahasia-tes-123';
process.env.RATE_SALT = 'tes';

const { q, tutup } = require('../lib/db');
const { todayWIB, addDays } = require('../lib/tanggal');
const { rencanaJadwal } = require('../lib/jadwal-auto');
const { POLA_LAYANAN } = require('../lib/config');

const h = {
  jadwal: require('../api/jadwal'), booking: require('../api/booking'), status: require('../api/status'),
  login: require('../api/admin/login'), pin: require('../api/admin/pin'),
  pemohon: require('../api/admin/pemohon'), ajadwal: require('../api/admin/jadwal'), otomatis: require('../api/admin/otomatis'),
  rekap: require('../api/admin/rekap'), exp: require('../api/admin/export')
};

let ipSeq = 0;
async function call(handler, { method = 'GET', query, body, cookie, ip, noCsrf } = {}) {
  const headers = { 'x-forwarded-for': ip || `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (cookie) headers.cookie = cookie;
  if (method !== 'GET' && !noCsrf) headers['x-bhap'] = '1';
  const hdr = {}; const res = { statusCode: 200, setHeader: (k, v) => { hdr[k.toLowerCase()] = v; }, end(t) { this.text = t; } };
  await handler({ method, query: query || {}, body, headers }, res);
  let json = null; try { json = JSON.parse(res.text); } catch { /* csv */ }
  return { status: res.statusCode, json, text: res.text, hdr };
}

const T1 = addDays(todayWIB(), 3), T2 = addDays(todayWIB(), 4), T3 = addDays(todayWIB(), 5);
const TEGAL = 'Kantor Imigrasi Tegal', BREBES = 'Beranda Imigrasi Brebes';
const hpSeq = (i) => '0812' + String(10000000 + i);
const data = (i, extra = {}) => ({ nama: 'Pemohon Tes ' + 'ABCDEFGHIJKLMNOP'[i % 16], hp: hpSeq(i), jenis: 'PASPOR HILANG', tanggal: T1, lokasi: TEGAL, ...extra });
const seed = (tanggal, lokasi, kuota) => q('insert into jadwal (tanggal, lokasi, kuota) values ($1,$2,$3)', [tanggal, lokasi, kuota]);
const terpakai = async (t, l) => (await q('select terpakai from jadwal where tanggal=$1 and lokasi=$2', [t, l]))[0].terpakai;
let C; // cookie admin

test('setup: skema + data awal', async () => {
  await q(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  await q('truncate jadwal, pemohon, urutan, pengaturan, ratelimit');
  await seed(T1, TEGAL, 3); await seed(T2, TEGAL, 2); await seed(T3, BREBES, 4);
});

test('GET /api/jadwal publik: tanpa data pribadi, sisa benar', async () => {
  const r = await call(h.jadwal); assert.equal(r.status, 200);
  const j = r.json.data.find((x) => x.tanggal === T1 && x.lokasi === TEGAL);
  assert.deepEqual(Object.keys(j).sort(), ['label', 'lokasi', 'sisa', 'tanggal']);
  assert.equal(j.sisa, 3); assert.match(r.hdr['cache-control'], /s-maxage/);
});

test('validasi server menolak input buruk (400)', async () => {
  for (const patch of [{ nama: 'Al' }, { hp: '123' }, { jenis: 'X' }, { lokasi: 'Jakarta' }, { tanggal: addDays(todayWIB(), 31) }, { tanggal: addDays(todayWIB(), -1) }]) {
    assert.equal((await call(h.booking, { method: 'POST', body: data(0, patch) })).status, 400, JSON.stringify(patch));
  }
  assert.equal((await call(h.booking, { method: 'GET' })).status, 405);
  assert.equal((await call(h.booking, { method: 'POST', body: data(0, { tanggal: addDays(todayWIB(), 10) }) })).status, 400); // tak ada jadwal
});

test('KUOTA: 10 booking bersamaan ke kuota 3 -> tepat 3 berhasil, tidak oversell', async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => call(h.booking, { method: 'POST', body: data(i + 1) })));
  const ok = rs.filter((r) => r.status === 200), penuh = rs.filter((r) => r.status === 409);
  assert.equal(ok.length, 3); assert.equal(penuh.length, 7); assert.match(penuh[0].json.error, /penuh/i);
  const p = T1.replace(/-/g, '');
  assert.deepEqual(ok.map((r) => r.json.data.kode).sort(), [`BAP-${p}-001`, `BAP-${p}-002`, `BAP-${p}-003`]);
  assert.equal(await terpakai(T1, TEGAL), 3);
  assert.equal((await q('select count(*)::int n from pemohon where tanggal=$1', [T1]))[0].n, 3);
  assert.equal((await call(h.jadwal)).json.data.find((x) => x.tanggal === T1 && x.lokasi === TEGAL).sisa, 0);
});

test('Satu HP aktif per tanggal: 4 booking paralel HP sama -> 1 berhasil', async () => {
  const rs = await Promise.all(Array.from({ length: 4 }, () => call(h.booking, { method: 'POST', body: data(50, { tanggal: T3, lokasi: BREBES }) })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 3);
  assert.match(rs.find((r) => r.status === 409).json.error, /sudah punya booking/);
  assert.equal(await terpakai(T3, BREBES), 1);
  assert.equal((await call(h.booking, { method: 'POST', body: data(50, { tanggal: T2 }) })).status, 200); // tanggal lain boleh
});

test('hasil booking: kode, ringkasan, tombol WA admin terisi', async () => {
  const r = await call(h.booking, { method: 'POST', body: data(60, { tanggal: T2, nama: 'Siti Aminah' }) });
  assert.equal(r.status, 200); const d = r.json.data;
  assert.match(d.kode, /^BAP-\d{8}-\d{3}$/); assert.equal(d.status, 'Terkonfirmasi');
  assert.ok(d.waUrl.startsWith('https://wa.me/6285195565657?text='));
  const teks = decodeURIComponent(d.waUrl.split('text=')[1]);
  assert.ok(teks.includes(d.kode) && teks.includes('Siti Aminah') && teks.includes('PASPOR HILANG') && teks.includes(TEGAL));
  assert.equal((await q('select hp from pemohon where kode=$1', [d.kode]))[0].hp, '62' + hpSeq(60).slice(1));
});

test('honeypot: bot dijawab sukses semu, tidak ada yang tersimpan', async () => {
  const sebelum = (await q('select count(*)::int n from pemohon'))[0].n;
  const r = await call(h.booking, { method: 'POST', body: { ...data(70, { tanggal: T3, lokasi: BREBES }), website: 'http://spam' } });
  assert.equal(r.status, 200);
  assert.equal((await q('select count(*)::int n from pemohon'))[0].n, sebelum);
});

test('rate limit per IP: percobaan ke-7 dalam 10 menit -> 429', async () => {
  const st = [];
  for (let i = 0; i < 8; i++) st.push((await call(h.booking, { method: 'POST', ip: '203.0.113.9', body: { website: '' } })).status);
  assert.deepEqual(st.slice(0, 6).every((s) => s === 400), true); assert.deepEqual(st.slice(6), [429, 429]);
});

test('cek status publik: hanya kode, status, tanggal, lokasi', async () => {
  const kode = `BAP-${T1.replace(/-/g, '')}-001`;
  const r = await call(h.status, { query: { kode: kode.toLowerCase() } });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.data).sort(), ['kode', 'lokasi', 'status', 'tanggal', 'tanggalLabel']);
  assert.ok(!/nama|hp|Pemohon|0812|62812/.test(r.text));
  assert.equal((await call(h.status, { query: { kode: 'BAP-20990101-999' } })).status, 404);
  assert.equal((await call(h.status, { query: { kode: "x'; drop table pemohon;--" } })).status, 400);
});

test('LOGIN PIN: tanpa sesi 401, PIN salah 401, benar -> cookie HttpOnly; CSRF; cookie palsu', async () => {
  for (const k of ['pemohon', 'ajadwal', 'otomatis', 'rekap', 'exp']) assert.equal((await call(h[k])).status, 401, k);
  assert.equal((await call(h.login)).status, 401);
  assert.equal((await call(h.login, { method: 'POST', body: { pin: '000000' } })).status, 401);
  assert.equal((await call(h.login, { method: 'POST', body: { pin: '246810' }, noCsrf: true })).status, 403);
  const r = await call(h.login, { method: 'POST', body: { pin: '246810' } });
  assert.equal(r.status, 200);
  const sc = r.hdr['set-cookie']; assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\/api\/admin/);
  C = sc.split(';')[0];
  assert.equal((await call(h.login, { cookie: C })).status, 200);
  assert.equal((await call(h.pemohon, { cookie: C })).status, 200);
  // cookie dipalsukan / diubah
  const [isi] = C.split('=')[1].split('.');
  const palsu = Buffer.from(JSON.stringify({ e: 9999999999, v: 'env' })).toString('base64url');
  assert.equal((await call(h.pemohon, { cookie: `bhap_sess=${palsu}.${C.split('.')[1]}` })).status, 401);
  assert.equal((await call(h.pemohon, { cookie: `bhap_sess=${isi}.abc` })).status, 401);
  // tulis tanpa header anti-CSRF ditolak
  assert.equal((await call(h.pemohon, { method: 'PATCH', cookie: C, body: { kode: 'BAP-20260101-001' }, noCsrf: true })).status, 403);
  // keluar
  const out = await call(h.login, { method: 'DELETE', cookie: C }); assert.match(out.hdr['set-cookie'], /Max-Age=0/);
});

test('LOGIN PIN: brute force dibatasi (429 setelah 5 salah dari satu IP)', async () => {
  const st = [];
  for (let i = 0; i < 7; i++) st.push((await call(h.login, { method: 'POST', ip: '198.51.100.7', body: { pin: '11111' + i } })).status);
  assert.deepEqual(st, [401, 401, 401, 401, 401, 429, 429]);
});

test('admin: filter, pencarian, ubah status/petugas/keterangan', async () => {
  const qr = (query) => call(h.pemohon, { cookie: C, query: { dari: T1, sampai: T3, ...query } });
  assert.ok((await qr({ lokasi: BREBES })).json.data.every((x) => x.lokasi === BREBES));
  assert.ok((await qr({ q: 'siti' })).json.data.every((x) => x.nama === 'Siti Aminah'));
  assert.equal((await qr({ q: hpSeq(60) })).json.data[0].nama, 'Siti Aminah');
  const kode = `BAP-${T1.replace(/-/g, '')}-001`;
  assert.equal((await qr({ q: kode })).json.data[0].kode, kode);
  const inj = await qr({ q: "'; drop table pemohon; --" }); assert.equal(inj.status, 200);
  assert.ok((await q('select count(*)::int n from pemohon'))[0].n > 5);
  const r = await call(h.pemohon, { method: 'PATCH', cookie: C, body: { kode, status: 'Terjadwal', petugas: 'Petugas A', keterangan: 'Datang jam 9' } });
  assert.equal(r.status, 200);
  const [d] = await q('select status, petugas, keterangan from pemohon where kode=$1', [kode]);
  assert.deepEqual([d.status, d.petugas, d.keterangan], ['Terjadwal', 'Petugas A', 'Datang jam 9']);
  assert.equal((await call(h.pemohon, { method: 'PATCH', cookie: C, body: { kode, status: 'Ngawur' } })).status, 400);
  assert.equal((await call(h.pemohon, { method: 'PATCH', cookie: C, body: { kode: 'BAP-20990101-001', status: 'Selesai' } })).status, 404);
  assert.match((await qr({ q: kode })).json.data[0].wa, /^628\d+$/);
});

test('Dibatalkan melepas kuota & nomor HP; aktif lagi gagal bila penuh', async () => {
  const kode = `BAP-${T1.replace(/-/g, '')}-002`;
  const patch = (b) => call(h.pemohon, { method: 'PATCH', cookie: C, body: { kode, ...b } });
  assert.equal((await patch({ status: 'Dibatalkan' })).status, 200);
  assert.equal(await terpakai(T1, TEGAL), 2);
  assert.equal((await call(h.jadwal)).json.data.find((x) => x.tanggal === T1 && x.lokasi === TEGAL).sisa, 1);
  assert.equal((await call(h.booking, { method: 'POST', body: data(80) })).status, 200);
  assert.equal((await patch({ status: 'Dibatalkan', keterangan: 'x' })).status, 200); // tidak mengurangi dua kali
  assert.equal(await terpakai(T1, TEGAL), 3);
  assert.equal((await patch({ status: 'Menunggu' })).status, 409);
  assert.equal((await q('select status from pemohon where kode=$1', [kode]))[0].status, 'Dibatalkan');
  assert.equal(await terpakai(T1, TEGAL), 3);
});

test('admin kelola jadwal: tambah, duplikat, kuota, tutup, hapus', async () => {
  const T9 = addDays(todayWIB(), 20);
  const a = (method, o) => call(h.ajadwal, { method, cookie: C, ...(method === 'GET' || method === 'DELETE' ? { query: o } : { body: o }) });
  assert.equal((await a('POST', { tanggal: T9, lokasi: BREBES, kuota: 5 })).status, 200);
  assert.equal((await a('POST', { tanggal: T9, lokasi: BREBES, kuota: 5 })).status, 409);
  assert.equal((await a('POST', { tanggal: T9, lokasi: BREBES, kuota: -1 })).status, 400);
  assert.equal((await a('POST', { tanggal: addDays(todayWIB(), -2), lokasi: BREBES, kuota: 5 })).status, 400);
  assert.equal((await a('PATCH', { tanggal: T9, lokasi: BREBES, kuota: 9 })).status, 200);
  assert.equal((await a('PATCH', { tanggal: T9, lokasi: BREBES, tutup: true })).status, 200);
  assert.ok(!(await call(h.jadwal)).json.data.some((x) => x.tanggal === T9));
  assert.equal((await call(h.booking, { method: 'POST', body: data(90, { tanggal: T9, lokasi: BREBES }) })).status, 400);
  assert.equal((await a('PATCH', { tanggal: T9, lokasi: BREBES, tutup: false })).status, 200);
  assert.equal((await call(h.booking, { method: 'POST', body: data(90, { tanggal: T9, lokasi: BREBES }) })).status, 200);
  assert.equal((await a('PATCH', { tanggal: T9, lokasi: BREBES, kuota: 0 })).status, 409);
  assert.equal((await a('DELETE', { tanggal: T9, lokasi: BREBES })).status, 409);
  const T8 = addDays(todayWIB(), 21);
  await a('POST', { tanggal: T8, lokasi: TEGAL, kuota: 1 });
  assert.equal((await a('DELETE', { tanggal: T8, lokasi: TEGAL })).status, 200);
  assert.equal((await a('DELETE', { tanggal: T8, lokasi: TEGAL })).status, 404);
  assert.equal((await a('GET', { dari: T9, sampai: T9 })).json.data[0].terpakai, 1);
});

test('isi jadwal otomatis: sesuai pola, hormati libur, tidak menimpa, idempoten', async () => {
  const h0 = todayWIB();
  const libur = rencanaJadwal(h0, 14, POLA_LAYANAN, []).hasil.find((x) => x.lokasi === TEGAL && x.tanggal > addDays(h0, 7));
  assert.equal((await call(h.otomatis, { method: 'PUT', cookie: C, body: { libur: [libur.tanggal] } })).status, 200);
  assert.equal((await call(h.otomatis, { method: 'PUT', cookie: C, body: { libur: ['bukan-tanggal'] } })).status, 400);
  assert.equal((await call(h.otomatis, { cookie: C })).json.data.libur[0], libur.tanggal);
  const sebelum = (await q('select count(*)::int n from jadwal'))[0].n;
  const r1 = await call(h.otomatis, { method: 'POST', cookie: C, body: { hari: 14 } });
  assert.equal(r1.status, 200);
  assert.equal((await q('select count(*)::int n from jadwal'))[0].n - sebelum, r1.json.data.ditambah);
  assert.equal((await q('select count(*)::int n from jadwal where tanggal=$1 and lokasi=$2', [libur.tanggal, TEGAL]))[0].n, 0);
  assert.equal((await q('select kuota from jadwal where tanggal=$1 and lokasi=$2', [T1, TEGAL]))[0].kuota, 3); // tidak ditimpa
  const baru = await q('select lokasi, kuota from jadwal where terpakai=0 and kuota in (8,4)');
  assert.ok(baru.filter((x) => x.lokasi === TEGAL).every((x) => x.kuota === 8) && baru.filter((x) => x.lokasi === BREBES).every((x) => x.kuota === 4));
  assert.equal((await call(h.otomatis, { method: 'POST', cookie: C, body: { hari: 14 } })).json.data.ditambah, 0);
  assert.equal((await call(h.otomatis, { method: 'POST', cookie: C, body: { hari: 999 } })).status, 400);
});

test('rekap per hari & lokasi + ekspor CSV (aman dari formula injection)', async () => {
  const rk = await call(h.rekap, { cookie: C, query: { dari: T1, sampai: T3 } });
  assert.equal(rk.status, 200);
  const r1 = rk.json.data.find((x) => x.tanggal === T1 && x.lokasi === TEGAL);
  assert.deepEqual([r1.kuota, r1.aktif, r1.dibatalkan], [3, 3, 1]);
  assert.equal(r1.menunggu + r1.terkonfirmasi + r1.terjadwal + r1.selesai, r1.aktif);
  assert.equal((await call(h.booking, { method: 'POST', body: data(95, { tanggal: T3, lokasi: BREBES, nama: '=HYPERLINK("http://x.test","klik")' }) })).status, 200);
  const ex = await call(h.exp, { cookie: C, query: { jenis: 'pemohon', dari: T1, sampai: T3 } });
  assert.equal(ex.status, 200);
  assert.match(ex.hdr['content-type'], /text\/csv/); assert.match(ex.hdr['content-disposition'], /attachment; filename="pemohon-bhap-/);
  assert.ok(ex.text.startsWith('﻿ID BAP,NAMA,NO HP,EMAIL,JENIS BAP,LOKASI,TANGGAL,JAM,STATUS,PETUGAS PEMERIKSA,TANGGAL DAFTAR,KETERANGAN'));
  assert.ok(ex.text.includes(`'=HYPERLINK`)); assert.ok(!/(^|,)"?=HYPERLINK/m.test(ex.text));
  assert.ok((await call(h.exp, { cookie: C, query: { jenis: 'rekap', dari: T1, sampai: T3 } })).text.includes('TANGGAL,LOKASI,KUOTA'));
  assert.equal((await call(h.exp, { cookie: C, query: { dari: 'x' } })).status, 400);
});

test('ganti PIN: validasi, sesi lama gugur, sesi ini diperbarui, hash (bukan PIN) tersimpan, PIN cadangan tetap jalan', async () => {
  const ganti = (body, cookie = C) => call(h.pin, { method: 'POST', cookie, body });
  assert.equal((await ganti({ lama: 'salah', baru: '135790' })).status, 401);
  assert.equal((await ganti({ lama: '246810', baru: '12ab' })).status, 400);
  assert.equal((await ganti({ lama: '246810', baru: '123' })).status, 400);
  const r = await ganti({ lama: '246810', baru: '135790' });
  assert.equal(r.status, 200);
  const Cbaru = r.hdr['set-cookie'].split(';')[0];
  assert.equal((await call(h.pemohon, { cookie: C })).status, 401);       // sesi lama gugur
  assert.equal((await call(h.pemohon, { cookie: Cbaru })).status, 200);    // sesi ini tetap
  const [row] = await q("select nilai from pengaturan where kunci='admin_pin'");
  assert.ok(row.nilai.hash.startsWith('scrypt$') && !JSON.stringify(row).includes('135790'));
  assert.equal((await call(h.login, { method: 'POST', body: { pin: '135790' } })).status, 200);  // PIN baru
  assert.equal((await call(h.login, { method: 'POST', body: { pin: '246810' } })).status, 200);  // PIN cadangan (env)
  assert.equal((await call(h.login, { method: 'POST', body: { pin: '000111' } })).status, 401);
});

test.after(async () => { await tutup(); });
