# Master Data — Arryan HRIS Backend

Dokumen referensi teknis master data untuk developer BE/FE: struktur tabel, relasi, alur data, dan aturan yang wajib dipatuhi saat membangun API master data dan modul transaksi di fase berikutnya.

- **Sumber kebenaran schema**: [`prisma/schema.prisma`](../prisma/schema.prisma) §4 *MASTER DATA*
- **Migrasi**: [`prisma/migrations/20261110230000_add_master_data`](../prisma/migrations/20261110230000_add_master_data/migration.sql)
- **Data seed**: [`prisma/seed-data/master.ts`](../prisma/seed-data/master.ts) (dieksekusi oleh [`prisma/seed.ts`](../prisma/seed.ts))
- **Tes invarian seed**: [`prisma/seed-data/master.test.ts`](../prisma/seed-data/master.test.ts)
- **Aturan arsitektur**: `AGENTS.md` §1 *Master Data Design Invariants*

> Status: **schema + migrasi + seed selesai**. API CRUD master data (`/api/master/*`) belum dibuat — lihat [§8 Kontrak & Aturan untuk API Berikutnya](#8-kontrak--aturan-untuk-api-berikutnya).

---

## Daftar Isi
1. [Konvensi](#1-konvensi)
2. [Entity Relationship Diagram](#2-entity-relationship-diagram)
3. [Katalog Tabel](#3-katalog-tabel)
4. [Siklus Hidup Master Data](#4-siklus-hidup-master-data)
5. [Alur Migrasi & Backfill](#5-alur-migrasi--backfill)
6. [Alur Seed](#6-alur-seed)
7. [Pemakaian Master Data per Modul](#7-pemakaian-master-data-per-modul)
8. [Kontrak & Aturan untuk API Berikutnya](#8-kontrak--aturan-untuk-api-berikutnya)
9. [Cara Menambah / Mengubah Master Data](#9-cara-menambah--mengubah-master-data)

---

## 1. Konvensi

Setiap tabel master **wajib** memiliki kolom berikut (AGENTS.md §1):

| Kolom Prisma | Kolom DB | Tipe | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `id` | `TEXT` (UUID) | Primary key, di-generate Prisma Client |
| `code` | `code` | `TEXT UNIQUE` | Kode bisnis stabil, format `UPPER_SNAKE` (`^[A-Z0-9]+(_[A-Z0-9]+)*$`). Dipakai seed, integrasi, dan dropdown FE |
| `name` | `name` | `TEXT` | Label tampilan, boleh diubah kapan saja |
| `isActive` | `is_active` | `BOOLEAN` default `true` | Soft-deactivate. **Jangan hapus** row yang sudah direferensikan |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | `TIMESTAMP(3)` | Timestamp standar |

Aturan relasi:
- Seluruh FK dari `employees` / tabel transaksi ke master menggunakan **`ON DELETE RESTRICT`** → database menolak penghapusan master yang masih dipakai.
- Pengecualian: `kpi_indicators.template_id` memakai **`CASCADE`** karena indikator adalah bagian (child) dari template, bukan master mandiri.
- `code` bersifat **immutable** setelah dipakai (lihat §8) — `name` yang boleh diubah.

---

## 2. Entity Relationship Diagram

```mermaid
erDiagram
    employees }o--|| job_titles : "job_title_id (wajib)"
    employees }o--o| departments : "department_id"
    employees }o--o| office_locations : "office_location_id"
    employees }o--o| work_shifts : "work_shift_id"
    employees }o--o| employees : "manager_id (tree branch)"
    departments }o--o| departments : "parent_id (divisi)"
    kpi_templates }o--o| job_titles : "job_title_id"
    kpi_templates }o--o| departments : "department_id"
    kpi_templates ||--|{ kpi_indicators : "template_id (cascade)"

    employees {
        string id PK
        string nik UK
        string full_name
        string job_title_id FK
        string department_id FK
        string office_location_id FK
        string work_shift_id FK
        string manager_id FK
        enum employment_type "PROBATION | KARTAP | PKL"
    }
    departments {
        string id PK
        string code UK
        string name
        string parent_id FK "null = root"
        boolean is_active
    }
    job_titles {
        string id PK
        string code UK
        string name
        enum level "MANAGEMENT..STAFF"
        boolean is_active
    }
    office_locations {
        string id PK
        string code UK
        string name
        decimal latitude "9,6"
        decimal longitude "9,6"
        int radius_meters "default 100"
        text_array wifi_ssids
        text_array wifi_bssids
        string timezone "Asia/Jakarta"
        boolean is_active
    }
    work_shifts {
        string id PK
        string code UK
        string name
        string start_time "HH:mm"
        string end_time "HH:mm"
        int break_minutes
        int late_tolerance_minutes
        int_array work_days "ISO 1-7"
        boolean is_overnight
        boolean is_active
    }
    kpi_templates {
        string id PK
        string code UK
        string name
        enum period "MONTHLY | QUARTERLY | YEARLY"
        string job_title_id FK
        string department_id FK
        boolean is_active
    }
    kpi_indicators {
        string id PK
        string template_id FK
        string name
        enum type "QUANTITATIVE | QUALITATIVE"
        decimal weight "total per template = 100"
        decimal target "khusus QUANTITATIVE"
        string unit
        int sort_order
    }
```

Tabel master **mandiri** (belum direferensikan FK; akan dipakai modul transaksi di fase berikutnya):

```mermaid
erDiagram
    leave_types {
        string id PK
        string code UK
        string name
        enum category "ANNUAL | SICK | PERMISSION | MATERNITY | SPECIAL | UNPAID"
        int default_quota "0 = tanpa kuota"
        boolean is_paid
        boolean requires_attachment
        boolean deducts_annual_leave
        boolean is_active
    }
    holidays {
        string id PK
        string code UK
        string name
        date date "indexed"
        enum kind "NATIONAL | COLLECTIVE_LEAVE | COMPANY"
        boolean is_active
    }
    training_categories {
        string id PK
        string code UK
        string name
        string description
        boolean is_active
    }
```

---

## 3. Katalog Tabel

| Model Prisma | Tabel | Dipakai oleh (fase) | Field khusus & arti |
| :--- | :--- | :--- | :--- |
| `Department` | `departments` | Employee, Tree Branch, KPI, laporan (Fase 2, 6) | `parentId` → divisi berjenjang. `null` = root |
| `JobTitle` | `job_titles` | Employee, approval line, KPI (Fase 2, 5, 6) | `level`: posisi di hierarki PRD. **Bukan** hak akses — RBAC tetap lewat `roles` |
| `OfficeLocation` | `office_locations` | Clock-in geofence & Wi-Fi lock (Fase 3) | `latitude`/`longitude` + `radiusMeters`; `wifiSsids`/`wifiBssids` daftar jaringan resmi; `timezone` untuk konversi jam shift |
| `WorkShift` | `work_shifts` | Kalkulasi telat, dashboard "Yang Telat" (Fase 3, 4) | `startTime`/`endTime` `HH:mm` waktu lokal kantor; `lateToleranceMinutes`; `workDays` ISO (1=Senin); `isOvernight` jika `endTime` jatuh di hari berikutnya |
| `LeaveType` | `leave_types` | Pengajuan cuti, saldo, dashboard "Cuti/Sakit Hari Ini" (Fase 4, 5) | `category` untuk logika bisnis (jangan cek berdasarkan `name`); `defaultQuota` hari/tahun; `deductsAnnualLeave` |
| `Holiday` | `holidays` | Hitung hari kerja cuti, kalender (Fase 5, 6) | `kind = COLLECTIVE_LEAVE` → cuti bersama, memotong saldo cuti tahunan |
| `TrainingCategory` | `training_categories` | Modul training & laporan (Fase 6) | — |
| `KpiTemplate` | `kpi_templates` | Evaluasi KPI (Fase 6) | `jobTitleId` / `departmentId` opsional → cakupan template (lihat §7.4) |
| `KpiIndicator` | `kpi_indicators` | Evaluasi KPI (Fase 6) | `weight` total 100 per template; `target`+`unit` hanya untuk `QUANTITATIVE` |

Enum yang ditambahkan: `HierarchyLevel`, `LeaveCategory`, `HolidayKind`, `KpiPeriod`, `KpiIndicatorType`.

---

## 4. Siklus Hidup Master Data

```mermaid
stateDiagram-v2
    [*] --> Aktif : create (code unik)
    Aktif --> Aktif : update name / atribut (code tetap)
    Aktif --> Nonaktif : set isActive = false
    Nonaktif --> Aktif : set isActive = true
    Aktif --> Dihapus : DELETE (hanya jika belum direferensikan)
    Nonaktif --> Dihapus : DELETE (hanya jika belum direferensikan)
    Dihapus --> [*]

    note right of Nonaktif
        Tidak muncul di dropdown FE
        dan tidak boleh dipilih untuk data baru,
        tetapi relasi historis tetap utuh.
    end note
```

Keputusan saat admin ingin "menghapus" master data:

```mermaid
flowchart TD
    A([Admin menghapus master data]) --> B{Masih direferensikan?<br/>employees / child department /<br/>kpi_templates / transaksi}
    B -- Ya --> C[DB menolak: FK RESTRICT]
    C --> D[API mengembalikan 409 Conflict<br/>dengan saran: nonaktifkan]
    D --> E[Set isActive = false]
    B -- Tidak --> F[DELETE diizinkan]
    E --> G([Data historis tetap valid])
    F --> G
```

---

## 5. Alur Migrasi & Backfill

Migrasi `20261110230000_add_master_data` mengubah `employees.job_title` / `employees.department` (free-text) menjadi FK **tanpa kehilangan data**. SQL hasil `prisma migrate diff` di-edit manual sesuai urutan berikut:

```mermaid
flowchart TD
    S([prisma migrate deploy]) --> A[CREATE enum & 9 tabel master<br/>+ unique index pada code]
    A --> B[ALTER employees ADD COLUMN<br/>job_title_id, department_id,<br/>office_location_id, work_shift_id<br/><i>nullable</i>]
    B --> C[INSERT departments<br/>FROM DISTINCT employees.department<br/>code = UPPER_SNAKE nama lama]
    C --> D[INSERT job_titles<br/>FROM DISTINCT employees.job_title<br/>level = STAFF]
    D --> E[UPDATE employees SET department_id, job_title_id<br/>JOIN berdasarkan code]
    E --> F[ALTER job_title_id SET NOT NULL]
    F --> G[DROP COLUMN job_title, department]
    G --> H[ADD FOREIGN KEY ... ON DELETE RESTRICT<br/>+ index FK]
    H --> Z([Selesai — data lama ter-link ke master])
```

Contoh konversi kode: `"HR & System Admin"` → `HR_SYSTEM_ADMIN`, `"HR GA"` → `HR_GA`.

> Catatan: database yang dimigrasi dari data lama dapat memiliki master hasil backfill (mis. department `HR_GA`) di samping master seed (`HRD`). Seed tidak menimpa FK karyawan yang sudah terisi. Rapikan via aplikasi (pindahkan karyawan → nonaktifkan master lama) atau `prisma migrate reset` di lingkungan dev.

---

## 6. Alur Seed

`npm run prisma:seed` bersifat **idempotent** — semua entri di-`upsert` berdasarkan `code`, aman dijalankan berulang kali.

```mermaid
sequenceDiagram
    autonumber
    participant CLI as npm run prisma:seed
    participant Seed as prisma/seed.ts
    participant Data as seed-data/master.ts
    participant DB as PostgreSQL

    CLI->>Seed: main()
    Seed->>DB: upsert roles (6 role PRD)
    Seed->>Data: import konstanta master
    Note over Seed,DB: seedMasterData()
    Seed->>DB: upsert departments (parent dulu, simpan map code→id)
    Seed->>DB: upsert job_titles (simpan map code→id)
    Seed->>DB: upsert office_locations, work_shifts
    Seed->>DB: upsert leave_types, holidays, training_categories
    Seed->>DB: upsert kpi_templates + ganti seluruh kpi_indicators
    Seed->>DB: upsert user superadmin@arrayan.com
    Note over Seed,DB: seedSuperAdminEmployee()
    alt Employee ADM-001 belum ada
        Seed->>DB: create employee + semua FK master
    else Sudah ada
        Seed->>DB: isi hanya FK yang masih null (tidak menimpa perubahan admin)
    end
```

Struktur department hasil seed:

```mermaid
flowchart TD
    HQ["HQ — Arryan HQ"] --> ENG["ENG — Engineering"]
    HQ --> HRD["HRD — People & Culture (HR GA)"]
    HQ --> FIN["FIN — Finance"]
    HQ --> OPS["OPS — Operations"]
```

Ringkasan isi seed:

| Entitas | Kode yang di-seed |
| :--- | :--- |
| Department | `HQ`, `ENG`, `HRD`, `FIN`, `OPS` |
| JobTitle (level) | `DIRECTOR` (MANAGEMENT), `SR_MANAGER`, `MANAGER`, `SUPERVISOR`, `STAFF`, `HR_SYSTEM_ADMIN` (STAFF), `INTERN` (STAFF) |
| OfficeLocation | `HO` — ⚠️ **koordinat & Wi-Fi placeholder**, ganti sebelum go-live |
| WorkShift | `REGULAR` 08:00–17:00, istirahat 60 mnt, toleransi 15 mnt, Senin–Jumat |
| LeaveType | `ANNUAL` 12 hari, `SICK` 6 (lampiran wajib), `MATERNITY` 90, `PERMISSION`, `UNPAID` |
| Holiday | 6 libur 2026–2027 (4 nasional, 2 cuti bersama) |
| TrainingCategory | `INTERNAL`, `EXTERNAL`, `CERTIFICATION`, `ONBOARDING` |
| KpiTemplate | `STAFF_GENERAL` (QUARTERLY, jabatan `STAFF`, 3 indikator: 30/40/30) |
| Super Admin `ADM-001` | `HR_SYSTEM_ADMIN` · `HRD` · `HO` · `REGULAR` |

---

## 7. Pemakaian Master Data per Modul

Alur berikut adalah **rancangan** pemakaian master data oleh modul fase berikutnya — menjadi acuan saat implementasi API.

### 7.1 Clock-in (Fase 3) — `OfficeLocation` + `WorkShift`

```mermaid
flowchart TD
    A([POST /api/attendance/clock-in]) --> B[Ambil employee + officeLocation + workShift]
    B --> C{officeLocation aktif<br/>& terisi?}
    C -- Tidak --> X1[422: lokasi kantor belum di-set]
    C -- Ya --> D{BSSID/SSID klien ada di<br/>wifiBssids / wifiSsids?}
    D -- Ya --> G[Lokasi valid]
    D -- Tidak --> E{Jarak GPS ke lat/long<br/>≤ radiusMeters?}
    E -- Ya --> G
    E -- Tidak --> X2[403: di luar area kantor]
    G --> H[Waktu server dikonversi ke officeLocation.timezone]
    H --> I{Hari ini termasuk workShift.workDays<br/>dan bukan Holiday aktif?}
    I -- Tidak --> J[Catat sebagai lembur / di luar jadwal]
    I -- Ya --> K{jam masuk ≤ startTime +<br/>lateToleranceMinutes?}
    K -- Ya --> L[Status PRESENT]
    K -- Tidak --> M[Status LATE → widget Yang Telat Hari Ini]
```

### 7.2 Pengajuan Cuti (Fase 5) — `LeaveType` + `Holiday` + `WorkShift`

```mermaid
flowchart TD
    A([POST /api/leaves]) --> B{leaveType aktif?}
    B -- Tidak --> X1[422: jenis cuti tidak tersedia]
    B -- Ya --> C{requiresAttachment<br/>dan lampiran kosong?}
    C -- Ya --> X2[422: lampiran wajib]
    C -- Tidak --> D[Hitung hari kerja = rentang tanggal<br/>− hari di luar workShift.workDays<br/>− Holiday NATIONAL/COMPANY aktif]
    D --> E{defaultQuota > 0?}
    E -- Ya --> F{saldo cukup?}
    F -- Tidak --> X3[422: saldo tidak cukup]
    F -- Ya --> G[Buat pengajuan PENDING]
    E -- Tidak --> G
    G --> H[Approval berjenjang via managerId<br/>& level JobTitle]
```

Catatan: `Holiday.kind = COLLECTIVE_LEAVE` mengurangi saldo cuti `ANNUAL` secara otomatis (bukan sebagai hari libur bebas), dan `LeaveType.category = SICK` menjadi sumber widget *Yang Sakit Hari Ini*.

### 7.3 Provisioning Karyawan (Fase 2, US-2.2) — validasi FK master

```mermaid
flowchart LR
    A([POST /api/users]) --> B[Payload: jobTitleId, departmentId,<br/>officeLocationId, workShiftId, managerId]
    B --> C{Setiap id ada<br/>dan isActive = true?}
    C -- Tidak --> X[422: master data tidak valid / nonaktif]
    C -- Ya --> D{level jabatan atasan<br/>lebih tinggi dari bawahan?}
    D -- Tidak --> W[Peringatan / tolak sesuai kebijakan]
    D -- Ya --> E[Create User + Employee]
```

### 7.4 Resolusi Template KPI (Fase 6)

Template dipilih dari yang **paling spesifik** ke yang paling umum:

```mermaid
flowchart TD
    A([Karyawan: jobTitleId J, departmentId D]) --> B{Ada template aktif<br/>jobTitle = J DAN department = D?}
    B -- Ya --> R([Pakai template tsb])
    B -- Tidak --> C{Ada template aktif<br/>jobTitle = J, department null?}
    C -- Ya --> R
    C -- Tidak --> D{Ada template aktif<br/>department = D, jobTitle null?}
    D -- Ya --> R
    D -- Tidak --> E{Ada template umum<br/>keduanya null?}
    E -- Ya --> R
    E -- Tidak --> X([Belum ada template — HR membuat template])
```

---

## 8. API Master Data & Aturan Validasi

### Endpoint

Tersedia di `/api/master/<entitas>` untuk `departments`, `job-titles`, `office-locations`, `work-shifts`, `leave-types`, `holidays`, `training-categories`, `kpi-templates`. Kontrak lengkap + contoh body: Swagger `/docs` (tag `Master: …`).

| Method & Path | Akses | Keterangan |
| :--- | :--- | :--- |
| `GET /api/master/<entitas>` | Semua user login | List aktif. Query: `q` (cari code/name), `page`, `limit` (≤ 200, default 100), `includeInactive=true` (hanya `SUPER_ADMIN`) + filter khusus entitas |
| `GET /api/master/<entitas>/:id` | Semua user login | Detail (termasuk yang nonaktif) |
| `POST /api/master/<entitas>` | `SUPER_ADMIN` | Buat data → `201` |
| `PATCH /api/master/<entitas>/:id` | `SUPER_ADMIN` | Ubah sebagian field; `code` ditolak |
| `PATCH /api/master/<entitas>/:id/active` | `SUPER_ADMIN` | Body `{ "isActive": false }` — soft deactivation. **Tidak ada DELETE** |

Filter khusus: `departments?parentId=`, `job-titles?level=`, `leave-types?category=`, `holidays?year=&kind=`, `kpi-templates?jobTitleId=&departmentId=`.

Format response: list `{ statusCode, data: [...], meta: { page, limit, total } }`; detail/tulis `{ statusCode, message?, data }`; error `{ statusCode, error, message, details?: [{ path, message }] }`. Angka desimal (`latitude`, `weight`, `target`) dikirim sebagai `number`; `Holiday.date` sebagai `yyyy-MM-dd`.

Kode status: `400` validasi, `401` belum login, `403` bukan `SUPER_ADMIN`, `404` tidak ditemukan, `409` `code` duplikat, `422` referensi tidak valid / siklus departemen / induk nonaktif.

Implementasi: [`src/modules/master/`](../src/modules/master/) — konfigurasi per entitas di `master.entities.ts`, route generik di `master.routes.ts`, aturan murni di `master.rules.ts`.

### Aturan validasi

Aturan berikut **tidak** bisa dijamin oleh constraint database sehingga divalidasi di layer API (Zod + `master.rules.ts`):

| Entitas | Aturan |
| :--- | :--- |
| Semua | `code` cocok `^[A-Z0-9]+(_[A-Z0-9]+)*$`, unik (DB menjamin unik → map error Prisma `P2002` ke **409**) |
| Semua | `code` tidak boleh diubah setelah dibuat; ubah `name` saja |
| Semua | Tidak ada endpoint hapus; gunakan `PATCH /:id/active`. Referensi FK yang tidak ada (Prisma `P2003`) → **422** |
| Semua | Endpoint list untuk dropdown default `isActive = true`; `SUPER_ADMIN` bisa `?includeInactive=true` |
| `Department` | Parent harus ada & aktif; tidak boleh menjadi parent dirinya sendiri / membentuk siklus (`wouldCreateDepartmentCycle`) → **422** |
| `WorkShift` | `startTime`, `endTime` format `HH:mm` dan tidak sama; `workDays` unik, nilai 1–7 (disimpan terurut); `isOvernight = true` jika dan hanya jika `endTime < startTime` (dicek juga pada PATCH sebagian) |
| `OfficeLocation` | `latitude` −90..90, `longitude` −180..180, `radiusMeters` > 0; BSSID format MAC `AA:BB:CC:DD:EE:FF` |
| `LeaveType` | `defaultQuota` ≥ 0 |
| `Holiday` | `date` format `yyyy-MM-dd`; satu tanggal boleh punya lebih dari satu entri dengan `code` berbeda |
| `KpiTemplate` | Total `weight` indikator = 100 (maks. 2 desimal); `QUALITATIVE` tanpa `target`; `QUANTITATIVE` wajib `target`; PATCH `indicators` mengganti seluruh daftar |
| Hak akses | Create/update/deactivate: `SUPER_ADMIN` (HR GA). Read (list aktif): semua user terautentikasi |

### Kontrak yang sudah berlaku — session payload auth

Sejak master data, `user.employee` pada response `POST /api/auth/login`, `POST /api/auth/refresh`, dan `GET /api/auth/me` berbentuk:

```json
{
  "id": "4220e53d-…",
  "nik": "ADM-001",
  "fullName": "Super Administrator HR",
  "jobTitle": { "id": "749e9f5b-…", "code": "HR_SYSTEM_ADMIN", "name": "HR & System Admin", "level": "STAFF" },
  "department": { "id": "ec3139a9-…", "code": "HRD", "name": "People & Culture" },
  "managerId": null
}
```

Mapping dilakukan di `toSessionPayload()` — [`src/modules/auth/auth.service.ts`](../src/modules/auth/auth.service.ts).

---

## 9. Cara Menambah / Mengubah Master Data

### Menambah nilai seed (mis. departemen baru)
1. Tambahkan entri di [`prisma/seed-data/master.ts`](../prisma/seed-data/master.ts) (department: parent harus didefinisikan lebih dulu).
2. `npm test` — tes invarian seed memvalidasi format kode, referensi, dan bobot KPI.
3. `npm run prisma:seed` — upsert, tidak menduplikasi data.

### Menambah kolom / tabel master baru

```mermaid
flowchart LR
    A[Edit schema.prisma<br/>ikuti konvensi §1] --> B[npx prisma format<br/>& prisma validate]
    B --> C["Buat migrasi:<br/>prisma migrate dev #45;#45;name ..."]
    C --> D{Mengubah kolom<br/>yang berisi data?}
    D -- Ya --> E["#45;#45;create-only lalu edit SQL:<br/>tambah nullable → backfill → NOT NULL"]
    D -- Tidak --> F[Gunakan SQL hasil generate]
    E --> G[Update seed-data + test]
    F --> G
    G --> H[Update dokumen ini<br/>ERD & katalog]
    H --> I[npm test & npm run build<br/>→ PR ke main]
```

Checklist PR master data:
- [ ] Model memiliki `id`, `code @unique`, `name`, `isActive`, timestamps, `@@map` snake_case
- [ ] FK baru memakai `onDelete: Restrict` (atau `SetNull` jika memang opsional historis) + `@@index`
- [ ] Migrasi tidak menghapus data yang ada (backfill bila perlu)
- [ ] Seed idempotent & tes invarian diperbarui
- [ ] ERD dan katalog di dokumen ini diperbarui
