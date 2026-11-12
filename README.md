# BHAP! Booking Hari Acara Pemeriksaan (Vercel + Firebase)

Versi baru sistem booking BAP Imigrasi Tegal/Brebes. Menggantikan GitHub Pages + Google Sheet + Apps Script.
Repo lama (`pakchoyy/Booking-Jadwal-BAP`) tidak diubah dan tetap menjadi acuan perilaku.

## Isi proyek

```
public/            Halaman web (index.html = publik, admin.html = admin) + logo
api/               API Vercel (semua logika server)
  jadwal.js        publik: tanggal + sisa kuota (30 hari ke depan)
  booking.js       publik: buat booking
  status.js        publik: cek status dengan kode booking
  config.js        publik: konfigurasi login admin
  admin/           pemohon, jadwal, otomatis (pola + libur), rekap, export (CSV)
lib/               kode bersama (validasi, transaksi kuota, auth admin, rate limit)
scripts/import-csv.js   impor satu kali dari CSV Google Sheet
test/              tes otomatis
firestore.rules    aturan keamanan database (semua akses klien DITOLAK)
vercel.json        pengaturan Vercel
```

### Kenapa HTML + API routes, bukan Next.js?
Halaman lama sudah berupa satu file HTML yang berjalan baik. Memakai HTML + API routes berarti: tanpa proses build,
tanpa React/Next yang perlu dipelajari, kode lama dipakai ulang hampir utuh, dan hanya ada 9 fungsi server
(batas paket gratis Vercel 12). Next.js baru berguna bila nanti halaman jadi banyak dan rumit.

## Aturan bisnis yang dipertahankan
- Lokasi: Kantor Imigrasi Tegal, Beranda Imigrasi Brebes. Jenis: PASPOR HILANG / PASPOR RUSAK.
- Status: Menunggu, Terjadwal, Selesai, Dibatalkan. **Dibatalkan tidak menghitung kuota.**
- Kode: `BAP-yyyyMMdd-nnn`, urut per tanggal kunjungan (tanggal di kode = hari datang, urutan dipakai bersama Tegal dan Brebes).
- Publik hanya melihat/memesan tanggal sampai 30 hari ke depan (zona WIB).
- Pola isi otomatis: Tegal Senin-Jumat kuota 8, Brebes Senin dan Kamis kuota 4 (ubah di `lib/config.js`).
- Setelah booking: kode, ringkasan, dan tombol WhatsApp ke 6285195565657 dengan pesan terisi.

## 1. Membuat proyek Firebase
1. Buka https://console.firebase.google.com → **Add project** (Google Analytics boleh dimatikan).
2. **Build → Firestore Database → Create database**. Pilih mode **production** dan lokasi **asia-southeast2 (Jakarta)**. Lokasi tidak bisa diganti setelahnya.
3. Tab **Rules** di Firestore → ganti isinya dengan isi file `firestore.rules` → **Publish**. (Isinya: klien tidak boleh baca/tulis apa pun.)
4. **Build → Authentication → Get started → Sign-in method → Google → Enable**.
5. **Project settings (ikon roda gigi) → General → Your apps → ikon `</>` (Web)** → daftarkan aplikasi. Catat `apiKey` dan `projectId`.
6. **Project settings → Service accounts → Generate new private key**. File JSON terunduh. **Rahasia: jangan dikirim lewat chat/email, jangan di-commit ke GitHub.** File ini hanya ditempel ke Vercel (langkah 3).

## 2. Isi environment variables (di Vercel, bukan di repo)
Vercel → project → **Settings → Environment Variables**. Contoh ada di `.env.example`.

| Nama | Isi |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | seluruh isi file JSON dari langkah 1.6 |
| `ADMIN_EMAILS` | email admin dipisah koma, mis. `a@gmail.com,b@gmail.com` |
| `FIREBASE_WEB_API_KEY` | `apiKey` dari langkah 1.5 |
| `FIREBASE_PROJECT_ID` | `projectId` dari langkah 1.5 |
| `RATE_SALT` | teks acak panjang apa saja (untuk menyamarkan IP di pembatas spam) |
| `WA_ADMIN` | (opsional) nomor WA admin, default 6285195565657 |

