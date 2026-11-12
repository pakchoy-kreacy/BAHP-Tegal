-- Skema BHAP (Postgres / Neon). Aman dijalankan berulang.
-- Tempel seluruh isi file ini di Neon > SQL Editor > Run.

create table if not exists jadwal (
  tanggal   date    not null,
  lokasi    text    not null,
  kuota     integer not null check (kuota between 0 and 500),
  terpakai  integer not null default 0 check (terpakai >= 0),
  tutup     boolean not null default false,
  primary key (tanggal, lokasi)
);

create table if not exists pemohon (
  kode       text primary key,
  nama       text not null,
  hp         text not null,
  email      text not null default '',
  jenis      text not null check (jenis in ('PASPOR HILANG', 'PASPOR RUSAK')),
  lokasi     text not null,
  tanggal    date not null,
  jam        text not null default '',
  status     text not null default 'Menunggu'
             check (status in ('Menunggu', 'Terjadwal', 'Selesai', 'Dibatalkan')),
  petugas    text not null default '',
  keterangan text not null default '',
  dibuat     timestamptz not null default now()
);
create index if not exists pemohon_tanggal_idx on pemohon (tanggal);
create index if not exists pemohon_hp_idx on pemohon (tanggal, hp);

-- Nomor urut kode BAP-yyyyMMdd-nnn per tanggal
create table if not exists urutan (
  tanggal date primary key,
  n       integer not null
);

-- Pengaturan: hari libur, hash PIN admin
create table if not exists pengaturan (
  kunci text primary key,
  nilai jsonb not null
);

-- Pembatas spam per IP (IP di-hash); baris lama dibersihkan otomatis oleh aplikasi
create table if not exists ratelimit (
  kunci      text primary key,
  n          integer not null,
  hapus_pada timestamptz not null
);
