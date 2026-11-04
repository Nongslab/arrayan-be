# Implementation Plan — Backend Authentication & User Management (Sprint 1)

Dokumen ini adalah rencana kerja detail (*Step-by-Step Task Breakdown*) untuk mengimplementasikan modul **Authentication & User Management** di `arrayan-backend`.

Pengerjaan dilakukan di branch: `feat/setup-planning` (atau `feat/auth-system`) dan di-merge ke `main` hanya melalui **Pull Request (PR)**.

---

## 🎯 Tujuan Utama Sprint 1
1. Menyediakan sistem login yang aman menggunakan **JWT via HttpOnly Cookie**.
2. Menyediakan proteksi akses (*AuthGuard & RoleGuard*) berdasarkan 6 role PRD v1.1.
3. Menyediakan alur pembuatan akun & data karyawan oleh Super Admin.
4. Mempersiapkan kontrak API yang bersih untuk diintegrasikan dengan Frontend `arrayan-proj`.

---

## 📋 Task Breakdown & Prompt Sequence

### Task 1: Fondasi Modul & Shared Utilities
- **Deskripsi**: Menyiapkan struktur folder modul dan koneksi singleton Prisma Client.
- **File Target**:
  - `src/lib/prisma.ts`
  - `src/middlewares/auth.middleware.ts` (Guard `authenticate` & `authorize`)
- **Kriteria Penerimaan (Acceptance Criteria)**:
  - Middleware dapat mengekstrak dan memvalidasi cookie `arrayan_token`.
  - Middleware mengembalikan HTTP 401 jika cookie tidak ada / expired.
  - Middleware mengembalikan HTTP 403 jika role user tidak sesuai izin.

### Task 2: Modul Autentikasi (`/api/auth`)
- **Deskripsi**: Membuat endpoint otentikasi sesi.
- **File Target**:
  - `src/modules/auth/auth.schema.ts` (Zod schema & session DTO)
  - `src/modules/auth/auth.service.ts` (Verifikasi password hash Bcrypt)
  - `src/modules/auth/auth.routes.ts`
- **Daftar Endpoint**:
  1. `POST /api/auth/login`: Validasi input, cek user aktif, set HttpOnly cookie `arrayan_token`, kembalikan profil user.
  2. `POST /api/auth/logout`: Clear cookie sesi.
  3. `GET /api/auth/me`: Ambil data user yang sedang login dari session cookie.
- **Kriteria Penerimaan**:
  - Berhasil login dengan akun seed `superadmin@arrayan.com` / `Password123!`.
  - Percobaan password salah menghasilkan HTTP 401.
  - Akun yang `is_active: false` ditolak login.

### Task 3: Modul Registrasi & Manajemen User (`/api/users`)
- **Deskripsi**: Endpoint khusus Super Admin / HR GA untuk mengelola akun karyawan.
- **File Target**:
  - `src/modules/users/user.schema.ts`
  - `src/modules/users/user.service.ts`
  - `src/modules/users/user.routes.ts`
- **Daftar Endpoint**:
  1. `GET /api/users`: Daftar seluruh user, role, dan profil karyawan (Protected: `SUPER_ADMIN`).
  2. `POST /api/users`: Buat akun user baru + profil employee (Protected: `SUPER_ADMIN`).
- **Kriteria Penerimaan**:
  - Validasi duplikasi NIK dan Email.
  - Role yang dipilih wajib salah satu dari 6 role PRD: `SUPER_ADMIN`, `MANAGEMENT`, `SR_MANAGER`, `MANAGER`, `SUPERVISOR`, `STAFF`.
  - Mendukung penentuan atasan langsung (`managerId`) untuk pohon hirarki (*Tree Branch*).

### Task 4: Dokumentasi Swagger & Pengujian
- **Deskripsi**: Memastikan semua endpoint baru terdokumentasi rapi di Swagger UI.
- **Target URL**: `http://localhost:4000/docs`
- **Kriteria Penerimaan**:
  - Request body dan response schema muncul lengkap di Swagger.
  - Endpoint dapat diuji langsung dari browser Swagger UI.

---

## 🚀 Prosedur Git & Pull Request (Sesuai Opsi A)

1. Semua perubahan kode di-commit ke branch:
   ```bash
   git branch # memastikan berada di feat/setup-planning atau feat/auth-system
   git add .
   git commit -m "feat(auth): implement jwt login, logout, me, and user management"
   git push -u origin feat/setup-planning
   ```
2. Buat Pull Request ke branch `main`:
   ```bash
   gh pr create --title "feat: Authentication & User Management Engine" --body "..."
   ```
3. Review & Merge via GitHub web interface.

