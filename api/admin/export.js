// Ekspor CSV: ?jenis=pemohon|rekap&dari&sampai&lokasi&status
const { route, send, HANDLED } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { rentang, ambilPemohon, ambilRekap } = require('../../lib/query');
const { keCsv } = require('../../lib/csv');
const { todayWIB, addDays } = require('../../lib/tanggal');

module.exports = route(['GET'], async ({ req, res, query }) => {
  await requireAdmin(req);
  const h = todayWIB();
  const r = rentang(query, addDays(h, -30), addDays(h, 30));
  let csv, nama;
  if (query.jenis === 'rekap') {
    const rows = await ambilRekap({ ...r, lokasi: query.lokasi });
    csv = keCsv(['TANGGAL', 'LOKASI', 'KUOTA', 'MENUNGGU', 'TERJADWAL', 'SELESAI', 'DIBATALKAN', 'AKTIF'],
      rows.map((x) => [x.tanggal, x.lokasi, x.kuota, x.menunggu, x.terjadwal, x.selesai, x.dibatalkan, x.aktif]));
    nama = `rekap-bhap-${r.dari}_${r.sampai}.csv`;
  } else {
    const rows = await ambilPemohon({ ...r, lokasi: query.lokasi, status: query.status, q: query.q });
    csv = keCsv(['ID BAP', 'NAMA', 'NO HP', 'EMAIL', 'JENIS BAP', 'LOKASI', 'TANGGAL', 'JAM', 'STATUS', 'PETUGAS PEMERIKSA', 'TANGGAL DAFTAR', 'KETERANGAN'],
      rows.map((x) => [x.kode, x.nama, x.hp, x.email, x.jenis, x.lokasi, x.tanggal, x.jam, x.status, x.petugas, x.dibuat, x.keterangan]), [2]);
    nama = `pemohon-bhap-${r.dari}_${r.sampai}.csv`;
  }
  res.setHeader('Content-Disposition', `attachment; filename="${nama}"`);
  send(res, 200, csv, 'text/csv; charset=utf-8');
  return HANDLED;
});
