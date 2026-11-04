# Product Requirement Document (PRD) — Custom HRIS Platform

- **Project Name**: Arryan HRIS Platform
- **Version**: 2.0 (Updated Post-Meeting Baseline & WhatsApp Requirements)
- **Author**: Internal Team / Product Lead
- **Target Audience**: Freelance Development Team / Vendor / In-house Engineers
- **Deployment & Ownership**: Self-Hosted / Beli Putus (Disimpan di server klien, skala 10–50 karyawan)

---

## 1. Overview & Objectives

Arryan HRIS adalah sistem manajemen sumber daya manusia (HRIS) berbasis web custom yang dirancang untuk mengotomatisasi operasional internal perusahaan. 

Sistem ini mencakup:
- Manajemen master data karyawan & berkas identitas.
- Skema status kerja (*Probation*, *Kartap*, *PKL/Intern*).
- Absensi real-time berbasis **integrasi mesin fingerprint fisik**, **Geofencing (radius kantor)**, dan **Wi-Fi Location Lock**.
- Pengajuan cuti/izin/reimburse dengan alur approval berjenjang.
- **Centralized Dashboard Widgets (5-in-1 Dashboard Real-time)**.
- Evaluasi kinerja (KPI kualitatif & kuantitatif) berbasis hirarki organisasi (*Tree Branch*).
- Kalender perusahaan & pelatihan terpersonalisasi.
- Pelaporan terintegrasi (Absensi, Cuti, Training, Payroll) dengan ekspor Excel (.xlsx) / PDF.

---

## 2. User Roles & Permission Matrix (Hak Akses)

| Role | Deskripsi & Hak Akses |
| :--- | :--- |
| **Super Admin / HR GA** | **Akses penuh (Full Access)** ke seluruh modul, pengaturan sistem, kelola data karyawan, persetujuan (*approval*) cuti/klaim, kalender pusat, pembuatan seluruh laporan, dan pembuatan parameter penilaian KPI. |
| **Management** | Puncak rantai kepemimpinan (*Top Hierarchy*). Akses melihat seluruh data perusahaan (*Read-Only Across All Divisions*), hak approval cuti, serta pemantauan dashboard kehadiran/keterlambatan real-time. Tidak memiliki hak edit/create data sistem. |
| **Senior Manager** | Memegang sebuah divisi utama. Mengelola tim/departemen di bawah divisinya, melakukan approval izin/cuti bawahan, serta review kinerja (KPI) tim pada rantai divisinya. |
| **Manager** | Berada di bawah Senior Manager. Mengelola sub-divisi/tim bawahannya, melakukan approval izin/cuti bawahan, serta review kinerja (KPI) tim pada rantai divisinya. |
| **Supervisor** | Mengawasi staf langsung. Melakukan review/evaluasi kinerja tim bawahannya. |
| **Staff / Karyawan** | Absensi harian (via Wi-Fi/radius kantor), pengajuan cuti/izin/reimburse, jadwal training pribadi, kalender internal, serta cek sisa jatah cuti. |

---

## 3. Detailed Core Modules & Features

### Module 1: Employee Database & Employment Status
- **Status Kepegawaian (Employment Types)**:
  - **Probation**: Masa percobaan standar 6 bulan sebelum diangkat menjadi Karyawan Tetap.
  - **Karyawan Tetap (Kartap)**: Karyawan yang telah lolos evaluasi probation.
  - **PKL / Intern**: Siswa/Mahasiswa magang dengan fitur dan hak akses terbatas sesuai kebutuhan.
- **Master Data & Document Storage**:
  - Profil: NIK, Nama, Jabatan, Divisi, TMT (Terhitung Mulai Tanggal), Kontrak/SK.
  - Dokumen sensitif: Foto KTP, NPWP, BPJS Kesehatan & Ketenagakerjaan.
  - Struktur Hirarki: Pemetaan atasan langsung (*approval line / Tree Branch*).

### Module 2: Real-Time Attendance & Geofencing Integration (New Update)
- **Fingerprint Machine Integration**:
  - Fitur absensi terhubung langsung dengan mesin fingerprint fisik di kantor, sehingga data kedatangan terverifikasi dan masuk secara otomatis ke sistem secara real-time.
- **Geofencing & Wi-Fi Location Lock**:
  - Karyawan yang melakukan absensi melalui aplikasi web/mobile hanya dapat melakukan presensi jika terhubung ke jaringan Wi-Fi resmi kantor atau berada di dalam radius lokasi kantor yang ditentukan.
