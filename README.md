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
│   └── FRONTEND_GUIDELINES.md
├── prisma/
│   ├── schema.prisma        # Database schema definitions
│   ├── seed.ts              # Seeder roles & initial Super Admin
│   └── migrations/          # Prisma database migrations history
├── src/
│   ├── config/              # Environment config & constants
│   ├── modules/
│   │   └── auth/            # Auth controller, service, routes, & schemas
│   ├── plugins/             # Fastify Swagger & CORS setup
│   ├── app.ts               # Fastify app factory
│   └── server.ts            # Entrypoint listener
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
Pastikan variabel berikut sesuai:
```env
PORT=4000
DATABASE_URL="postgresql://arrayan_user:arrayan_secret_2026@localhost:5432/arrayan_hris?schema=public"
JWT_SECRET="arrayan_super_secret_jwt_key_minimum_32_chars_2026"
JWT_REFRESH_SECRET="arrayan_super_secret_refresh_jwt_key_min_32_chars_2026"
NODE_ENV="development"
FRONTEND_URL="http://localhost:3000"
```

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
2. Salin token dari respons `data.accessToken`.
3. Klik tombol hijau **`Authorize 🔓`** di kanan atas Swagger UI dan masukkan format `Bearer <TOKEN>`.
4. Anda sekarang dapat mengetes endpoint terproteksi seperti `GET /api/auth/me`.

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
