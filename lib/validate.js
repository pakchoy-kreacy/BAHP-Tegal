const { JENIS_BAP, lokasiByNama, HARI_KE_DEPAN } = require('./config');
const { validIso, addDays } = require('./tanggal');
const { HttpError } = require('./http');

function bersihkanNama(x) {
  return String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

// 08xx / 8xx / +62 8xx -> 628xx
function normalisasiHp(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return d;
}

// Kembalikan HP ternormalisasi (62xxx) atau null. Input harus 9-14 digit.
function validasiHp(raw) {
  const digit = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (digit.length < 9 || digit.length > 14) return null;
  const n = normalisasiHp(digit);
  return /^628\d{7,12}$/.test(n) ? n : null; // hanya seluler (WhatsApp)
}

function validasiBooking(input, today) {
  const nama = bersihkanNama(input.nama);
  if (nama.length > 100 || (nama.match(/\p{L}/gu) || []).length < 3) {
    throw new HttpError(400, 'Nama minimal 3 huruf.');
  }
  const hp = validasiHp(input.hp);
  if (!hp) throw new HttpError(400, 'Nomor HP harus 9 sampai 14 digit dan nomor Indonesia (08xx).');
  const jenis = String(input.jenis || '').trim().toUpperCase();
  if (!JENIS_BAP.includes(jenis)) throw new HttpError(400, 'Jenis BAP tidak valid.');
  const lok = lokasiByNama(input.lokasi);
  if (!lok) throw new HttpError(400, 'Lokasi tidak valid.');
  const tanggal = String(input.tanggal || '');
  if (!validIso(tanggal)) throw new HttpError(400, 'Tanggal tidak valid.');
  if (tanggal < today || tanggal > addDays(today, HARI_KE_DEPAN)) {
    throw new HttpError(400, `Tanggal harus dalam ${HARI_KE_DEPAN} hari ke depan.`);
  }
  return { nama, hp, jenis, lokasi: lok.nama, tanggal };
}

const KODE_RE = /^BAP-\d{8}-\d{3,}$/;

module.exports = { bersihkanNama, normalisasiHp, validasiHp, validasiBooking, KODE_RE };
