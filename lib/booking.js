const { tx, q } = require('./db');
const { HttpError } = require('./http');
const { STATUS, WA_ADMIN_DEFAULT, PESAN_DOKUMEN } = require('./config');
const { labelTanggal } = require('./tanggal');

// Kunci per (tanggal, HP) selama transaksi: dua permintaan bersamaan dgn HP sama diproses bergantian.
const kunciHp = (query, tanggal, hp) => query('select pg_advisory_xact_lock(hashtext($1))', [`hp|${tanggal}|${hp}`]);

// Pengaturan admin: booking baru langsung "Terkonfirmasi" (default) atau "Menunggu".
async function bacaAutoKonfirmasi() {
  const [r] = await q("select nilai from pengaturan where kunci = 'auto_konfirmasi'");
  return r ? r.nilai === true : true;
}

// Booking baru: semua cek + tulis dalam SATU transaksi.
// Kuota diambil dengan UPDATE atomik (hanya berhasil bila terpakai < kuota), jadi tidak bisa oversell.
async function buatBooking({ nama, hp, jenis, tanggal, lokasi }) {
  const status = (await bacaAutoKonfirmasi()) ? 'Terkonfirmasi' : 'Menunggu';
  return tx(async (query) => {
    await kunciHp(query, tanggal, hp);
    const dup = await query("select 1 from pemohon where tanggal = $1 and hp = $2 and status <> 'Dibatalkan' limit 1", [tanggal, hp]);
    if (dup.rowCount) throw new HttpError(409, 'Nomor HP ini sudah punya booking aktif di tanggal tersebut.');
    const ambil = await query(
      'update jadwal set terpakai = terpakai + 1 where tanggal = $1 and lokasi = $2 and not tutup and terpakai < kuota',
      [tanggal, lokasi]);
    if (!ambil.rowCount) {
      const ada = await query('select tutup from jadwal where tanggal = $1 and lokasi = $2', [tanggal, lokasi]);
      if (!ada.rowCount || ada.rows[0].tutup) throw new HttpError(400, 'Jadwal tidak tersedia. Pilih tanggal lain.');
      throw new HttpError(409, 'Kuota hari itu sudah penuh. Pilih tanggal lain.');
    }
    const { rows: [u] } = await query(
      'insert into urutan (tanggal, n) values ($1, 1) on conflict (tanggal) do update set n = urutan.n + 1 returning n', [tanggal]);
    const kode = `BAP-${tanggal.replace(/-/g, '')}-${String(u.n).padStart(3, '0')}`;
    await query('insert into pemohon (kode, nama, hp, jenis, lokasi, tanggal, status) values ($1,$2,$3,$4,$5,$6,$7)',
      [kode, nama, hp, jenis, lokasi, tanggal, status]);
    return { kode, nama, hp, jenis, tanggal, lokasi, status };
  });
}

function waAdminUrl(r) {
  const pesan = [
    'Halo Admin BHAP, saya sudah booking:',
    `Kode: ${r.kode}`, `Nama: ${r.nama}`, `Jenis BAP: ${r.jenis}`,
    `Hari: ${labelTanggal(r.tanggal)}`, `Lokasi: ${r.lokasi}`,
    '',
    PESAN_DOKUMEN
  ].join('\n');
  const no = (process.env.WA_ADMIN || WA_ADMIN_DEFAULT).replace(/\D/g, '');
  return `https://wa.me/${no}?text=${encodeURIComponent(pesan)}`;
}

// Admin ubah status / petugas / keterangan. Dibatalkan melepas kuota; aktif lagi mengambil kuota (gagal bila penuh).
async function ubahPemohon(kode, patch) {
  return tx(async (query) => {
    const { rows: [d] } = await query('select kode, hp, status, lokasi, tanggal from pemohon where kode = $1 for update', [kode]);
    if (!d) throw new HttpError(404, 'Pemohon tidak ditemukan.');
    let status = d.status;
    if (patch.status !== undefined) {
      if (!STATUS.includes(patch.status)) throw new HttpError(400, 'Status tidak valid.');
      status = patch.status;
    }
    const dulu = d.status !== 'Dibatalkan', kini = status !== 'Dibatalkan';
    if (dulu && !kini) {
      await query('update jadwal set terpakai = greatest(terpakai - 1, 0) where tanggal = $1 and lokasi = $2', [d.tanggal, d.lokasi]);
    } else if (!dulu && kini) {
      await kunciHp(query, d.tanggal, d.hp);
      const dup = await query("select 1 from pemohon where tanggal = $1 and hp = $2 and status <> 'Dibatalkan' and kode <> $3 limit 1", [d.tanggal, d.hp, kode]);
      if (dup.rowCount) throw new HttpError(409, 'Nomor HP ini sudah punya booking aktif lain di tanggal tersebut.');
      const j = await query('select 1 from jadwal where tanggal = $1 and lokasi = $2', [d.tanggal, d.lokasi]);
      if (j.rowCount) {
        const ambil = await query('update jadwal set terpakai = terpakai + 1 where tanggal = $1 and lokasi = $2 and terpakai < kuota', [d.tanggal, d.lokasi]);
        if (!ambil.rowCount) throw new HttpError(409, 'Kuota tanggal itu sudah penuh.');
      }
    }
    const petugas = patch.petugas !== undefined ? String(patch.petugas).trim().slice(0, 100) : null;
    const keterangan = patch.keterangan !== undefined ? String(patch.keterangan).trim().slice(0, 500) : null;
    await query('update pemohon set status = $2, petugas = coalesce($3, petugas), keterangan = coalesce($4, keterangan) where kode = $1',
      [kode, status, petugas, keterangan]);
    return { kode, status };
  });
}

module.exports = { bacaAutoKonfirmasi, buatBooking, waAdminUrl, ubahPemohon };

