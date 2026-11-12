# HRIS Arryan - Backend API Service

[![CI Quality Gate](https://github.com/Nongslab/arrayan-be/actions/workflows/ci.yml/badge.svg)](https://github.com/Nongslab/arrayan-be/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-v22-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Backend REST API untuk sistem HRIS Arryan. Dibangun dengan pendekatan **Clean Architecture Modular Monolith** untuk performa tinggi, efisiensi resource, dan kemudahan deployment on-premise/self-hosted pada VPS klien (10–50 karyawan).

---

## 🛠 Tech Stack

* **Runtime & Framework**: [Node.js 22 LTS](https://nodejs.org/) + [Fastify v5](https://fastify.dev/) (TypeScript)
* **ORM & Database**: [Prisma ORM v6](https://www.prisma.io/) + [PostgreSQL 16](https://www.postgresql.org/) (Docker Container)
* **Authentication**: Dual-transport JWT (Bearer Token `Authorization` header & HttpOnly Cookie) + Refresh Token Rotation (SHA-256 hashed)
* **Testing & Quality**: [Vitest](https://vitest.dev/) (Unit Testing) + GitHub Actions CI
* **API Documentation**: Interactive [Swagger UI / OpenAPI 3.0](http://localhost:4000/docs)

---

## 📁 Struktur Direktori

```text
arrayan-backend/
├── .github/workflows/ci.yml # CI Quality Gate (Test, Typecheck, Prisma validate)
├── docker-compose.yml       # PostgreSQL 16 container setup
├── docs/                    # Dokumentasi arsitektur, PRD v2.0, & roadmap
│   ├── PRD.md
│   ├── DEVELOPMENT_ROADMAP.md
│   ├── BACKEND_OVERVIEW.md
│   ├── SECURITY_GUIDELINES.md
│   ├── FRONTEND_GUIDELINES.md
│   └── PLAN_*.md            # Rencana implementasi per sprint (arsip)
├── prisma/
│   ├── schema.prisma        # Database schema definitions
│   ├── seed.ts              # Seeder roles & initial Super Admin
│   ├── demo/                # Data demo dev-only (npm run seed:demo)
│   └── migrations/          # Prisma database migrations history
├── src/
│   ├── lib/                 # Prisma Client singleton & HttpError / mapping error Prisma
│   ├── middlewares/         # authenticate (Bearer/cookie) & authorize (RBAC)
│   ├── modules/
│   │   ├── auth/            # Routes, service, Zod schema, login limiter, & tests
│   │   ├── audit/           # API audit log /api/audit-logs
│   │   ├── employee/        # API karyawan /api/employees (list, detail, tree branch)
│   │   └── master/          # API master data /api/master/* (route generik + aturan validasi)
│   ├── test/                # Global setup & helper integration test
│   ├── app.ts               # buildApp(): plugin CORS/cookie/JWT/Swagger + routes (tanpa listen)
│   └── server.ts            # Entrypoint: buildApp() + listen
├── vitest.config.ts         # Vitest unit test
└── vitest.int.config.ts     # Vitest integration test (PostgreSQL)
```

---

## 🚀 Memulai (Local Setup)

### 1. Prasyarat
* Node.js v20+ atau v22
* Docker Desktop (untuk PostgreSQL)
* Git

### 2. Instalasi Dependensi
```bash
npm install
```

### 3. Konfigurasi Environment
Salin file template `.env.example` ke `.env`:
```bash
cp .env.example .env
```
Variabel yang dipakai:

| Variabel | Keterangan |
| :--- | :--- |
| `PORT` | Port API (default `4000`) |
| `NODE_ENV` | `development` / `production` (production → cookie `Secure` + `SameSite=None`) |
| `CORS_ORIGIN` | Origin frontend, boleh beberapa dipisah koma (default `http://localhost:5173`; production wajib https) |
| `DATABASE_URL` | Koneksi PostgreSQL; nilai di `.env.example` cocok dengan `docker-compose.yml` |
| `JWT_SECRET`, `COOKIE_SECRET` | **Wajib, minimal 32 karakter, harus berbeda.** Production: `openssl rand -hex 32` (nilai contoh `.env.example` ditolak) |
| `TRUST_PROXY` | `true` jika API berada di belakang nginx, agar IP klien terbaca untuk login limiter |
| `APP_BASE_URL` | URL frontend untuk link aktivasi akun (default `http://localhost:5173`) |
| `INVITATION_DRIVER` | Kanal undangan aktivasi. Saat ini `log` — link ditampilkan di log & response API **hanya di luar production** |
| `LOG_LEVEL` | `fatal`…`trace`/`silent` (default `info`). Header `Authorization`, cookie, password & token otomatis disamarkan di log |
| `DOCS_ENABLED` | Swagger UI `/docs` — default aktif di dev, **nonaktif di production** kecuali `true` |
| `TEST_DATABASE_URL` | DB khusus integration test (nama wajib mengandung `test`, mis. `arrayan_hris_test`); dibuat otomatis saat `npm run test:int` |

Semua variabel divalidasi sekali saat start oleh [`src/lib/config.ts`](src/lib/config.ts). Bila ada yang salah, server berhenti dan menyebutkan **semua** masalah sekaligus. Mode `NODE_ENV=production` menambah aturan: secret bukan nilai contoh, `CORS_ORIGIN` & `APP_BASE_URL` wajib https.

### 4. Menjalankan Database PostgreSQL
```bash
npm run db:up
```

### 5. Jalankan Migrasi & Seeder Database
```bash
npm run prisma:migrate
npm run prisma:seed
```

> **Akun Default Super Admin (dari Seeder):**
> * **Email:** `superadmin@arrayan.com`
> * **Password:** `Password123!`

Seeder juga mengisi **master data** (idempotent, upsert by `code`) dari `prisma/seed-data/master.ts`:
departemen berjenjang (`HQ` → `ENG`, `HRD`, `FIN`, `OPS`), jabatan + level hierarki, lokasi kantor `HO`,
shift `REGULAR` 08:00–17:00, jenis cuti, hari libur 2026/2027, kategori training, dan contoh template KPI.

> ⚠️ Koordinat & Wi-Fi lokasi kantor `HO` masih **placeholder** — ganti dengan data riil klien sebelum go-live.

Master data dikelola lewat API `/api/master/<entitas>` (baca: semua user login; tulis & nonaktifkan: `SUPER_ADMIN`).

📘 Detail struktur, ERD, flowchart, dan aturan master data: [`docs/MASTER_DATA.md`](docs/MASTER_DATA.md).

#### Data demo (opsional, dev only)
Untuk demo ke klien atau pengembangan FE, isi DB dev dengan organisasi contoh yang "hidup":
```bash
npm run seed:demo             # buat ulang data demo (aman diulang)
npm run seed:demo -- --clear  # hapus data demo saja
```
Isinya relatif terhadap tanggal hari ini:
- 20 karyawan dengan hierarki Direktur → Sr Manager → Manager → Supervisor → Staff, beserta variasi status:
  - akun aktif, akun belum aktivasi, karyawan tanpa akun (PKL), karyawan keluar dengan akun nonaktif;
  - probation yang hampir berakhir.
- Absensi 30 hari terakhir dari aplikasi (GPS) dan fingerprint, termasuk yang terlambat dan mangkir.
- Cuti/izin/sakit dengan status PENDING/APPROVED/CANCELLED, plus satu penyesuaian saldo.
- Training lalu, mendatang, dan batal; event kantor.
- Widget dashboard hari ini (terlambat, cuti, sakit, ulang tahun, training) langsung terisi.

Semua akun demo: `<nama.depan>.<nama.belakang>@demo.arrayan.test` / `DemoArrayan123!`. Contoh: `siti.rahmawati@…` (HR, SUPER_ADMIN), `hendra.wijaya@…` (Direktur), `dewi.lestari@…` (Supervisor).

Data demo ditandai dengan:
- NIK `DEMO-*`;
- email `@demo.arrayan.test`;
- deskripsi training/event berakhiran `(data demo)`.

Hanya data dengan penanda itu yang dihapus saat seed diulang. Script menolak berjalan bila `NODE_ENV=production`, dan kodenya (`prisma/demo/`) tidak ikut ke image Docker.

### 6. Menjalankan Server Development
```bash
npm run dev
```
Server akan aktif di `http://localhost:4000`.

---

## 📖 Dokumentasi API & Swagger UI

Buka browser dan akses Swagger UI di:
👉 **[http://localhost:4000/docs](http://localhost:4000/docs)**

Fitur autentikasi Swagger:
1. Jalankan `POST /api/auth/login`.
2. Salin nilai `accessToken` dari body respons.
3. Klik tombol hijau **`Authorize 🔓`** di kanan atas Swagger UI dan tempel token **tanpa** prefix `Bearer` (Swagger menambahkannya otomatis).
4. Anda sekarang dapat mengetes endpoint terproteksi seperti `GET /api/auth/me`.

Ringkasan sesi auth:
* **Access token** JWT 15 menit — dikirim via header `Authorization: Bearer <token>` atau cookie HttpOnly `arrayan_access_token`.
* **Audit log** — aksi admin (karyawan, akun, master data) dan event keamanan (aktivasi, reset/ganti password, login terkunci) dicatat di tabel `audit_logs` dalam transaksi yang sama dengan aksinya, tanpa password/token. Baca via `GET /api/audit-logs` (khusus `SUPER_ADMIN`; filter `action` (awalan), `actorUserId`, `entityType`, `entityId`, `from`, `to`).
* **Validasi sesi per request** — setiap request terautentikasi dicocokkan ke DB (status `ACTIVE` + `sessionVersion`). Menonaktifkan akun, ganti password, atau reset password langsung membatalkan semua access token lama (401 *"Sesi tidak berlaku lagi"*); perubahan role berlaku seketika.
* **Refresh token** opaque 7 hari — body `refreshToken` atau cookie `arrayan_refresh_token` (path `/api/auth`), disimpan sebagai hash SHA-256 dan dirotasi setiap `POST /api/auth/refresh`.
* **Login limiter** — 5 percobaan gagal per IP + email dalam 15 menit → HTTP `429` dengan header `Retry-After`.
* **Onboarding akun** — HR (`SUPER_ADMIN`) membuat karyawan & akun via `POST /api/employees`; karyawan mengaktivasi lewat `POST /api/auth/activate`.
* **Password** — `POST /api/auth/forgot-password` → `POST /api/auth/reset-password` (link 1 jam), dan `POST /api/auth/change-password` saat login. Reset/ganti password mencabut sesi lain.
* Selama driver email belum dipasang (`INVITATION_DRIVER=log`), link aktivasi/reset muncul di log & response API **hanya di luar production**.

---

## 🐳 Deployment (Docker)

Image production & stack API + PostgreSQL siap pakai: `Dockerfile`, `docker-compose.prod.yml`, `.env.production.example`, skrip backup/restore di `scripts/`. Panduan lengkap, hasil uji lokal, dan **checklist saat VPS siap**: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

```bash
cp .env.production.example .env.production   # isi secret & domain https
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

---

## 🧪 Testing & Code Quality

Jalankan rangkaian unit tests vitest (tanpa database):
```bash
npm test
```

Jalankan integration tests (`*.int.test.ts`) terhadap PostgreSQL — butuh `npm run db:up` dan `TEST_DATABASE_URL` di `.env`:
```bash
npm run test:int
```
Global setup menjalankan `prisma migrate deploy` + seed ke DB test, lalu test memanggil API lewat `app.inject()` (helper di `src/test/helpers.ts`). DB development tidak pernah disentuh.

Jalankan typecheck TypeScript:
```bash
npm run typecheck
```

---

## 🛡️ Alur Kontribusi & Proteksi Branch

Repositori ini menerapkan standar keamanan **Branch Protection** pada branch `main`:
1. **Dilarang Direct Push ke `main`**: Semua perubahan wajib melalui branch fitur (`feat/*`, `fix/*`, `chore/*`) dan diajukan lewat Pull Request (PR).
2. **CI Quality Gate Otomatis**: Setiap commit di branch mana pun otomatis menjalankan validasi schema Prisma, generate client, Vitest unit test, integration test terhadap service PostgreSQL 16, dan TypeScript build.
