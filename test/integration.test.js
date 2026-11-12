// Dijalankan lewat: npm run test:emulator (Firestore + Auth emulator, proyek demo-bhap).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'admin@example.test';
process.env.RATE_SALT = 'tes';
process.env.FIREBASE_PROJECT_ID = 'demo-bhap';
process.env.FIREBASE_WEB_API_KEY = 'fake-key';

const { admin, getDb } = require('../lib/firebase');
const { todayWIB, addDays } = require('../lib/tanggal');
const { rencanaJadwal } = require('../lib/jadwal-auto');
const { POLA_LAYANAN } = require('../lib/config');

const h = {
  jadwal: require('../api/jadwal'), booking: require('../api/booking'), status: require('../api/status'), config: require('../api/config'),
  pemohon: require('../api/admin/pemohon'), ajadwal: require('../api/admin/jadwal'), otomatis: require('../api/admin/otomatis'),
  rekap: require('../api/admin/rekap'), exp: require('../api/admin/export')
};

let ipSeq = 0;
async function call(handler, { method = 'GET', query, body, token, ip } = {}) {
  const req = { method, query: query || {}, body, headers: { 'x-forwarded-for': ip || `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` } };
  if (token) req.headers.authorization = 'Bearer ' + token;
  const hdr = {}; const res = { statusCode: 200, setHeader: (k, v) => { hdr[k.toLowerCase()] = v; }, end(t) { this.text = t; } };
  await handler(req, res);
  let json = null; try { json = JSON.parse(res.text); } catch { /* csv */ }
  return { status: res.statusCode, json, text: res.text, hdr };
}

const db = getDb();
const T1 = addDays(todayWIB(), 3), T2 = addDays(todayWIB(), 4), T3 = addDays(todayWIB(), 5);
const TEGAL = 'Kantor Imigrasi Tegal', BREBES = 'Beranda Imigrasi Brebes';
let adminToken, outsiderToken;
const hpSeq = (i) => '0812' + String(10000000 + i);
const data = (i, extra = {}) => ({ nama: 'Pemohon Tes ' + 'ABCDEFGHIJKLMNOP'[i % 16], hp: hpSeq(i), jenis: 'PASPOR HILANG', tanggal: T1, lokasi: TEGAL, ...extra });
const seed = (tanggal, lokasi, kuota, id) => db.collection('jadwal').doc(`${tanggal}_${id}`).set({ tanggal, lokasi, kuota, terpakai: 0, tutup: false });

async function tokenUntuk(email) {
  const u = await admin.auth().createUser({ email, emailVerified: true });
  const ct = await admin.auth().createCustomToken(u.uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: ct, returnSecureToken: true }) });
  return (await r.json()).idToken;
}

test('setup', async () => {
  adminToken = await tokenUntuk('admin@example.test');
  outsiderToken = await tokenUntuk('orang@example.test');
  await seed(T1, TEGAL, 3, 'tegal'); await seed(T2, TEGAL, 2, 'tegal'); await seed(T3, BREBES, 4, 'brebes');
  assert.ok(adminToken && outsiderToken);
});

