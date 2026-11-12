const { tx, q } = require('./db');
const { HttpError } = require('./http');
const { STATUS, WA_ADMIN_DEFAULT, PESAN_DOKUMEN, JENIS_BAP, lokasiByNama } = require('./config');
const { bersihkanNama, validasiHp, normalisasiHp, KODE_RE } = require('./validate');
const { labelTanggal, validIso, tanggalBebas } = require('./tanggal');

// Kunci per (tanggal, HP) selama transaksi: dua permintaan bersamaan dgn HP sama diproses bergantian.
const kunciHp = (query, tanggal, hp) => query('select pg_advisory_xact_lock(hashtext($1))', [`hp|${tanggal}|${hp}`]);

// Pengaturan admin: booking baru langsung "Terkonfirmasi" (default) atau "Menunggu".
async function bacaAutoKonfirmasi() {
  const [r] = await q("select nilai from pengaturan where kunci = 'auto_konfirmasi'");
  return r ? r.nilai === true : true;
}

// Teks "dokumen yang harus dibawa": bisa diubah admin; kosong = bawaan di config.js.
async function bacaPesanDokumen() {
  const [r] = await q("select nilai from pengaturan where kunci = 'pesan_dokumen'");
  return r && typeof r.nilai === 'string' && r.nilai.trim() ? r.nilai : PESAN_DOKUMEN;
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
    'Mohon konfirmasi. Terima kasih.'
  ].join('\n');
  const no = (process.env.WA_ADMIN || WA_ADMIN_DEFAULT).replace(/\D/g, '');
  return `https://wa.me/${no}?text=${encodeURIComponent(pesan)}`;
}

// ---------- Admin: tambah / ubah / hapus / impor ----------
// Hitung ulang "terpakai" dari tabel pemohon untuk pasangan (tanggal, lokasi).
// Bila jumlah aktif naik melebihi kuota: tolak (409), kecuali paksa = kuota ikut dinaikkan.
async function hitungUlang(query, pasangan, paksa) {
  const unik = [...new Map(pasangan.map(([t, l]) => [t + '|' + l, [t, l]])).values()];
  for (const [t, l] of unik) {
    const { rows: [c] } = await query("select count(*)::int n from pemohon where tanggal = $1 and lokasi = $2 and status <> 'Dibatalkan'", [t, l]);
    const { rows: [j] } = await query('select kuota, terpakai from jadwal where tanggal = $1 and lokasi = $2 for update', [t, l]);
    if (!j) {
      if (c.n) await query('insert into jadwal (tanggal, lokasi, kuota, terpakai, tutup) values ($1, $2, $3, $3, true)', [t, l, c.n]);
      continue;
    }
    let kuota = j.kuota;
    if (c.n > kuota && c.n > j.terpakai) {
      if (!paksa) throw new HttpError(409, `Kuota ${labelTanggal(t)} di ${l} sudah penuh (${kuota}).`);
      kuota = c.n;
    }
    await query('update jadwal set terpakai = $3, kuota = $4 where tanggal = $1 and lokasi = $2', [t, l, c.n, kuota]);
  }
}

async function buatKode(query, tanggal) {
  const { rows: [u] } = await query(
    'insert into urutan (tanggal, n) values ($1, 1) on conflict (tanggal) do update set n = urutan.n + 1 returning n', [tanggal]);
  return `BAP-${tanggal.replace(/-/g, '')}-${String(u.n).padStart(3, '0')}`;
}

const teks = (v, maks) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maks);