## 3. Deploy ke Vercel
1. https://vercel.com → **Add New → Project** → import repo `BAHP-Tegal` dari GitHub.
2. **Framework Preset: Other**. Build command dan Output directory dikosongkan (bawaan).
3. Isi environment variables (bagian 2) → **Deploy**.
4. Region fungsi diset ke Singapura (`sin1` di `vercel.json`) agar dekat dengan database Jakarta.
5. Setelah selesai, buka alamat `xxx.vercel.app` dan `xxx.vercel.app/admin`.

Catatan: ubah environment variable → harus **Redeploy** agar berlaku.

## 4. Menyambungkan domain (bhap.web.id)
1. Vercel → project → **Settings → Domains → Add** `bhap.web.id`. Ikuti petunjuk DNS yang muncul (record `A` atau `CNAME` di penyedia domain).
2. Firebase → **Authentication → Settings → Authorized domains → Add domain** → `bhap.web.id` (dan alamat `xxx.vercel.app`). **Tanpa ini login Google admin gagal.**
3. Setelah situs baru jalan, matikan domain di GitHub Pages repo lama (Settings → Pages → Custom domain → kosongkan) agar tidak bentrok. Repo lama tidak perlu dihapus.

## 5. Menambah / mengganti email admin
Vercel → Settings → Environment Variables → `ADMIN_EMAILS` → tambahkan email (pisah koma) → **Redeploy**.
Hanya akun Google dengan email terverifikasi yang ada di daftar ini yang bisa memakai halaman admin. Pengecekan dilakukan di server pada setiap permintaan.

## 6. Pemakaian pertama
1. Buka `/admin`, **Masuk dengan Google**.
2. Tab **Jadwal**: isi **hari libur** (bila ada) lalu klik **Isi jadwal otomatis** (default 60 hari ke depan, tidak menimpa jadwal yang sudah ada). Ulangi tiap bulan, atau kapan pun perlu.
3. Tambah tanggal khusus, ubah kuota, **Tutup** (tanggal tidak tampil di publik, data tetap ada) atau **Hapus** (hanya bila tanpa booking aktif).
4. Tab **Pemohon**: filter tanggal/lokasi/status, cari nama/HP/kode, ubah status/petugas/keterangan, tombol **WhatsApp** (nomor otomatis 62xxx), **Ekspor CSV**.
5. Tab **Rekap**: jumlah per hari per lokasi, ekspor CSV.

Trigger bulanan otomatis (seperti Apps Script lama) belum dibuat; isi jadwal dilakukan lewat tombol manual. Bila diperlukan, bisa ditambahkan dengan Vercel Cron + endpoint khusus yang dilindungi kunci rahasia.

## 7. Impor data lama dari Google Sheet (sekali saja)
1. Di Google Sheet: tab **DATA PEMOHON** → File → Download → CSV, simpan sebagai `data/pemohon.csv`. Tab **JADWAL BAP** → `data/jadwal.csv`. Folder `data/` dan semua `*.csv` sudah diabaikan git (data pribadi tidak akan ter-commit).
2. Siapkan Node.js 20+, lalu di folder proyek: `npm install`.
3. Beri akses ke Firebase untuk skrip (hanya di komputer Anda):
   ```bash
   export FIREBASE_SERVICE_ACCOUNT="$(cat /lokasi/aman/service-account.json)"
   ```
4. Uji coba dulu (tidak menulis apa pun; melaporkan baris bermasalah):
   ```bash
   node scripts/import-csv.js --pemohon data/pemohon.csv --jadwal data/jadwal.csv
   ```
5. Bila bersih, tulis sungguhan:
   ```bash
   node scripts/import-csv.js --pemohon data/pemohon.csv --jadwal data/jadwal.csv --commit
   ```
Skrip menghitung ulang kuota terpakai, urutan kode, dan kunci nomor HP dari data impor. Skrip menolak jalan bila database sudah berisi data (kecuali `--force`). Format tanggal `yyyy-mm-dd` dan `dd/mm/yyyy` dikenali.

## 8. Pengujian

