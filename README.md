# BHAP! Booking Hari Acara Pemeriksaan (Vercel + Neon)

Versi baru sistem booking BAP Imigrasi Tegal/Brebes. Menggantikan GitHub Pages + Google Sheet + Apps Script.
Repo lama (`pakchoyy/Booking-Jadwal-BAP`) tidak diubah dan tetap menjadi acuan perilaku.

**Stack:** halaman HTML statis + API routes Vercel (Node) + database Postgres di Neon. Login admin dengan PIN.

## Isi proyek

```
public/            index.html (publik), admin.html (admin), logo
api/               API Vercel (semua logika server)
  jadwal.js        publik: tanggal + sisa kuota (30 hari ke depan)
  booking.js       publik: buat booking
  status.js        publik: cek status dengan kode booking
  admin/           login, pin, pemohon, jadwal, otomatis (pola + libur), rekap, export (CSV)
lib/               kode bersama (validasi, transaksi kuota, login PIN, rate limit)
db/schema.sql      skema database (dijalankan sekali di Neon)
scripts/import-csv.js   impor satu kali dari CSV Google Sheet
test/              tes otomatis
vercel.json        pengaturan Vercel
```

Kenapa HTML + API routes, bukan Next.js: halaman lama sudah satu file HTML yang berjalan baik. Tanpa proses build,
kode lama dipakai ulang, hanya 10 fungsi server (batas paket gratis Vercel 12).

## Aturan bisnis yang dipertahankan
- Lokasi: Kantor Imigrasi Tegal, Beranda Imigrasi Brebes. Jenis: PASPOR HILANG / PASPOR RUSAK.
- Status: Menunggu, Terjadwal, Selesai, Dibatalkan. **Dibatalkan tidak menghitung kuota.**
- Kode: `BAP-yyyyMMdd-nnn`, urut per tanggal kunjungan (dipakai bersama Tegal dan Brebes).
- Publik hanya melihat/memesan tanggal sampai 30 hari ke depan (WIB).
- Pola isi otomatis: Tegal Senin-Jumat kuota 8, Brebes Senin dan Kamis kuota 4 (ubah di `lib/config.js`).
- Setelah booking: kode, ringkasan, dan tombol WhatsApp ke 6285195565657 dengan pesan terisi.

## 1. Menyiapkan database di Neon (±3 menit)
1. Daftar/login di https://neon.tech → **Create project**. Region: **Singapore (ap-southeast-1)**.
2. Di dashboard proyek klik **Connect**, pilih **Pooled connection**, lalu salin *connection string*
   (diawali `postgresql://...`). Ini rahasia; hanya ditempel ke Vercel.
3. Buka **SQL Editor** di Neon, tempel seluruh isi file `db/schema.sql`, klik **Run**.

## 2. Environment variables (di Vercel, bukan di repo)
Vercel → project → **Settings → Environment Variables** (contoh di `.env.example`).

| Nama | Isi |
|---|---|
| `DATABASE_URL` | connection string Neon (langkah 1.2) |
| `ADMIN_PIN` | PIN admin awal, 6-12 angka. Juga jadi **PIN cadangan** bila PIN yang diganti lupa. Pilih yang sulit ditebak |
| `SESSION_SECRET` | teks acak panjang (min. 16 karakter) |
| `RATE_SALT` | teks acak panjang |
| `WA_ADMIN` | (opsional) nomor WA admin, default 6285195565657 |

Setiap kali env diubah → **Redeploy**.

## 3. Deploy ke Vercel
Proyek `bahp-tegal` sudah tersambung ke repo GitHub. Setelah env terisi: **Deployments → Redeploy**, atau push ke branch produksi.
Framework preset: **Other** (tanpa build). Fungsi berjalan di Singapura (`sin1` di `vercel.json`), dekat database.

## 4. Menyambungkan domain (bhap.web.id)
1. Vercel → project → **Settings → Domains → Add** `bhap.web.id`. Ikuti petunjuk DNS yang muncul.
2. Setelah situs baru jalan, kosongkan custom domain di GitHub Pages repo lama (Settings → Pages) agar tidak bentrok. Repo lama tidak perlu dihapus.

## 5. Login admin dan ganti PIN
- Buka `/admin`, masukkan PIN (awalnya nilai `ADMIN_PIN`).
- Menu **Pengaturan → Ganti PIN** (PIN baru 6-12 angka). Perangkat lain otomatis keluar. PIN disimpan sebagai hash (scrypt), bukan teks.
- Lupa PIN baru? Masuk dengan `ADMIN_PIN` dari Vercel, lalu ganti lagi. Ingin mengganti PIN cadangan: ubah `ADMIN_PIN` di Vercel lalu Redeploy.
- Perlindungan: 5 salah PIN per 10 menit per IP (dan batas global), sesi 12 jam, cookie HttpOnly + SameSite Strict.

## 6. Pemakaian pertama
1. **Jadwal** → isi **hari libur** (bila ada) → **Isi jadwal otomatis** (default 60 hari, tidak menimpa jadwal yang ada). Ulangi tiap bulan.
2. Tambah tanggal khusus, ubah kuota, **Tutup** (tidak tampil di publik) atau **Hapus** (hanya bila tanpa booking aktif).
3. **Pemohon**: filter tanggal/lokasi/status, cari nama/HP/kode, ubah status/petugas/keterangan, tombol **WhatsApp** (nomor otomatis 62xxx), **Ekspor CSV**.
4. **Rekap**: jumlah per hari per lokasi, ekspor CSV.

