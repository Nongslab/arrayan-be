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
│   └── migrations/          # Prisma database migrations history
├── src/
│   ├── lib/prisma.ts        # Singleton Prisma Client
│   ├── middlewares/         # authenticate (Bearer/cookie) & authorize (RBAC)
│   ├── modules/
│   │   └── auth/            # Routes, service, Zod schema, login limiter, & tests
│   └── server.ts            # Entrypoint: plugin CORS/cookie/JWT/Swagger + routes
└── vitest.config.ts         # Vitest configuration
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
| `CORS_ORIGIN` | Origin frontend (default `http://localhost:5173`) |
| `DATABASE_URL` | Koneksi PostgreSQL; nilai di `.env.example` cocok dengan `docker-compose.yml` |
| `JWT_SECRET`, `COOKIE_SECRET` | **Wajib, minimal 32 karakter.** Server menolak start jika kosong. Production: `openssl rand -hex 32` |
| `TRUST_PROXY` | `true` jika API berada di belakang nginx, agar IP klien terbaca untuk login limiter |

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

📘 Detail struktur, ERD, flowchart, dan aturan master data: [`docs/MASTER_DATA.md`](docs/MASTER_DATA.md).

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
* **Refresh token** opaque 7 hari — body `refreshToken` atau cookie `arrayan_refresh_token` (path `/api/auth`), disimpan sebagai hash SHA-256 dan dirotasi setiap `POST /api/auth/refresh`.
* **Login limiter** — 5 percobaan gagal per IP + email dalam 15 menit → HTTP `429` dengan header `Retry-After`.

---

## 🧪 Testing & Code Quality

Jalankan rangkaian unit tests vitest:
```bash
npm test
```

Jalankan typecheck TypeScript:
```bash
npm run typecheck
```

---

## 🛡️ Alur Kontribusi & Proteksi Branch

Repositori ini menerapkan standar keamanan **Branch Protection** pada branch `main`:
1. **Dilarang Direct Push ke `main`**: Semua perubahan wajib melalui branch fitur (`feat/*`, `fix/*`, `chore/*`) dan diajukan lewat Pull Request (PR).
2. **CI Quality Gate Otomatis**: Setiap commit di branch mana pun otomatis menjalankan validasi schema Prisma, generate client, Vitest unit test, dan TypeScript build.