### Otomatis (sudah dijalankan)
```bash
npm install
npm run test:unit        # validasi, tanggal, pola jadwal, CSV (tanpa database)
npm run test:emulator    # 17 tes terhadap Firestore + Auth emulator (perlu Java)
```
Yang tercakup di emulator: 10 booking bersamaan ke kuota 3 (tepat 3 berhasil), satu HP aktif per tanggal (paralel), honeypot, rate limit 429, validasi, status publik tanpa data pribadi,
auth admin (tanpa token 401, email di luar daftar 403), ubah status melepas/mengambil kuota, kelola jadwal, isi otomatis + libur + tidak menimpa, rekap, CSV aman dari formula injection,
dan **Firestore Rules menolak baca/tulis klien**. Tampilan publik (HP 390px) dan admin juga diuji di browser dengan data emulator.

### Belum diuji (butuh akun Anda)
- Login Google sungguhan (di uji browser, SDK login diganti stub; token tetap diverifikasi server ke emulator).
- Deploy Vercel, environment variables sungguhan, domain, region `sin1`.
- Firestore produksi (latensi, kuota gratis), TTL, impor CSV dengan data asli Anda.
- Pengiriman WhatsApp (hanya URL `wa.me` yang diperiksa).

### Langkah uji manual setelah deploy
1. Buka situs di HP: pilih lokasi → tanggal → isi data → Booking. Pastikan kode `BAP-...` muncul dan tombol WhatsApp membuka pesan terisi ke 6285195565657.
2. Booking ulang dengan HP yang sama di tanggal yang sama → harus ditolak. Tanggal lain → boleh.
3. Cek status dengan kode tadi: hanya status, hari, lokasi (tanpa nama/HP).
4. `/admin` dengan email di `ADMIN_EMAILS` → masuk. Dengan email lain → pesan "tidak punya akses".
5. Ubah status jadi Dibatalkan → sisa kuota di halaman publik bertambah 1 (tunggu ±10 detik, ada cache singkat).
6. Buka `https://<domain>/api/admin/pemohon` langsung di browser → harus `401`.
7. Di Firebase Console → Firestore → Rules → Rules playground / coba baca dari klien → harus ditolak.
8. Uji kuota: kuota 1, minta dua orang menekan Booking bersamaan → hanya satu berhasil.
9. Ekspor CSV, buka di Excel; nomor HP tampil penuh.

## Keamanan singkat
- Kunci service account hanya di environment variables Vercel. `.gitignore` memblokir `.env*`, `*service-account*.json`, `*.csv`.
- Klien tidak punya akses Firestore sama sekali (`firestore.rules`); semua lewat API dengan Admin SDK.
- Kuota, kode urut, dan kunci HP dijaga dalam satu transaksi Firestore.
- Validasi server: nama min. 3 huruf, HP 9-14 digit (hanya seluler 08xx/62 8xx), jenis, lokasi, tanggal (hari ini sampai +30).
- Anti-spam: honeypot, 6 booking per 10 menit per IP, 30 cek status per 10 menit per IP (IP disimpan sebagai hash). Opsional: Firestore → **TTL** → tambah kebijakan koleksi `ratelimit`, field `hapusPada`, agar data pembatas terhapus otomatis.
- Halaman publik tidak menerima/mengirim nama atau HP orang lain. Halaman admin menampilkan teks dengan `textContent` (aman dari XSS).

## Batas dan catatan
- Paket gratis Firebase (Spark): 50.000 baca dan 20.000 tulis per hari. Dengan ±300 booking/bulan sangat cukup; daftar jadwal di-cache CDN 10 detik.
- Paket Hobby Vercel untuk penggunaan non-komersial/pribadi. Untuk layanan instansi, periksa syarat paket yang sesuai.
- Pencarian dan filter lokasi/status dikerjakan di server pada rentang tanggal yang dipilih (maks. 1 tahun, 5.000 data) agar tidak perlu membuat indeks Firestore manual.
- Mengubah lokasi atau pola: ubah `lib/config.js`, lalu daftar `LOKASI` di `public/index.html` dan `public/admin.html` (nama harus persis sama).
