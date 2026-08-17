# SenjaMart

SenjaMart adalah aplikasi e-commerce / minimarket berbasis web dengan **frontend customer** untuk berbelanja dan **dashboard admin** untuk mengelola toko. Aplikasi ini mencakup katalog produk, keranjang belanja, checkout dengan pembayaran Midtrans, riwayat pesanan, serta panel admin lengkap untuk mengelola produk, kategori, stok, pesanan, marketing, dan laporan.

## Tech Stack

- Next.js 16
- React
- TypeScript
- Tailwind CSS
- Supabase
- Midtrans
- AI Agent

## Fitur Customer

- Beranda
- Kategori produk
- Daftar produk
- Detail produk
- Keranjang
- Checkout
- Pembayaran Midtrans
- Riwayat pesanan
- Profile
- Rating/review

## Fitur Admin

- Dashboard
- Produk
- Kategori
- Inventory
- Pesanan
- Marketing
- Reports
- AI Assistant
- Search/filter/pagination
- Authentication dan role admin

## Backend & Database

Data aplikasi disimpan di **Supabase** (PostgreSQL). Skema database dikelola melalui file migration yang berada di folder `supabase/migrations` dan dapat diterapkan ke project Supabase Anda.

## Payment

Integrasi pembayaran menggunakan **Midtrans** (Snap). Untuk environment lokal, gunakan **Midtrans Sandbox**; untuk production, gunakan credential **Production** dari dashboard Midtrans. Mode environment diatur melalui variabel environment — lihat bagian Environment Variables di bawah.

## AI Agent

SenjaMart dilengkapi **AI Assistant/AI Agent** di area admin untuk membantu tugas-tugas administrasi. AI Agent bekerja berdasarkan permission pengguna yang sedang login dan hanya dapat menggunakan tools yang tersedia untuknya.

## Local Development

Pastikan Node.js sudah terinstall, lalu jalankan:

```bash
npm install
npm run dev
```

Aplikasi berjalan di `http://localhost:3000`.

Environment variable harus dikonfigurasi melalui file **`.env.local`** berdasarkan template **`.env.example`**. Salin `.env.example` menjadi `.env.local` dan isi nilainya sesuai environment Anda (Supabase, Midtrans, dan AI provider). Jangan pernah membagikan atau meng-commit nilai credential asli.

## Environment Variables

Project menggunakan **`.env.example`** sebagai template daftar variabel yang dibutuhkan. Credential asli (seperti kunci Supabase, kunci server Midtrans, dan API key AI provider) harus disimpan di **`.env.local`** (lokal, tidak di-track Git) atau di **Environment Variables Vercel** saat deployment. Jangan pernah menampilkan atau meng-commit nilai secret.

## Deployment

Deployment dilakukan melalui **Vercel**: hubungkan repository ke Vercel, lalu konfigurasi Environment Variables yang dibutuhkan di dashboard Vercel sebelum build.

## Repository

Nama project: **SenjaMart**
