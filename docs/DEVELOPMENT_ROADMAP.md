# Development Roadmap & Implementation Plan — Arryan HRIS

Dokumen ini adalah panduan kerja bertahap (*Step-by-Step Execution Plan*) yang diselaraskan dengan **PRD v2.0 (Post-Meeting Baseline & WhatsApp Requirements)**.

---

## 📋 Status Modul PRD v2.0 vs Kondisi Codebase

| Modul PRD v2.0 | Status Frontend | Status Backend (`arrayan-be`) | Rencana Aksi |
| :--- | :--- | :--- | :--- |
| **Auth & Security** | Form Login prototipe | ✅ Selesai (JWT HttpOnly + Bearer + Refresh Token Rotation + Swagger Docs) | Selesai (PR #5 merged ke `main`) |
| **Module 1: Employee & Tree Branch** | Mock CRUD Karyawan | Tabel `employees`, self-referencing `managerId`, status Probation/Kartap/PKL | Implementasi CRUD Admin & Tree Branch API (Issue #4) |
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
- [x] Unit Tests (Vitest) 15 skenario lulus.
- [x] GitHub Actions CI Quality Gate & Branch Protection di `main`.

### Fase 2: Master Data Karyawan & Tree Branch Divisi (Issue #4 — TAHAP BERIKUTNYA)
- [ ] Endpoint `POST /api/users`: Admin mendaftarkan akun login + data karyawan (Probation 6 bulan, Kartap, PKL).
- [ ] Endpoint `GET /api/users`: List akun dan profil karyawan.
- [ ] Pemetaan atasan langsung (`managerId`) untuk pohon hirarki (*Tree Branch*).
- [ ] Endpoint `GET /api/employees/tree`: Menampilkan struktur organisasi berjenjang (`Management → Sr. Manager → Manager → Supervisor → Staff`).

### Fase 3: Real-Time Attendance & Integrasi Hardware (PRD v2.0 Update)
- [ ] **Mesin Fingerprint Webhook/Receiver**:
  - Endpoint `POST /api/attendance/fingerprint-sync` untuk menerima push log otomatis dari mesin fingerprint fisik kantor.
- [ ] **Geofencing & Wi-Fi Location Lock**:
  - Endpoint `POST /api/attendance/clock-in`: Validasi IP/BSSID jaringan Wi-Fi resmi kantor ATAU koordinat GPS di dalam radius meter yang ditentukan.
- [ ] Kalkulasi status otomatis: *Hadir Tepat Waktu* vs *Terlambat* berdasarkan jam masuk standar kantor.

### Fase 4: Centralized Dashboard Widgets 5-in-1 (PRD v2.0 Update)
- [ ] Endpoint `GET /api/dashboard/widgets`:
  1. *Yang Telat Hari Ini* (log fingerprint / clock-in web > jam batas).
  2. *Yang Cuti Hari Ini* (pengajuan cuti status disetujui pada tanggal hari ini).
  3. *Yang Sakit Hari Ini* (izin sakit pada hari berjalan).
  4. *Birthday Hari Ini* (karyawan dengan `birthDate` sama dengan tanggal hari ini).
  5. *Jadwal Training* (agenda training aktif hari ini dan yang akan datang).

### Fase 5: Cuti, Izin, Reimbursement & Multi-Level Approval
- [ ] Pengajuan cuti/sakit/izin (`POST /api/leaves`).
- [ ] Multi-level approval workflow mengikuti hierarki `managerId` (`Supervisor → Manager → Sr. Manager → HR/Management`).
- [ ] Modul Reimbursement: upload bukti struk dan approval berjenjang.

### Fase 6: KPI Kualitatif/Kuantitatif, Kalender & Extended Training Report
- [ ] Template KPI per divisi, penilaian kuantitatif (angka/target) dan kualitatif (deskriptif).
- [ ] Cascading visibility laporan KPI (hanya atasan dan HR/Management yang bisa melihat bawahan).
- [ ] Kalender Master HR GA & personal view (jadwal training + cuti personal).
- [ ] Modul laporan training dengan kolom *remarks / feedback* peserta pelatihan.
- [ ] Ekspor data rekap ke format Excel (.xlsx) dan PDF.