// Validasi data admin. sebagian = true: hanya kolom yang dikirim yang dicek.
function validasiAdmin(src, sebagian) {
  const o = {}, ada = (k) => !sebagian || src[k] !== undefined;
  if (ada('nama')) { o.nama = bersihkanNama(src.nama); if ((o.nama.match(/\p{L}/gu) || []).length < 3 || o.nama.length > 100) throw new HttpError(400, 'Nama minimal 3 huruf.'); }
  if (ada('hp')) {
    const d = String(src.hp || '').replace(/\D/g, '');
    if (d.length < 9 || d.length > 15) throw new HttpError(400, 'Nomor HP tidak valid.');
    o.hp = validasiHp(d) || normalisasiHp(d);
  }
  if (ada('jenis')) { o.jenis = String(src.jenis || '').trim().toUpperCase(); if (!JENIS_BAP.includes(o.jenis)) throw new HttpError(400, 'Jenis BAP tidak valid.'); }
  if (ada('lokasi')) { const l = lokasiByNama(src.lokasi); if (!l) throw new HttpError(400, 'Lokasi tidak valid.'); o.lokasi = l.nama; }
  if (ada('tanggal')) { o.tanggal = tanggalBebas(src.tanggal); if (!o.tanggal) throw new HttpError(400, 'Tanggal tidak valid.'); }
  if (ada('status')) { o.status = STATUS.find((x) => x.toLowerCase() === String(src.status || '').trim().toLowerCase()); if (!o.status) throw new HttpError(400, 'Status tidak valid.'); }
  if (src.email !== undefined || !sebagian) o.email = teks(src.email, 100);
  if (src.jam !== undefined || !sebagian) o.jam = teks(src.jam, 20);
  if (src.petugas !== undefined || !sebagian) o.petugas = teks(src.petugas, 100);
  if (src.keterangan !== undefined || !sebagian) o.keterangan = teks(src.keterangan, 500);
  return o;
}

async function cekHpGanda(query, d, kode) {
  if (d.status === 'Dibatalkan') return;
  await kunciHp(query, d.tanggal, d.hp);
  const dup = await query("select kode from pemohon where tanggal = $1 and hp = $2 and status <> 'Dibatalkan' and kode <> $3 limit 1", [d.tanggal, d.hp, kode || '']);
  if (dup.rowCount) throw new HttpError(409, `Nomor HP ini sudah punya booking aktif lain di tanggal tersebut (${dup.rows[0].kode}).`);
}