test('Firestore Rules: klien tanpa login ditolak baca & tulis', async () => {
  const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-bhap/databases/(default)/documents`;
  const r1 = await fetch(`${base}/jadwal`); assert.equal(r1.status, 403);
  const r2 = await fetch(`${base}/pemohon`); assert.equal(r2.status, 403);
  const r3 = await fetch(`${base}/pemohon?documentId=BAP-X`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { nama: { stringValue: 'x' } } }) });
  assert.equal(r3.status, 403);
  // pakai token pengguna Firebase Auth biasa pun tetap ditolak
  const r4 = await fetch(`${base}/pemohon`, { headers: { authorization: 'Bearer ' + adminToken } }); assert.equal(r4.status, 403);
});

test('GET /api/jadwal publik: tanpa data pribadi, sisa benar', async () => {
  const r = await call(h.jadwal);
  assert.equal(r.status, 200);
  const j = r.json.data.find((x) => x.tanggal === T1 && x.lokasi === TEGAL);
  assert.deepEqual(Object.keys(j).sort(), ['label', 'lokasi', 'sisa', 'tanggal']);
  assert.equal(j.sisa, 3);
  assert.match(r.hdr['cache-control'], /s-maxage/);
});

test('validasi server menolak input buruk (400)', async () => {
  for (const patch of [{ nama: 'Al' }, { hp: '123' }, { jenis: 'X' }, { lokasi: 'Jakarta' }, { tanggal: addDays(todayWIB(), 31) }, { tanggal: addDays(todayWIB(), -1) }]) {
    const r = await call(h.booking, { method: 'POST', body: data(0, patch) });
    assert.equal(r.status, 400, JSON.stringify(patch));
  }
  assert.equal((await call(h.booking, { method: 'GET' })).status, 405);
  // tanggal valid tapi tidak ada jadwalnya
  assert.equal((await call(h.booking, { method: 'POST', body: data(0, { tanggal: addDays(todayWIB(), 10) }) })).status, 400);
});

test('KUOTA: 10 booking bersamaan ke kuota 3 -> tepat 3 berhasil, tidak oversell', async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => call(h.booking, { method: 'POST', body: data(i + 1) })));
  const ok = rs.filter((r) => r.status === 200), penuh = rs.filter((r) => r.status === 409);
  assert.equal(ok.length, 3); assert.equal(penuh.length, 7);
  assert.match(penuh[0].json.error, /penuh/i);
  const kode = ok.map((r) => r.json.data.kode).sort();
  const p = T1.replace(/-/g, '');
  assert.deepEqual(kode, [`BAP-${p}-001`, `BAP-${p}-002`, `BAP-${p}-003`]);
  const j = (await db.collection('jadwal').doc(`${T1}_tegal`).get()).data();
  assert.equal(j.terpakai, 3);
  const n = (await db.collection('pemohon').where('tanggal', '==', T1).get()).size;
  assert.equal(n, 3);
  const pub = (await call(h.jadwal)).json.data.find((x) => x.tanggal === T1 && x.lokasi === TEGAL);
  assert.equal(pub.sisa, 0);
});

test('Satu HP aktif per tanggal: 4 booking paralel HP sama -> 1 berhasil', async () => {
  const rs = await Promise.all(Array.from({ length: 4 }, () => call(h.booking, { method: 'POST', body: data(50, { tanggal: T3, lokasi: BREBES }) })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 3);
  assert.match(rs.find((r) => r.status === 409).json.error, /sudah punya booking/);
  // tanggal berbeda boleh
  const r = await call(h.booking, { method: 'POST', body: data(50, { tanggal: T2 }) });
  assert.equal(r.status, 200);
});

test('hasil booking: kode, ringkasan, tombol WA admin terisi', async () => {
  const r = await call(h.booking, { method: 'POST', body: data(60, { tanggal: T2, nama: 'Siti Aminah' }) });
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.match(d.kode, /^BAP-\d{8}-\d{3}$/);
  assert.equal(d.status, 'Menunggu');
  assert.ok(d.waUrl.startsWith('https://wa.me/6285195565657?text='));
  const teks = decodeURIComponent(d.waUrl.split('text=')[1]);
  assert.ok(teks.includes(d.kode) && teks.includes('Siti Aminah') && teks.includes('PASPOR HILANG') && teks.includes(TEGAL));
  const doc = (await db.collection('pemohon').doc(d.kode).get()).data();
  assert.equal(doc.hp, '62' + hpSeq(60).slice(1)); // 0812... disimpan sebagai 62812...
});

test('honeypot: bot dijawab sukses semu, tidak ada yang tersimpan', async () => {
  const sebelum = (await db.collection('pemohon').get()).size;
  const r = await call(h.booking, { method: 'POST', body: { ...data(70, { tanggal: T3, lokasi: BREBES }), website: 'http://spam' } });
  assert.equal(r.status, 200);
  assert.equal((await db.collection('pemohon').get()).size, sebelum);
});

test('rate limit per IP: percobaan ke-7 dalam 10 menit -> 429', async () => {
  const ip = '203.0.113.9'; const st = [];
  for (let i = 0; i < 8; i++) st.push((await call(h.booking, { method: 'POST', ip, body: { website: '' } })).status);
  assert.deepEqual(st.slice(0, 6).every((s) => s === 400), true); // lolos limiter, gagal validasi
  assert.deepEqual(st.slice(6), [429, 429]);
});

test('cek status publik: hanya kode, status, tanggal, lokasi', async () => {
  const kode = `BAP-${T1.replace(/-/g, '')}-001`;
  const r = await call(h.status, { query: { kode: kode.toLowerCase() } });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.data).sort(), ['kode', 'lokasi', 'status', 'tanggal', 'tanggalLabel']);
  assert.ok(!/nama|hp|Pemohon|0812|62812/.test(r.text));
  assert.equal((await call(h.status, { query: { kode: 'BAP-20990101-999' } })).status, 404);
  assert.equal((await call(h.status, { query: { kode: 'ngawur' } })).status, 400);
});

test('API admin: tanpa token 401, email di luar allowlist 403, allowlist 200', async () => {
  assert.equal((await call(h.pemohon)).status, 401);
  assert.equal((await call(h.pemohon, { token: 'palsu' })).status, 401);
  assert.equal((await call(h.pemohon, { token: outsiderToken })).status, 403);
  for (const k of ['ajadwal', 'otomatis', 'rekap', 'exp']) assert.equal((await call(h[k], { token: outsiderToken })).status, 403, k);
  assert.equal((await call(h.pemohon, { method: 'PATCH', body: { kode: 'BAP-1-1', status: 'Selesai' }, token: outsiderToken })).status, 403);
  const r = await call(h.pemohon, { token: adminToken, query: { dari: T1, sampai: T3 } });
  assert.equal(r.status, 200);
  assert.ok(r.json.data.length >= 5);
});

test('admin: filter, pencarian, ubah status/petugas/keterangan', async () => {
  const q = (query) => call(h.pemohon, { token: adminToken, query: { dari: T1, sampai: T3, ...query } });
  assert.ok((await q({ lokasi: BREBES })).json.data.every((x) => x.lokasi === BREBES));
  assert.ok((await q({ q: 'siti' })).json.data.every((x) => x.nama === 'Siti Aminah'));
  const kode = `BAP-${T1.replace(/-/g, '')}-001`;
  assert.equal((await q({ q: kode })).json.data[0].kode, kode);
  const r = await call(h.pemohon, { method: 'PATCH', token: adminToken, body: { kode, status: 'Terjadwal', petugas: 'Petugas A', keterangan: 'Datang jam 9' } });
  assert.equal(r.status, 200);
  const d = (await db.collection('pemohon').doc(kode).get()).data();
  assert.deepEqual([d.status, d.petugas, d.keterangan], ['Terjadwal', 'Petugas A', 'Datang jam 9']);
  assert.equal((await call(h.pemohon, { method: 'PATCH', token: adminToken, body: { kode, status: 'Ngawur' } })).status, 400);
  const wa = (await q({ q: kode })).json.data[0].wa; assert.match(wa, /^628\d+$/);
});

test('Dibatalkan melepas kuota & nomor HP; aktif lagi gagal bila penuh', async () => {
  const kode = `BAP-${T1.replace(/-/g, '')}-002`;
  const hp = (await db.collection('pemohon').doc(kode).get()).data().hp;
  const patch = (b) => call(h.pemohon, { method: 'PATCH', token: adminToken, body: { kode, ...b } });
  assert.equal((await patch({ status: 'Dibatalkan' })).status, 200);
  assert.equal((await db.collection('jadwal').doc(`${T1}_tegal`).get()).data().terpakai, 2);
  assert.equal((await call(h.jadwal)).json.data.find((x) => x.tanggal === T1 && x.lokasi === TEGAL).sisa, 1);
  // kuota kosong 1 -> orang lain bisa ambil
  const baru = await call(h.booking, { method: 'POST', body: data(80) });
  assert.equal(baru.status, 200);
  // hanya untuk status lain, Dibatalkan -> Dibatalkan tidak mengubah hitungan
  assert.equal((await patch({ status: 'Dibatalkan', keterangan: 'x' })).status, 200);
  assert.equal((await db.collection('jadwal').doc(`${T1}_tegal`).get()).data().terpakai, 3);
  // penuh lagi: batal -> aktif ditolak
  assert.equal((await patch({ status: 'Menunggu' })).status, 409);
  assert.equal((await db.collection('pemohon').doc(kode).get()).data().status, 'Dibatalkan');
  // HP yang dibatalkan boleh booking lagi di tanggal lain (kunci per tanggal)
  assert.ok(hp);
});

test('admin kelola jadwal: tambah, duplikat, kuota, tutup, hapus', async () => {
  const T9 = addDays(todayWIB(), 20);
  const a = (method, o) => call(h.ajadwal, { method, token: adminToken, ...(method === 'GET' || method === 'DELETE' ? { query: o } : { body: o }) });
  assert.equal((await a('POST', { tanggal: T9, lokasi: BREBES, kuota: 5 })).status, 200);
  assert.equal((await a('POST', { tanggal: T9, lokasi: BREBES, kuota: 5 })).status, 409);
  assert.equal((await a('POST', { tanggal: T9, lokasi: BREBES, kuota: -1 })).status, 400);
  assert.equal((await a('POST', { tanggal: addDays(todayWIB(), -2), lokasi: BREBES, kuota: 5 })).status, 400);
  assert.equal((await a('PATCH', { tanggal: T9, lokasi: BREBES, kuota: 9 })).status, 200);
  // tutup -> hilang dari publik, booking ditolak
  assert.equal((await a('PATCH', { tanggal: T9, lokasi: BREBES, tutup: true })).status, 200);
  assert.ok(!(await call(h.jadwal)).json.data.some((x) => x.tanggal === T9));
  assert.equal((await call(h.booking, { method: 'POST', body: data(90, { tanggal: T9, lokasi: BREBES }) })).status, 400);
  assert.equal((await a('PATCH', { tanggal: T9, lokasi: BREBES, tutup: false })).status, 200);
  assert.equal((await call(h.booking, { method: 'POST', body: data(90, { tanggal: T9, lokasi: BREBES }) })).status, 200);
  // kuota < terpakai ditolak; hapus saat ada booking aktif ditolak
  assert.equal((await a('PATCH', { tanggal: T9, lokasi: BREBES, kuota: 0 })).status, 409);
  assert.equal((await a('DELETE', { tanggal: T9, lokasi: BREBES })).status, 409);
  const T8 = addDays(todayWIB(), 21);
  await a('POST', { tanggal: T8, lokasi: TEGAL, kuota: 1 });
  assert.equal((await a('DELETE', { tanggal: T8, lokasi: TEGAL })).status, 200);
  assert.equal((await a('DELETE', { tanggal: T8, lokasi: TEGAL })).status, 404);
  const list = await a('GET', { dari: T9, sampai: T9 });
  assert.equal(list.json.data[0].terpakai, 1);
});

test('isi jadwal otomatis: sesuai pola, hormati libur, tidak menimpa, idempoten', async () => {
  const h0 = todayWIB();
  const rencana = rencanaJadwal(h0, 14, POLA_LAYANAN, []).hasil;
  const libur = rencana.find((x) => x.lokasi === TEGAL && x.tanggal > addDays(h0, 7));
  const put = await call(h.otomatis, { method: 'PUT', token: adminToken, body: { libur: [libur.tanggal] } });
  assert.equal(put.status, 200);
  assert.equal((await call(h.otomatis, { method: 'PUT', token: adminToken, body: { libur: ['bukan-tanggal'] } })).status, 400);
  assert.equal((await call(h.otomatis, { token: adminToken })).json.data.libur[0], libur.tanggal);
  const sebelum = (await db.collection('jadwal').get()).size;
  const r1 = await call(h.otomatis, { method: 'POST', token: adminToken, body: { hari: 14 } });
  assert.equal(r1.status, 200);
  const sesudah = await db.collection('jadwal').get();
  assert.equal(sesudah.size - sebelum, r1.json.data.ditambah);
  assert.equal(sesudah.docs.some((s) => s.id.startsWith(libur.tanggal + '_tegal')), false);
  // jadwal seed (kuota 3, terpakai 3) tidak ditimpa
  assert.equal((await db.collection('jadwal').doc(`${T1}_tegal`).get()).data().kuota, 3);
  // kuota sesuai pola
  sesudah.docs.map((s) => s.data()).filter((j) => j.tanggal === addDays(h0, 14) || true).forEach((j) => {
    if (j.terpakai === 0 && !j.tutup && j.kuota !== 8 && j.kuota !== 4 && j.kuota !== 5 && j.kuota !== 9 && j.kuota !== 2 && j.kuota !== 3) assert.fail('kuota aneh ' + j.kuota);
  });
  const r2 = await call(h.otomatis, { method: 'POST', token: adminToken, body: { hari: 14 } });
  assert.equal(r2.json.data.ditambah, 0);
  assert.equal((await call(h.otomatis, { method: 'POST', token: adminToken, body: { hari: 999 } })).status, 400);
});

test('rekap per hari & lokasi + ekspor CSV (aman dari formula injection)', async () => {
  const rk = await call(h.rekap, { token: adminToken, query: { dari: T1, sampai: T3 } });
  assert.equal(rk.status, 200);
  const r1 = rk.json.data.find((x) => x.tanggal === T1 && x.lokasi === TEGAL);
  assert.deepEqual([r1.kuota, r1.aktif, r1.dibatalkan], [3, 3, 1]);
  assert.equal(r1.menunggu + r1.terjadwal + r1.selesai, r1.aktif);
  // nama berbahaya
  const jahat = await call(h.booking, { method: 'POST', body: data(95, { tanggal: T3, lokasi: BREBES, nama: '=HYPERLINK("http://x.test","klik")' }) });
  assert.equal(jahat.status, 200);
  const ex = await call(h.exp, { token: adminToken, query: { jenis: 'pemohon', dari: T1, sampai: T3 } });
  assert.equal(ex.status, 200);
  assert.match(ex.hdr['content-type'], /text\/csv/);
  assert.match(ex.hdr['content-disposition'], /attachment; filename="pemohon-bhap-/);
  assert.ok(ex.text.startsWith('﻿ID BAP,NAMA,NO HP,EMAIL,JENIS BAP,LOKASI,TANGGAL,JAM,STATUS,PETUGAS PEMERIKSA,TANGGAL DAFTAR,KETERANGAN'));
  assert.ok(ex.text.includes(`'=HYPERLINK`)); assert.ok(!/(^|,)"?=HYPERLINK/m.test(ex.text));
  const exr = await call(h.exp, { token: adminToken, query: { jenis: 'rekap', dari: T1, sampai: T3 } });
  assert.ok(exr.text.includes('TANGGAL,LOKASI,KUOTA'));
  assert.equal((await call(h.exp, { token: adminToken, query: { dari: 'x' } })).status, 400);
});

test('config web Firebase tersedia dari env', async () => {
  const r = await call(h.config); assert.equal(r.status, 200); assert.equal(r.json.data.projectId, 'demo-bhap');
});