- **System Synchronization**:
  - Seluruh data log presensi ditarik otomatis untuk memperbarui status keterlambatan dan kehadiran harian pada dashboard.

### Module 3: Centralized Dashboard Widgets (New Update — 5-in-1 Dashboard)
Dashboard utama menyediakan visualisasi data harian real-time yang dapat diakses oleh seluruh karyawan hingga level Direktur, yang mencakup 5 poin utama:
1. **Yang Telat Hari Ini**: Daftar nama karyawan yang datang melebihi jam masuk standar berdasarkan sinkronisasi mesin fingerprint atau aplikasi.
2. **Yang Cuti Hari Ini**: Rekapitulasi karyawan yang sedang menjalani masa cuti resmi yang telah disetujui.
3. **Yang Sakit Hari Ini**: Daftar karyawan yang mengajukan izin tidak hadir karena sakit pada hari berjalan.
4. **Yang Birthday Hari Ini**: Pengingat otomatis berisi daftar karyawan yang berulang tahun pada hari tersebut.
5. **Jadwal Training**: Agenda dan pengingat pelatihan/workshop internal maupun eksternal yang terjadwal untuk hari ini dan mendatang.

### Module 4: KPI & Performance Evaluation
- **Pengukuran Kualitatif & Kuantitatif**:
  - Penilaian berbasis indikator angka/target (kuantitatif) dan penilaian deskriptif/perilaku (kualitatif).
  - Template KPI dapat disesuaikan (*customizable*) per jabatan/divisi.
- **Progress Graph & Analytics**:
  - Grafik visual pergerakan dan capaian KPI karyawan secara berkala (bulanan/kuartalan).
- **Cascading Visibility (Tree Branch Division)**:
  - Hasil KPI karyawan otomatis dapat diakses dan dilihat oleh HR GA, Management, Senior Manager, dan Manager sesuai *tree branch* divisi/sub-divisi masing-masing.

### Module 5: Company Calendar & Training Schedule
- **General Info Calendar**:
  - Menampilkan informasi ulang tahun karyawan, hari libur nasional, event kantor, dll.
  - *Pencegahan Input*: Akses input/edit khusus untuk role HR GA.
- **Personalized Training & Leave Visibility**:
  - *Jadwal Pelatihan (Training)*: Otomatis muncul di kalender karyawan terdaftar.
  - *Cuti & Izin Personal*: Cuti/izin personal muncul di kalender pribadi.
  - *HR GA Master View*: Memiliki master view untuk melihat seluruh jadwal karyawan.

### Module 6: Training Management & Extended Reporting
- **Rekap & Data Training**:
  - Menu laporan terintegrasi yang menampilkan histori & rekap data pelatihan (*Training Report*).
- **User Remarks / Feedback**:
  - Peserta pelatihan dapat memberikan ulasan, catatan, atau *remarks* hasil pelatihan pada modul report.
- **Export Options**:
  - Export rekap absensi, cuti, payroll, dan data training ke format Excel (`.xlsx`) / PDF.

---

## 4. Technical & Non-Functional Requirements

- **Frontend Framework**: React.js / Next.js / Vite (Sesuai baseline web demo `arryanhris.vercel.app`).
- **Data Hierarchy & RBAC**: Penataan database hirarki (*Tree structure*) untuk membatasi visibilitas laporan KPI dan approval line per divisi.
- **Hardware & API Integration**: Support API webhook / middleware untuk integrasi log presensi dari mesin fingerprint ke basis data utama.
- **Security & Performance**: Enkripsi data sensitif (Dokumen Identitas), waktu muat antarmuka < 2 detik.

---

## 5. Summary Checklist for Vendor Review

- [ ] 1. Implementasi skema *Tree Branch* hirarki divisi (`Management → Sr. Manager → Manager → Supervisor → Staff`).
- [ ] 2. Modul Absensi Real-time (Integrasi Mesin Fingerprint + Geofencing Wi-Fi/Radius Kantor).
- [ ] 3. Dashboard Utama 5-in-1 (*Yang Telat Hari Ini, Yang Cuti Hari Ini, Yang Sakit Hari Ini, Birthday Hari Ini, Jadwal Training*).
- [ ] 4. Modul KPI dengan opsi Kualitatif, Kuantitatif, dan Chart Progress.
- [ ] 5. Master Kalender Perusahaan dengan kontrol input khusus HR GA dan personalized view untuk jadwal training & cuti.
- [ ] 6. Pengelompokan status karyawan: *Probation (6 bulan)*, *Kartap*, dan *Anak PKL*.
- [ ] 7. Modul Laporan Training beserta kolom *remarks/feedback* karyawan.
