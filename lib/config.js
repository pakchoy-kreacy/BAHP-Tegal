// Pengaturan bisnis BHAP. Ubah di sini bila lokasi / pola jadwal berubah.

const LOKASI = [
  { id: 'tegal', nama: 'Kantor Imigrasi Tegal' },
  { id: 'brebes', nama: 'Beranda Imigrasi Brebes' }
];

const JENIS_BAP = ['PASPOR HILANG', 'PASPOR RUSAK'];

// Dibatalkan tidak dihitung kuota.
const STATUS = ['Menunggu', 'Terkonfirmasi', 'Terjadwal', 'Selesai', 'Dibatalkan'];

// Halaman publik hanya menampilkan / menerima tanggal sekian hari ke depan.
const HARI_KE_DEPAN = 30;

// hari: 0=Minggu, 1=Senin, ... 6=Sabtu (sama dengan IsiJadwal.gs lama).
const POLA_LAYANAN = [
  { lokasi: 'Kantor Imigrasi Tegal', hari: [1, 2, 3, 4, 5], kuota: 8 },
  { lokasi: 'Beranda Imigrasi Brebes', hari: [1, 4], kuota: 4 }
];

// Isi jadwal otomatis untuk sekian hari ke depan.
const ISI_HARI_KE_DEPAN = 60;

const WA_ADMIN_DEFAULT = '6285195565657';

// Teks yang muncul di pesan WhatsApp saat tombol hijau diklik.
const PESAN_DOKUMEN = [
  'Kepada pemohon yang terhormat, jangan lupa untuk datang dan membawa :',
  '',
  '• Surat keterangan kehilangan polisi (bagi pemohon paspor hilang)',
  '• Copy paspor (apabila ada)',
  '• KTP',
  '• Kartu keluarga',
  '• Dokumen ketiga (Akte lahir/buku nikah)',
  '',
  'Harap membawa dokumen asli dan fotocopy'
].join('\n');

function lokasiByNama(nama) {
  const n = String(nama || '').trim().toLowerCase();
  return LOKASI.find((l) => l.nama.toLowerCase() === n) || null;
}

module.exports = {
  LOKASI, JENIS_BAP, STATUS, HARI_KE_DEPAN, POLA_LAYANAN,
  ISI_HARI_KE_DEPAN, WA_ADMIN_DEFAULT, PESAN_DOKUMEN, lokasiByNama
};