Trigger bulanan otomatis (seperti Apps Script lama) belum dibuat; isi jadwal lewat tombol manual.

## 7. Impor data lama dari Google Sheet (sekali saja)
1. Sheet tab **DATA PEMOHON** → File → Download → CSV → `data/pemohon.csv`; tab **JADWAL BAP** → `data/jadwal.csv`. Folder `data/` dan `*.csv` diabaikan git.
2. Node.js 20+, di folder proyek: `npm install`.
3. Beri akses database (hanya di komputer Anda):
   ```bash
   export DATABASE_URL="postgresql://...salin dari Neon..."
   ```
4. Uji coba (tidak menulis; melaporkan baris bermasalah):
   ```bash
   node scripts/import-csv.js --pemohon data/pemohon.csv --jadwal data/jadwal.csv
   ```
5. Bila bersih, tulis sungguhan:
   ```bash
   node scripts/import-csv.js --pemohon data/pemohon.csv --jadwal data/jadwal.csv --commit
   ```
Kuota terpakai dan urutan kode dihitung ulang dari data. Menolak jalan bila tabel sudah berisi data (kecuali `--force`). Format tanggal `yyyy-mm-dd` dan `dd/mm/yyyy` dikenali. HP ganda di tanggal sama pada data lama hanya diberi peringatan.

## 8. Pengujian

### Otomatis (sudah dijalankan)
```bash
npm install
npm run test:unit                                   # validasi, tanggal, pola jadwal, CSV
DATABASE_URL=postgres://localhost/bhap_test npm run test:db   # 17 tes ke Postgres LOKAL (database kosong khusus tes)
```
`test:db` menolak jalan bila `DATABASE_URL` bukan localhost (karena mengosongkan tabel). Isinya: 10 booking bersamaan ke kuota 3 (tepat 3 berhasil), satu HP aktif per tanggal (paralel),
honeypot, rate limit 429, validasi, status publik tanpa data pribadi, login PIN (salah, benar, cookie palsu, CSRF, brute force), ubah status melepas/mengambil kuota,
kelola jadwal, isi otomatis + libur + tidak menimpa, rekap, CSV aman dari formula injection, ganti PIN (sesi lama gugur, hash tersimpan, PIN cadangan jalan), uji injeksi SQL pada pencarian.
Tampilan publik (HP 390px) dan admin juga diuji di browser dengan Postgres lokal.

### Belum diuji (butuh akun Anda)
- Neon sungguhan (koneksi pooled, latensi), Vercel (deploy, env, region, domain).
- Impor dengan data asli Anda; pengiriman WhatsApp (hanya URL `wa.me` yang diperiksa).

### Langkah uji manual setelah deploy
1. Di HP: pilih lokasi → tanggal → isi data → Booking. Kode `BAP-...` muncul, tombol WhatsApp membuka pesan terisi ke 6285195565657.
2. Booking ulang dengan HP dan tanggal yang sama → ditolak. Tanggal lain → boleh.
3. Cek status dengan kode itu: hanya status, hari, lokasi (tanpa nama/HP).
4. `/admin`: PIN salah → ditolak; PIN benar → masuk. Buka `https://<domain>/api/admin/pemohon` langsung → `401`.
5. Ubah status ke Dibatalkan → sisa kuota di publik bertambah 1 (±10 detik, ada cache singkat).
6. Ganti PIN di Pengaturan, buka di perangkat lain → harus login ulang.
7. Uji kuota: kuota 1, dua orang menekan Booking bersamaan → hanya satu berhasil.
8. Ekspor CSV, buka di Excel; nomor HP tampil penuh.

## Keamanan singkat
- Rahasia (DATABASE_URL, PIN, secret) hanya di env Vercel. `.gitignore` memblokir `.env*` dan `*.csv`.
- Semua akses database lewat API server; browser tidak punya akses langsung ke database.
- Kuota diambil dengan UPDATE atomik di dalam transaksi; kunci per (tanggal, HP) mencegah dobel booking paralel.
- Query memakai parameter (aman dari injeksi SQL). Halaman admin menampilkan teks dengan `textContent` (aman dari XSS).
- Validasi server: nama min. 3 huruf, HP 9-14 digit (seluler 08xx/62 8xx), jenis, lokasi, tanggal (hari ini sampai +30).
- Anti-spam: honeypot, 6 booking per 10 menit per IP, 30 cek status per 10 menit per IP (IP disimpan sebagai hash; baris lama dibersihkan otomatis).
- Halaman publik tidak mengirim nama atau HP orang lain.

## Batas dan catatan
- Neon gratis cukup untuk ±300 booking/bulan. Database gratis bisa "tidur" saat sepi, jadi permintaan pertama bisa lambat ±1 detik.
- Vercel Hobby untuk penggunaan non-komersial/pribadi. Untuk layanan instansi, periksa syarat paket yang sesuai.
- Mengubah lokasi atau pola: ubah `lib/config.js`, lalu daftar `LOKASI` di `public/index.html` dan `public/admin.html` (nama harus persis sama).
