# Development Roadmap & Implementation Plan — Arryan HRIS

Dokumen ini adalah panduan kerja bertahap (*Step-by-Step Execution Plan*) yang diselaraskan dengan **PRD v2.0 (Post-Meeting Baseline & WhatsApp Requirements)**.

---

## 📋 Status Modul PRD v2.0 vs Kondisi Codebase

| Modul PRD v2.0 | Status Frontend | Status Backend (`arrayan-be`) | Rencana Aksi |
| :--- | :--- | :--- | :--- |
| **Auth & Security** | Form Login prototipe | ✅ Selesai (JWT HttpOnly + Bearer + Refresh Token Rotation + Swagger Docs) | Selesai (PR #5 merged ke `main`) |
| **Master Data (Departemen, Jabatan, Kantor, Shift, Cuti, Libur, Training, KPI Template)** | Dropdown masih hardcode | ✅ Schema, migrasi, seed (PR #11) & API CRUD `/api/master/*` selesai | Integrasi dropdown FE ke `/api/master/*` |
| **Module 1: Employee & Tree Branch** | Mock CRUD Karyawan | ✅ CRUD admin, status aktif/keluar, akun & aktivasi, list/detail/tree API | Integrasi FE; driver email saat VPS siap |
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
1. **US-2.1 (Enabler): Secure Token & Invitation Delivery** — ✅ selesai (driver `log`; driver email/WA menyusul)
   - Tabel token generik (`ACTIVATION`, `PASSWORD_RESET`): token acak, disimpan sebagai hash SHA-256, sekali pakai, masa berlaku aktivasi 48 jam.
   - Pengiriman undangan lewat antarmuka `InvitationSender` (driver dapat diganti). Saat ini driver `log`: link aktivasi ditulis ke log dan dikembalikan di response **hanya di luar production**.
   - Driver email (`nodemailer` SMTP / Resend) + template HTML *"Undangan Aktivasi Akun Karyawan Arryan HRIS"* menyusul saat VPS & provider siap — cukup tambah driver, tanpa ubah endpoint/DB. Driver WhatsApp dimungkinkan dengan pola yang sama.
2. **US-2.2 (Feature): Admin Provisioning API** — ✅ selesai
   - Hak akses: hanya `SUPER_ADMIN` (tim HR GA). Super Admin boleh membuat akun Super Admin lain.
   - `POST /api/employees`: buat data karyawan (NIK unik, nama, `jobTitleId`, `departmentId`, opsional `officeLocationId`/`workShiftId`, jenis kepegawaian, join date, `managerId`). Akun login **opsional** — tidak semua karyawan dibuatkan akun; HR yang memutuskan.
   - `POST /api/employees/:id/account`: buat akun (`User` status `PENDING_ACTIVATION`) + kirim undangan. Role default mengikuti level jabatan (mis. Direktur → `MANAGEMENT`), dapat diubah HR.
   - `POST /api/employees/:id/account/invitation`: kirim ulang undangan (token lama hangus).
   - `PATCH /api/employees/:id`: ubah data karyawan; `managerId` ditolak bila membentuk siklus atasan.
   - `PATCH /api/employees/:id/status`: nonaktifkan (karyawan keluar) / aktifkan kembali. Data & riwayat tidak dihapus; akun ikut dinonaktifkan dan sesi dicabut. Saat diaktifkan kembali, akun wajib aktivasi ulang lewat link baru; jabatan/atasan/departemen lama dipertahankan.
3. **US-2.3 (Feature): Account Activation API (`POST /api/auth/activate`)** — ✅ selesai
   - Endpoint publik menerima token aktivasi & password baru dari karyawan.
   - Validasi kekuatan password (minimal 8 karakter, huruf besar, huruf kecil, angka, simbol).
   - Set password hash, ubah status user menjadi `ACTIVE`, dan hanguskan token aktivasi.
4. **US-2.4 (Feature): Organization Tree Branch Hierarchy API (`GET /api/employees/tree`)** — ✅ selesai
   - Transformasi relasi *self-referencing* `managerId` menjadi struktur pohon bersarang (*nested JSON tree*).
   - Mendukung multi-root (Top Management) hingga level Staff bawahan (`Management → Sr. Manager → Manager → Supervisor → Staff`).
   - Dilengkapi proteksi *circular reference check*: saat membaca, siklus diputus & dilaporkan di `meta.cycleBreaks`; pencegahan saat menulis `managerId` dikerjakan bersama US-2.2.
   - `?rootId=` untuk subtree; children diurutkan berdasarkan level jabatan lalu nama.
5. **US-2.5 (Feature): Employee List, Detail & Search API (`GET /api/employees`, `GET /api/employees/:id`)** — ✅ selesai
   - List karyawan dengan paginasi (`page`, `limit`).
   - Multi-filter: `departmentId` (+ `includeSubDepartments`), `jobTitleId`, `managerId`, `employmentType` (PROBATION, KARTAP, PKL), `status` karyawan (default `ACTIVE`), `accountStatus` (ACTIVE, PENDING_ACTIVATION, DISABLED, NO_ACCOUNT), dan pencarian keyword nama/NIK.
   - Menampilkan relasi atasan langsung (`manager: { id, fullName, jobTitle: { id, code, name, level } }`); `jobTitle` dan `department` berupa objek master data.

---

6. **US-2.6 (Feature): Password Recovery & Change** — ✅ selesai
   - `POST /api/auth/forgot-password`: link reset (berlaku 1 jam) hanya untuk akun aktif; respons selalu sama (tidak membocorkan email terdaftar); maks. 3 permintaan per IP + email per 15 menit.
   - `POST /api/auth/reset-password`: token sekali pakai + kebijakan password; seluruh sesi lain dicabut.
   - `POST /api/auth/change-password` (login): verifikasi password saat ini, sesi lain dicabut, sesi baru diterbitkan untuk perangkat saat ini; maks. 5 percobaan salah per 15 menit.
   - Link dikirim lewat `InvitationSender` yang sama (driver `log` saat ini).

#### 🧭 Keputusan Bisnis (disepakati 12 Nov 2026)
| Topik | Keputusan |
| :--- | :--- |
| Pembuat akun | Hanya `SUPER_ADMIN` (dipakai tim HR GA, sesuai PRD "Super Admin / HR GA"). Menu buat karyawan hanya tampil untuk role ini |
| Role akun baru | Sesuai orangnya, default dari level jabatan: Direktur/Komisaris → `MANAGEMENT`, Sr. Manager/Manager/Supervisor/Staff → role sesuai level; HR → `SUPER_ADMIN`. HR dapat mengubah |
| Karyawan tanpa akun | Diperbolehkan; pembuatan akun sepenuhnya keputusan HR |
| Super Admin lain | Super Admin boleh membuat akun Super Admin lain |
| Karyawan keluar | Tidak dihapus — status `INACTIVE` (+ tanggal keluar). Akun dinonaktifkan & sesi dicabut. Bisa diaktifkan kembali (aktivasi ulang via link baru, data penugasan lama dipertahankan) |
| Link aktivasi sebelum ada email | Ditampilkan di response API & log hanya di mode non-production |
| Approval cuti | Berjenjang dari bawah ke atas mengikuti rantai atasan (`managerId`); jumlah level menunggu klien → dibuat dapat dikonfigurasi (Fase 5) |

#### ❓ Pertanyaan Terbuka untuk Klien (Fase 5)
1. Minimal berapa level approval cuti/izin/reimbursement? Apakah berbeda per jenis cuti?
2. Siapa yang memberi approval bila karyawan tidak punya atasan (mis. level Management)?
3. Apakah HR/Super Admin dapat memberi approval akhir atau membatalkan (override) keputusan approval?
4. Bila atasan sedang cuti/berhalangan, apakah approval dialihkan ke atasan berikutnya (delegasi)?

---

#### 🏆 Definition of Done (DoD) — Fase 2:
Sebuah task/fitur di Fase 2 dinyatakan **SELESAI (DONE)** jika memenuhi seluruh kriteria berikut:

- [ ] **Functional & Business Rules**:
  - Semua User Story (US-2.1 s/d US-2.6) lolos skenario Acceptance Criteria.
  - Undangan aktivasi terkirim melalui `InvitationSender` dan link aktivasi berfungsi mengubah status dari `PENDING_ACTIVATION` menjadi `ACTIVE` (driver email menyusul saat VPS siap).
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
  - Dikerjakan pada branch fitur terpisah (`feat/*`).
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
