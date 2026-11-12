const test = require('node:test');
const assert = require('node:assert/strict');
const { validasiHp, normalisasiHp, validasiBooking, bersihkanNama } = require('../lib/validate');
const { todayWIB, addDays, labelTanggal, validIso, hariKe } = require('../lib/tanggal');
const { rencanaJadwal } = require('../lib/jadwal-auto');
const { keCsv, bacaCsv } = require('../lib/csv');
const { POLA_LAYANAN } = require('../lib/config');

test('normalisasi & validasi HP', () => {
  assert.equal(validasiHp('0812-3456-7890'), '6281234567890');
  assert.equal(validasiHp('+62 812 3456 7890'), '6281234567890');
  assert.equal(validasiHp('81234567890'), '6281234567890');
  assert.equal(validasiHp('08123'), null);            // < 9 digit
  assert.equal(validasiHp('0812345678901234'), null); // > 14 digit
  assert.equal(validasiHp('021123456789'), null);     // telepon rumah ditolak (harus seluler 08xx)
});
test('HP: huruf/kosong ditolak', () => {
  assert.equal(validasiHp(''), null);
  assert.equal(validasiHp('abc'), null);
  assert.equal(normalisasiHp('08123456789'), '628123456789');
});

test('tanggal', () => {
  assert.equal(todayWIB(Date.parse('2026-11-12T20:00:00Z')), '2026-11-13'); // 03.00 WIB esok hari
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(hariKe('2026-11-16'), 1); // Senin
  assert.equal(labelTanggal('2026-11-16'), 'Senin, 16 November 2026');
  assert.ok(!validIso('2026-02-30')); assert.ok(validIso('2026-02-28'));
});

const OK = { nama: 'Budi Santoso', hp: '081234567890', jenis: 'paspor hilang', lokasi: 'kantor imigrasi tegal', tanggal: '2026-11-20' };
test('validasiBooking: valid', () => {
  const r = validasiBooking(OK, '2026-11-12');
  assert.deepEqual(r, { nama: 'Budi Santoso', hp: '6281234567890', jenis: 'PASPOR HILANG', lokasi: 'Kantor Imigrasi Tegal', tanggal: '2026-11-20' });
});
test('validasiBooking: tolak input buruk', () => {
  const t = (patch) => assert.throws(() => validasiBooking({ ...OK, ...patch }, '2026-11-12'), (e) => e.status === 400);
  t({ nama: 'Al' }); t({ nama: '12345' }); t({ nama: 'a'.repeat(101) });
  t({ hp: '123' }); t({ jenis: 'PASPOR BARU' }); t({ lokasi: 'Jakarta' });
  t({ tanggal: '2026-11-11' });           // lewat
  t({ tanggal: '2026-12-13' });           // > 30 hari
  t({ tanggal: '20-11-2026' });
});
test('bersihkanNama', () => assert.equal(bersihkanNama('  Budi \n\t  S  '), 'Budi S'));

test('rencanaJadwal: pola Tegal Sen-Jum 8, Brebes Sen+Kam 4, libur dilewati', () => {
  // 2026-11-16 Senin .. 2026-11-22 Minggu
  const { hasil, dilewati } = rencanaJadwal('2026-11-16', 6, POLA_LAYANAN, ['2026-11-18']);
  const tegal = hasil.filter((x) => x.lokasi === 'Kantor Imigrasi Tegal').map((x) => x.tanggal);
  const brebes = hasil.filter((x) => x.lokasi === 'Beranda Imigrasi Brebes').map((x) => x.tanggal);
  assert.deepEqual(tegal, ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20']); // Rabu 18 libur
  assert.deepEqual(brebes, ['2026-11-16', '2026-11-19']);
  assert.ok(hasil.filter((x) => x.lokasi.includes('Tegal')).every((x) => x.kuota === 8));
  assert.ok(hasil.filter((x) => x.lokasi.includes('Brebes')).every((x) => x.kuota === 4));
  assert.deepEqual(dilewati, ['2026-11-18']);
});

test('CSV: round trip, kutip, injection, HP teks', () => {
  const csv = keCsv(['A', 'B'], [['=1+1', 'a,"b"'], ['x', '6281234567890']], [1]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes("'=1+1"));
  const rows = bacaCsv(csv);
  assert.deepEqual(rows[0], ['A', 'B']);
  assert.deepEqual(rows[1], ["'=1+1", 'a,"b"']);
  assert.equal(rows[2][1], '="6281234567890"');
  assert.deepEqual(bacaCsv('a,b\r\n"x\ny",2\r\n'), [['a', 'b'], ['x\ny', '2']]);
});
