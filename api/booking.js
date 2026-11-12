// Publik: buat booking baru.
const { route } = require('../lib/http');
const { validasiBooking } = require('../lib/validate');
const { buatBooking, waAdminUrl } = require('../lib/booking');
const { batasi } = require('../lib/ratelimit');
const { todayWIB, labelTanggal } = require('../lib/tanggal');

module.exports = route(['POST'], async ({ req, body }) => {
  await batasi(req, 'booking', 6, 600);
  // Honeypot: kolom tersembunyi "website" tidak pernah diisi manusia.
  // Bot dijawab seolah berhasil, tapi tidak ada yang disimpan.
  if (String(body.website || '').trim()) {
    return { kode: 'BAP-00000000-000', nama: '-', jenis: '-', tanggal: '', tanggalLabel: '-', lokasi: '-', waUrl: '' };
  }
  const r = await buatBooking(validasiBooking(body, todayWIB()));
  return {
    kode: r.kode, nama: r.nama, jenis: r.jenis, tanggal: r.tanggal,
    tanggalLabel: labelTanggal(r.tanggal), lokasi: r.lokasi, status: r.status, waUrl: waAdminUrl(r)
  };
});
