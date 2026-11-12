# Development Roadmap & Implementation Plan — Arryan HRIS

Dokumen ini adalah panduan kerja bertahap (*Step-by-Step Execution Plan*) yang diselaraskan dengan **PRD v2.0 (Post-Meeting Baseline & WhatsApp Requirements)**.

---

## 📋 Status Modul PRD v2.0 vs Kondisi Codebase

| Modul PRD v2.0 | Status Frontend | Status Backend (`arrayan-be`) | Rencana Aksi |
| :--- | :--- | :--- | :--- |
| **Auth & Security** | Form Login prototipe | ✅ Selesai (JWT HttpOnly + Bearer + Refresh Token Rotation + Swagger Docs) | Selesai (PR #5 merged ke `main`) |
| **Master Data (Departemen, Jabatan, Kantor, Shift, Cuti, Libur, Training, KPI Template)** | Dropdown masih hardcode | ✅ Schema, migrasi, seed (PR #11) & API CRUD `/api/master/*` selesai | Integrasi dropdown FE ke `/api/master/*` |
| **Module 1: Employee & Tree Branch** | Mock CRUD Karyawan | Tabel `employees` (FK ke master data), self-referencing `managerId`, status Probation/Kartap/PKL | Implementasi CRUD Admin & Tree Branch API (Issue #4) |
| **Module 2: Real-Time Attendance & Geofencing (New)** | Mock Clock-in/out | ⚠️ Belum ada | 1. Webhook/Middleware mesin Fingerprint fisik<br>2. Geofencing radius kantor & Wi-Fi Location Lock validator |
| **Module 3: Centralized Dashboard Widgets (New - 5-in-1)** | Dashboard dasar belum 5-in-1 | ⚠️ Belum ada | Endpoint agregasi real-time:<br>1. *Yang Telat Hari Ini*<br>2. *Yang Cuti Hari Ini*<br>3. *Yang Sakit Hari Ini*<br>4. *Birthday Hari Ini*<br>5. *Jadwal Training* |
| **Module 4: KPI & Performance Evaluation** | Belum ada UI | ⚠️ Belum ada | Skema template kualitatif/kuantitatif, input nilai, chart progress, cascading visibility per divisi |
| **Module 5: Company Calendar & Training Schedule** | Kalender kegiatan dasar | ⚠️ Belum ada | Master kalender HR GA, integrasi otomatis event ultah, cuti pribadi, dan jadwal training |
| **Module 6: Training Management & Extended Reporting** | Belum ada UI | ⚠️ Belum ada | Histori rekap training, form ulasan/remarks peserta, ekspor Excel (.xlsx) / PDF |

---

## 🚀 Rencana Fase Pengembangan Backend Terkini

### Fase 1: Fondasi Auth, Security & CI Quality Gate (✅ SELESAI)
- [x] Inisialisasi Fastify + Prisma + Docker Compose PostgreSQL.
- [x] Model `roles`, `users`, `employees`, `refresh_tokens`.
- [x] Seed 6 Role PRD dan Super Admin default.
- [x] Endpoint `POST /login`, `POST /refresh`, `POST /logout`, `GET /me`.
- [x] Dukungan Dual Transport: Bearer Authorization (`Authorization: Bearer <token>`) & HttpOnly Cookie.
- [x] Swagger OpenAPI Contract di `/docs` dengan tombol **Authorize 🔓**.
- [x] Unit Tests (Vitest) lulus 100% (auth, login limiter, middleware, seed master data).
- [x] GitHub Actions CI Quality Gate & Branch Protection di `main`.

### Fase 2A: Master Data API (✅ SELESAI)
Schema, migrasi (dengan backfill) dan seed master data sudah merged (PR #11). Referensi: [`MASTER_DATA.md`](MASTER_DATA.md).
- [x] Tabel master: `departments` (berjenjang), `job_titles` (+ `level`), `office_locations`, `work_shifts`, `leave_types`, `holidays`, `training_categories`, `kpi_templates` + `kpi_indicators`.
- [x] `employees` memakai FK `jobTitleId` (wajib), `departmentId`, `officeLocationId`, `workShiftId` (`onDelete: Restrict`).
- [x] `GET/POST/PATCH /api/master/<entitas>` + `PATCH /:id/active` (soft deactivate, tanpa DELETE). Baca: semua role terautentikasi; tulis: `SUPER_ADMIN`.
- [x] Validasi bisnis (MASTER_DATA.md §8): `code` UPPER_SNAKE immutable, siklus parent departemen, format `HH:mm`, total bobot KPI = 100.
- [x] Test integrasi dengan Postgres (service di CI) + Swagger tag `Master: <entitas>`.

### Fase 2: Master Data Karyawan, Tree Branch & Email Invitation (Issue #4 — FOKUS TAHAP INI)

#### 📋 User Stories & Cakupan Fitur:
1. **US-2.1 (Enabler): Email Service Engine & Secure Token System**
   - Transporter `nodemailer` dengan driver fleksibel (SMTP Gmail / Resend / Ethereal dev mock).
   - Token generator & SHA-256 hash storage untuk link aktivasi dengan masa berlaku 48 jam.
   - Template email HTML responsif: *"Undangan Aktivasi Akun Karyawan Arryan HRIS"*.
2. **US-2.2 (Feature): Admin Provisioning API (`POST /api/users`)**
   - Hak akses terbatas: Hanya `SUPER_ADMIN` (role "Super Admin / HR GA"). Role `HR_ADMIN` terpisah belum dibuat; bisa ditambah lewat seed bila dibutuhkan.
   - Input payload: Email, NIK unik, Nama Lengkap, `jobTitleId`, `departmentId`, (opsional) `officeLocationId` & `workShiftId`, Jenis Kepegawaian (`PROBATION` 6 bulan, `KARTAP`, `PKL`), Join Date, dan `managerId` (atasan langsung).
   - Otomatis membuat record `User` (status: `PENDING_ACTIVATION`), record `Employee`, dan men-trigger email aktivasi.
3. **US-2.3 (Feature): Account Activation API (`POST /api/auth/activate`)**
   - Endpoint publik menerima token aktivasi & password baru dari karyawan.
   - Validasi kekuatan password (minimal 8 karakter, huruf besar, huruf kecil, angka, simbol).
   - Update password hash, ubah status user menjadi `ACTIVE`, dan hanguskan token aktivasi.
4. **US-2.4 (Feature): Organization Tree Branch Hierarchy API (`GET /api/employees/tree`)** — ✅ selesai
   - Transformasi relasi *self-referencing* `managerId` menjadi struktur pohon bersarang (*nested JSON tree*).
   - Mendukung multi-root (Top Management) hingga level Staff bawahan (`Management → Sr. Manager → Manager → Supervisor → Staff`).
   - Dilengkapi proteksi *circular reference check*: saat membaca, siklus diputus & dilaporkan di `meta.cycleBreaks`; pencegahan saat menulis `managerId` dikerjakan bersama US-2.2.
   - `?rootId=` untuk subtree; children diurutkan berdasarkan level jabatan lalu nama.
5. **US-2.5 (Feature): Employee List, Detail & Search API (`GET /api/employees`, `GET /api/employees/:id`)** — ✅ selesai
   - List karyawan dengan paginasi (`page`, `limit`).
   - Multi-filter: `departmentId` (+ `includeSubDepartments`), `jobTitleId`, `managerId`, `employmentType` (PROBATION, KARTAP, PKL), `accountStatus` (ACTIVE, INACTIVE, NO_ACCOUNT; `PENDING_ACTIVATION` ditambah bersama US-2.2), dan pencarian keyword nama/NIK.
   - Menampilkan relasi atasan langsung (`manager: { id, fullName, jobTitle: { id, code, name, level } }`); `jobTitle` dan `department` berupa objek master data.

---

#### 🏆 Definition of Done (DoD) — Fase 2:
Sebuah task/fitur di Fase 2 dinyatakan **SELESAI (DONE)** jika memenuhi seluruh kriteria berikut:

- [ ] **Functional & Business Rules**:
  - Semua User Story (US-2.1 s/d US-2.5) lolos skenario Acceptance Criteria.
  - Email aktivasi berhasil terkirim dan link aktivasi berfungsi mengubah status dari `PENDING_ACTIVATION` menjadi `ACTIVE`.
  - Struktur pohon organisasi `GET /api/employees/tree` tervalidasi membentuk hierarki yang akurat tanpa duplikasi atau circular loop.
- [ ] **Database & Migrations**:
  - File migrasi Prisma terstruktur rapi dan ter-track di Git (`prisma/migrations`).
  - Constraint unik pada `email` dan `nik` aktif.
- [ ] **Security & Validation**:
  - Seluruh endpoint terproteksi memiliki middleware `authenticate` dan `authorize(['SUPER_ADMIN'])` untuk endpoint tulis.
  - Seluruh request payload divalidasi ketat menggunakan skema Zod (Fastify route schema).
  - Token aktivasi disimpan dalam bentuk SHA-256 hash (bukan plain text).
  - Response payload bersih dari data sensitif (`passwordHash`, token hash).
- [ ] **Automated Testing**:
  - Unit tests & integration tests komprehensif ditulis menggunakan **Vitest**.
  - Menguji *happy path*, *validation error* (duplicate NIK/email, expired token, invalid managerId), dan relasi pohon hirarki.
  - Semua pengujian lulus 100% pada `npm test`.
- [ ] **API Documentation**:
  - Endpoint baru terdaftar di **Swagger OpenAPI 3.0** (`/docs`) lengkap dengan schema request/response, deskripsi, dan contoh data (*examples*).
- [ ] **Git & CI Quality Gate**:
  - Dikerjakan pada branch terpisah: `feat/employee-management`.
  - TypeScript build check lulus (`npm run build` dengan 0 errors).
  - GitHub Actions CI Quality Gate di branch berstatus hijau (passed).
  - Pull Request (PR) dibuka ke `main` dan diverifikasi/dimerge secara eksklusif oleh akun authorized (`rakai77`).

### Fase 3: Real-Time Attendance & Integrasi Hardware (PRD v2.0 Update)
- [ ] **Mesin Fingerprint Webhook/Receiver**:
  - Endpoint `POST /api/attendance/fingerprint-sync` untuk menerima push log otomatis dari mesin fingerprint fisik kantor.
- [ ] **Geofencing & Wi-Fi Location Lock**:
  - Endpoint `POST /api/attendance/clock-in`: Validasi IP/BSSID jaringan Wi-Fi resmi kantor ATAU koordinat GPS di dalam radius meter yang ditentukan.
- [ ] Kalkulasi status otomatis: *Hadir Tepat Waktu* vs *Terlambat* berdasarkan `WorkShift` karyawan (`startTime`, `lateToleranceMinutes`, `workDays`, `isOvernight`).
- [ ] Radius, koordinat, dan Wi-Fi diambil dari `OfficeLocation` (data HO masih placeholder). Endpoint fingerprint menunggu VPS & merek mesin; rumus jarak GPS bisa dibuat dan diuji lebih awal.

### Fase 4: Centralized Dashboard Widgets 5-in-1 (PRD v2.0 Update)
- [ ] Endpoint `GET /api/dashboard/widgets`:
  1. *Yang Telat Hari Ini* (log fingerprint / clock-in web > jam batas).
  2. *Yang Cuti Hari Ini* (pengajuan cuti status disetujui pada tanggal hari ini).
  3. *Yang Sakit Hari Ini* (izin sakit pada hari berjalan).
  4. *Birthday Hari Ini* (karyawan dengan `birthDate` sama dengan tanggal hari ini).
  5. *Jadwal Training* (agenda training aktif hari ini dan yang akan datang).
- [ ] Hari libur dari tabel `Holiday` dikecualikan dari hitungan telat/absen.

### Fase 5: Cuti, Izin, Reimbursement & Multi-Level Approval
- [ ] Pengajuan cuti/sakit/izin (`POST /api/leaves`) memakai `LeaveType` (kuota, `requiresAttachment`, `deductsAnnualLeave`); cuti bersama (`Holiday.kind = COLLECTIVE_LEAVE`) memotong cuti tahunan.
- [ ] Multi-level approval workflow mengikuti hierarki `managerId` (`Supervisor → Manager → Sr. Manager → HR/Management`).
- [ ] Modul Reimbursement: upload bukti struk dan approval berjenjang.

### Fase 6: KPI Kualitatif/Kuantitatif, Kalender & Extended Training Report
- [ ] Template KPI per jabatan/departemen (`KpiTemplate` + `KpiIndicator`, schema sudah ada), penilaian kuantitatif (angka/target) dan kualitatif (deskriptif).
- [ ] Cascading visibility laporan KPI (hanya atasan dan HR/Management yang bisa melihat bawahan).
- [ ] Kalender Master HR GA & personal view (jadwal training + cuti personal).
- [ ] Modul laporan training (kategori dari `TrainingCategory`) dengan kolom *remarks / feedback* peserta pelatihan.
- [ ] Ekspor data rekap ke format Excel (.xlsx) dan PDF.
