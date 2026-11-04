# Frontend Architecture & Guidelines — Arryan HRIS Platform

Dokumen ini mendefinisikan standar pengembangan, arsitektur, pola kode (*code patterns*), dan panduan antarmuka (UI/UX) untuk aplikasi frontend **Arryan HRIS Platform**.

Dokumen ini melengkapi baseline prototipe yang sudah ada di `apps/web` (atau `arrayan-proj`) agar pengembangan modul baru dan transisi dari mock ke API berjalan konsisten dan rapi.

---

## 1. Tech Stack & Library Utama

| Kategori | Teknologi | Versi / Referensi | Catatan Penggunaan |
| :--- | :--- | :--- | :--- |
| **Framework** | **React 19 + Vite** | React 19.x / Vite 6+ | SPA berbasis Vite, build cepat, modern concurrency. |
| **Bahasa** | **TypeScript** | ~5.8 / 6.0 | Strict type safety, shared types dengan Backend. |
| **Styling** | **Tailwind CSS v4** | `@tailwindcss/vite` | Utility-first CSS modern tanpa postcss config usang. |
| **Routing** | **React Router** | v7.x (`react-router-dom`) | Declarative client-side routing. |
| **Icons** | **Lucide React** | `lucide-react` | Kumpulan icon konsisten dan ringan. |
| **Date Utility** | **date-fns** | `date-fns` v4 | Format tanggal ISO, kalkulasi hari cuti/absen. |
| **Export Engine** | **xlsx** | `xlsx` | Ekspor tabel data ke spreadsheet `.xlsx` di sisi browser. |
| **Linter** | **Oxlint** | `oxlint` | Linter ultra-cepat pengganti ESLint standar. |

---

## 2. Struktur Folder & Modularitas (`src/`)

Frontend mengadopsi arsitektur **Feature-Driven / Module-Based**, memisahkan domain bisnis agar tidak saling tumpang tindih:

```text
src/
├── app/                             <-- Konfigurasi global aplikasi
│   ├── providers/                   <-- AuthProvider, RoleProvider, ThemeProvider
│   ├── routes/                      <-- nav.ts, route definitions & guards
│   └── hooks/                       <-- Global hooks (useRole, useAuth)
│
├── components/                      <-- Komponen bersama (Reusable)
│   ├── ui/                          <-- Button, Input, Modal, Badge, Card, Table
│   └── layout/                      <-- Sidebar, Header, PageContainer, Breadcrumbs
│
├── modules/                         <-- Fitur spesifik per domain (Feature Modules)
│   ├── attendance/                  <-- Clock-in/out, GPS/Camera capture, Rekap absen
│   ├── leave/                       <-- Pengajuan cuti/izin & tabel approval
│   ├── reimbursement/               <-- Form klaim biaya & upload nota (Modul Baru)
│   ├── kpi/                         <-- Template evaluasi & visualisasi chart (Modul Baru)
│   ├── training/                    <-- Jadwal training & remarks peserta (Modul Baru)
│   ├── calendar/                    <-- Master calendar & filter jadwal personal
│   ├── employees/                   <-- Master data, status kerja, & detail karyawan
│   ├── contracts/                   <-- SK/Kontrak (Probation, Kartap, PKL)
│   ├── dashboard/                   <-- POV Dashboard per role
│   ├── reports/                     <-- Laporan terintegrasi & tombol export
│   └── settings/                    <-- Pengaturan sistem & profile
│
├── services/                        <-- API Data Access Layer
│   ├── api.ts                       <-- Axios/Fetch instance, interceptor, base URL
│   ├── auth.service.ts              <-- Login, logout, session me
│   ├── employee.service.ts          <-- CRUD karyawan & tree hierarchy
│   ├── attendance.service.ts        <-- Clock-in/out data
│   ├── leave.service.ts             <-- Cuti & riwayat approval
│   ├── reimbursement.service.ts     <-- Klaim & approval reimbursement
│   ├── kpi.service.ts               <-- Template & nilai KPI
│   └── training.service.ts          <-- Jadwal training & remarks
│
├── types/                           <-- Type Definitions
│   └── index.ts                     <-- Kontrak domain & DTO
│
├── mocks/                           <-- Data simulasi untuk pengujian lokal
└── lib/                             <-- Utility murni (formatCurrency, formatDate, cn)
```

---

## 3. Pola Data Access Layer (`src/services/`)

Untuk memudahkan transisi dari **Mock Mode** ke **Backend API Asli**, semua komponen UI **DILARANG** melakukan `fetch()` atau `axios()` secara langsung di dalam file `.tsx`.

### Aturan Baku:
1. Semua komunikasi data wajib melalui fungsi di `src/services/*.service.ts`.
2. Komponen UI hanya memanggil *Service Method*:
   ```tsx
   // CONTOH DI KOMPONEN (EmployeeList.tsx):
   useEffect(() => {
     employeeService.list({ departmentId })
       .then(setEmployees)
       .catch(handleError)
   }, [departmentId])
   ```
