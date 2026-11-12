const { FieldValue, Timestamp } = require('./firebase');
const { HttpError } = require('./http');
const { lokasiByNama, LOKASI, STATUS, WA_ADMIN_DEFAULT } = require('./config');
const { labelTanggal } = require('./tanggal');

function jadwalId(tanggal, lokasiNama) {
  const l = lokasiByNama(lokasiNama);
  if (!l) throw new HttpError(400, 'Lokasi tidak valid.');
  return `${tanggal}_${l.id}`;
}

// Booking baru. Semua cek + tulis dalam SATU transaksi Firestore,
// jadi dua orang yang booking bersamaan tidak bisa melewati kuota.
async function buatBooking(db, { nama, hp, jenis, tanggal, lokasi }) {
  const jadwalRef = db.collection('jadwal').doc(jadwalId(tanggal, lokasi));
  const urutRef = db.collection('urutan').doc(tanggal);
  const kunciRef = db.collection('kunci').doc(`${tanggal}_${hp}`);
  return db.runTransaction(async (tx) => {
    const [j, u, k] = await tx.getAll(jadwalRef, urutRef, kunciRef);
    if (!j.exists || j.data().tutup) throw new HttpError(400, 'Jadwal tidak tersedia. Pilih tanggal lain.');
    const jd = j.data();
    if ((jd.terpakai || 0) >= jd.kuota) throw new HttpError(409, 'Kuota hari itu sudah penuh. Pilih tanggal lain.');
    if (k.exists) throw new HttpError(409, 'Nomor HP ini sudah punya booking aktif di tanggal tersebut.');
    const n = (u.exists ? u.data().n : 0) + 1;
    const kode = `BAP-${tanggal.replace(/-/g, '')}-${String(n).padStart(3, '0')}`;
    tx.set(db.collection('pemohon').doc(kode), {
      kode, nama, hp, email: '', jenis, lokasi, tanggal, jam: '',
      status: 'Menunggu', petugas: '', keterangan: '', dibuat: Timestamp.now()
    });
    tx.set(urutRef, { n });
    tx.update(jadwalRef, { terpakai: FieldValue.increment(1) });
    tx.set(kunciRef, { kode });
    return { kode, nama, hp, jenis, tanggal, lokasi };
  });
}

function waAdminUrl(r) {
  const pesan = [
    'Halo Admin BHAP, saya sudah booking:',
    `Kode: ${r.kode}`,
    `Nama: ${r.nama}`,
    `Jenis BAP: ${r.jenis}`,
    `Hari: ${labelTanggal(r.tanggal)}`,
    `Lokasi: ${r.lokasi}`,
    'Mohon konfirmasi. Terima kasih.'
  ].join('\n');
  const no = (process.env.WA_ADMIN || WA_ADMIN_DEFAULT).replace(/\D/g, '');
  return `https://wa.me/${no}?text=${encodeURIComponent(pesan)}`;
}

// Admin ubah status / petugas / keterangan. Status Dibatalkan melepas kuota
// dan kunci nomor HP; kembali aktif mengambil lagi (gagal bila penuh).
async function ubahPemohon(db, kode, patch) {
  const ref = db.collection('pemohon').doc(kode);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(ref);
    if (!p.exists) throw new HttpError(404, 'Pemohon tidak ditemukan.');
    const d = p.data();
    const upd = {};
    if (patch.petugas !== undefined) upd.petugas = String(patch.petugas).trim().slice(0, 100);
    if (patch.keterangan !== undefined) upd.keterangan = String(patch.keterangan).trim().slice(0, 500);
    const jRef = db.collection('jadwal').doc(jadwalId(d.tanggal, d.lokasi));
    const kRef = db.collection('kunci').doc(`${d.tanggal}_${d.hp}`);
    let status = d.status;
    if (patch.status !== undefined) {
      if (!STATUS.includes(patch.status)) throw new HttpError(400, 'Status tidak valid.');
      status = patch.status;
    }
    const [j, k] = await tx.getAll(jRef, kRef);
    const dulu = d.status !== 'Dibatalkan', kini = status !== 'Dibatalkan';
    if (dulu && !kini) {
      if (j.exists && (j.data().terpakai || 0) > 0) tx.update(jRef, { terpakai: FieldValue.increment(-1) });
      if (k.exists && k.data().kode === kode) tx.delete(kRef);
    } else if (!dulu && kini) {
      if (k.exists && k.data().kode !== kode) throw new HttpError(409, 'Nomor HP ini sudah punya booking aktif lain di tanggal tersebut.');
      if (j.exists) {
        if ((j.data().terpakai || 0) >= j.data().kuota) throw new HttpError(409, 'Kuota tanggal itu sudah penuh.');
        tx.update(jRef, { terpakai: FieldValue.increment(1) });
      }
      tx.set(kRef, { kode });
    }
    upd.status = status;
    tx.update(ref, upd);
    return { kode, ...upd };
  });
}

module.exports = { buatBooking, waAdminUrl, ubahPemohon, jadwalId, LOKASI };