async function tambahPemohon(src, paksa) {
  const d = validasiAdmin({ status: 'Terkonfirmasi', ...src }, false);
  return tx(async (query) => {
    await cekHpGanda(query, d);
    const kode = await buatKode(query, d.tanggal);
    await query(`insert into pemohon (kode, nama, hp, email, jenis, lokasi, tanggal, jam, status, petugas, keterangan)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [kode, d.nama, d.hp, d.email, d.jenis, d.lokasi, d.tanggal, d.jam, d.status, d.petugas, d.keterangan]);
    await hitungUlang(query, [[d.tanggal, d.lokasi]], paksa);
    return { kode, status: d.status };
  });
}

// Admin ubah data pemohon (kolom apa saja). Kuota ikut dihitung ulang.
async function ubahPemohon(kode, patch, paksa) {
  const p = validasiAdmin(patch, true);
  return tx(async (query) => {
    const { rows: [lama] } = await query('select * from pemohon where kode = $1 for update', [kode]);
    if (!lama) throw new HttpError(404, 'Pemohon tidak ditemukan.');
    const d = { ...lama, ...p };
    const tLama = typeof lama.tanggal === 'string' ? lama.tanggal : lama.tanggal.toISOString().slice(0, 10);
    const pindah = d.tanggal !== tLama || d.lokasi !== lama.lokasi || d.hp !== lama.hp || (lama.status === 'Dibatalkan' && d.status !== 'Dibatalkan');
    if (pindah) await cekHpGanda(query, d, kode);
    await query(`update pemohon set nama=$2, hp=$3, email=$4, jenis=$5, lokasi=$6, tanggal=$7, jam=$8, status=$9, petugas=$10, keterangan=$11 where kode=$1`,
      [kode, d.nama, d.hp, d.email, d.jenis, d.lokasi, d.tanggal, d.jam, d.status, d.petugas, d.keterangan]);
    await hitungUlang(query, [[tLama, lama.lokasi], [d.tanggal, d.lokasi]], paksa);
    return { kode, status: d.status };
  });
}

async function hapusPemohon(kode) {
  return tx(async (query) => {
    const { rows: [d] } = await query('delete from pemohon where kode = $1 returning tanggal, lokasi', [kode]);
    if (!d) throw new HttpError(404, 'Pemohon tidak ditemukan.');
    await hitungUlang(query, [[d.tanggal, d.lokasi]], true);
    return { kode };
  });
}

// Impor baris Excel/CSV (judul kolom sama dengan unduhan). Semua valid dulu, baru ditulis.
const KOLOM = { 'ID BAP': 'kode', 'KODE': 'kode', 'NAMA': 'nama', 'NO HP AKTIF': 'hp', 'NO HP': 'hp', 'HP': 'hp', 'EMAIL': 'email',
  'JENIS BAP': 'jenis', 'JENIS': 'jenis', 'LOKASI': 'lokasi', 'TANGGAL': 'tanggal', 'JAM': 'jam', 'STATUS': 'status',
  'PETUGAS PEMERIKSA': 'petugas', 'PETUGAS': 'petugas', 'KETERANGAN': 'keterangan' };
async function imporPemohon(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'File kosong.');
  if (rows.length > 3000) throw new HttpError(400, 'Maksimal 3000 baris sekali impor.');
  const siap = [], galat = [];
  rows.forEach((r, i) => {
    const src = {};
    for (const [k, v] of Object.entries(r || {})) { const f = KOLOM[String(k).trim().toUpperCase()]; if (f && src[f] === undefined) src[f] = v; }
    if (!Object.values(src).some((v) => String(v ?? '').trim())) return; // baris kosong
    try {
      const d = validasiAdmin({ status: 'Terkonfirmasi', ...src, status: src.status || 'Terkonfirmasi' }, false);
      const kode = String(src.kode || '').trim().toUpperCase();
      if (kode && !KODE_RE.test(kode)) throw new HttpError(400, 'ID BAP tidak valid.');
      siap.push({ ...d, kode });
    } catch (e) { galat.push(`Baris ${i + 2}: ${e.message}`); }
  });
  if (galat.length) return { baru: 0, diperbarui: 0, galat: galat.slice(0, 50), jumlahGalat: galat.length };
  return tx(async (query) => {
    let baru = 0, diperbarui = 0; const pasangan = [];
    for (const d of siap) {
      let kode = d.kode;
      if (kode) {
        const { rows: [l] } = await query('select tanggal, lokasi from pemohon where kode = $1', [kode]);
        if (l) pasangan.push([l.tanggal, l.lokasi]);
        const n = parseInt(kode.split('-')[2], 10), tk = kode.slice(4, 8) + '-' + kode.slice(8, 10) + '-' + kode.slice(10, 12);
        if (validIso(tk)) await query('insert into urutan (tanggal, n) values ($1, $2) on conflict (tanggal) do update set n = greatest(urutan.n, excluded.n)', [tk, n]);
        if (l) diperbarui++; else baru++;
      } else { kode = await buatKode(query, d.tanggal); baru++; }
      await query(`insert into pemohon (kode, nama, hp, email, jenis, lokasi, tanggal, jam, status, petugas, keterangan)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (kode) do update set nama=excluded.nama, hp=excluded.hp, email=excluded.email, jenis=excluded.jenis, lokasi=excluded.lokasi,
          tanggal=excluded.tanggal, jam=excluded.jam, status=excluded.status, petugas=excluded.petugas, keterangan=excluded.keterangan`,
        [kode, d.nama, d.hp, d.email, d.jenis, d.lokasi, d.tanggal, d.jam, d.status, d.petugas, d.keterangan]);
      pasangan.push([d.tanggal, d.lokasi]);
    }
    await hitungUlang(query, pasangan.map(([t, l]) => [typeof t === 'string' ? t : t.toISOString().slice(0, 10), l]), true);
    return { baru, diperbarui, galat: [] };
  });
}

module.exports = { bacaPesanDokumen, bacaAutoKonfirmasi, buatBooking, waAdminUrl, ubahPemohon, tambahPemohon, hapusPemohon, imporPemohon };