3. Saat backend sudah siap, kita hanya mengganti implementasi di dalam service tersebut tanpa menyentuh tampilan antarmuka sama sekali.

---

## 4. Manajemen Autentikasi & Role Matrix di UI

Sesuai PRD v1.1, terdapat 6 role:
`super_admin`, `management`, `senior_manager`, `manager`, `supervisor`, `staff`.

### 4.1. Transisi `RoleProvider` ke `AuthProvider`
Saat ini di `src/app/providers/RoleProvider.tsx`, role masih berupa switch simulasi lokal. Transisi ke sistem nyata:
- `AuthProvider` akan memanggil `authService.getProfile()` saat aplikasi pertama kali dimuat.
- Data sesi pengguna saat ini (`user`, `role`, `permissions`, `departmentId`) disimpan di Context.

### 4.2. Navigasi Berdasarkan Role (`src/app/routes/nav.ts`)
Setiap menu di sidebar memiliki aturan keterlihatan (*visibility rule*):
```ts
export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  allowedRoles: Role[]
}

export const MAIN_NAV: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    allowedRoles: ['super_admin', 'management', 'senior_manager', 'manager', 'supervisor', 'staff']
  },
  {
    label: 'Master Karyawan',
    href: '/employees',
    icon: Users,
    allowedRoles: ['super_admin'] // Hanya HR GA / Super Admin yang bisa kelola
  },
  {
    label: 'Evaluasi KPI',
    href: '/kpi',
    icon: Target,
    allowedRoles: ['super_admin', 'management', 'senior_manager', 'manager', 'supervisor', 'staff']
  }
]
```

---

## 5. Standar Antarmuka Khusus Fitur HRIS

### 5.1. Presensi: Akses Kamera & GPS (Mobile-First)
Presensi sering dilakukan melalui browser HP oleh karyawan di lapangan:
- **Responsive Viewport**: Halaman clock-in wajib ramah layar sentuh (*touch-friendly*).
- **Penanganan Izin (Permission Handling)**:
  - Jika izin kamera atau GPS ditolak oleh pengguna, tampilkan pesan edukatif yang ramah (*"Izinkan akses lokasi & kamera untuk melakukan presensi"*), jangan biarkan halaman crash.
  - Hentikan *media stream* kamera segera setelah foto diambil untuk menghemat baterai HP karyawan.

### 5.2. Masking Data Sensitif (Keamanan Visual)
Gunakan komponen helper untuk data pribadi:
```tsx
// Komponen MaskedText:
<MaskedText 
  value={employee.baseSalary} 
  type="currency" 
  canReveal={isHrAdmin || isSelf} 
/>
// Menampilkan "Rp 8.***.***" secara default, dan baru menampilkan angka asli saat tombol mata diklik.
```

### 5.3. Status Badges Konsisten
Gunakan warna status standar di seluruh modul (Cuti, Reimburse, Kontrak, Presensi):
- **Pending / In Review**: Kuning/Oranye (`bg-amber-100 text-amber-800 border-amber-200`)
- **Approved / Active / Present**: Hijau (`bg-emerald-100 text-emerald-800 border-emerald-200`)
- **Rejected / Terminated / Absent**: Merah (`bg-rose-100 text-rose-800 border-rose-200`)
- **Probation / Info**: Biru/Ungu (`bg-sky-100 text-sky-800 border-sky-200`)

---

## 6. Standar Kualitas & Performa (Performance Rules)

Sesuai kriteria non-functional PRD (**waktu muat < 2 detik**):
1. **Lazy Loading Route**: Gunakan `React.lazy()` pada setiap halaman modul agar bundle awal tetap kecil dan cepat terbuka.
2. **Optimasi Asset Gambar**:
   - Foto selfie dan dokumen yang diunggah harus dikompresi di sisi browser sebelum dikirim ke API (maksimal resolusi 1280x720 untuk selfie presensi).
3. **Empty States & Skeletons**:
   - Selalu sediakan skeleton loader saat fetching data berlangsung.
   - Sediakan tampilan kosong (*Empty State*) yang informatif saat tabel/daftar tidak memiliki data.

---

## 7. Checklist Implementasi Modul Baru di Frontend

Saat membuat modul baru (Reimbursement, KPI, Training):
- [ ] Buat folder modul di `src/modules/<nama-modul>/`.
- [ ] Buat service terkait di `src/services/<nama-modul>.service.ts`.
- [ ] Definisikan tipe datanya di `src/types/index.ts`.
- [ ] Daftarkan link halaman dan hak akses role di `src/app/routes/nav.ts`.
- [ ] Pastikan form memiliki validasi error yang jelas sebelum tombol submit aktif.

