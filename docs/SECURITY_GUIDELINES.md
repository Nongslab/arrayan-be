# Security Architecture & Guidelines — Arryan HRIS Platform

Dokumen ini mendefinisikan standar keamanan (*Security Best Practices*) yang wajib diimplementasikan pada **Arryan HRIS Platform**.

HRIS mengelola data yang sangat sensitif:
- **Data Pribadi (PII)**: Foto KTP, NPWP, BPJS, alamat, tanggal lahir, kontak darurat (tunduk pada regulasi perlindungan data pribadi).
- **Data Finansial**: Gaji pokok (*base salary*), nomor rekening, bukti reimbursement.
- **Data Evaluasi**: Catatan review kinerja (KPI kualitatif & kuantitatif).

Arsitektur keamanan dibangun dengan prinsip **Defense-in-Depth (Keamanan Berlapis)**: Frontend, Backend, Database, dan Infrastruktur Server.

---

## 1. Keamanan Sisi Frontend (FE Security)

Prinsip dasar: **"Client/Browser tidak pernah boleh dipercaya sebagai sumber kebenaran."**

### 1.1. Anti-Pencurian Sesi (Mitigasi XSS)
- **Larangan**: Dilarang keras menyimpan token otentikasi (JWT) di `localStorage` atau `sessionStorage`. Script jahat yang tersusup ke browser (XSS) dapat dengan mudah membaca penyimpanan lokal tersebut.
- **Standar**: Token otentikasi dikelola sepenuhnya melalui **`HttpOnly, Secure, SameSite=Lax Cookie`** yang diatur oleh server. JavaScript di browser tidak memiliki akses baca/tulis ke cookie ini.

### 1.2. Masking Data Sensitif di Antarmuka
- Data identitas dan finansial tidak boleh ditampilkan telanjang di layar monitor untuk mencegah kebocoran visual saat layar ditinggal (*shoulder surfing*).
- **Format Sensor Default**:
  - NIK: `3174********0001`
  - NPWP: `09.***.***.*-***.***`
  - Gaji Pokok: `Rp 8.***.***`
- Sediakan tombol "Mata / Reveal" yang hanya bisa diklik oleh role berwenang (Super Admin / HR GA atau karyawan pemilik akun) yang tercatat dalam log audit.

### 1.3. Penanganan Waktu & Integritas Presensi
- **Server-Authoritative Time**: Waktu absensi *clock-in* dan *clock-out* **wajib** menggunakan waktu jam server (*system time* di backend), bukan jam lokal pada perangkat pengguna.
- **Geolocation Integrity**: Validasi akurasi koordinat GPS dari browser. Tandai *flag* peringatan jika koordinat memiliki radius ketidakpastian yang terlalu besar (indikasi emulator atau sinyal tidak akurat).

---

## 2. Keamanan Sisi Backend & API (BE Security)

Backend adalah benteng utama validasi bisnis dan penegakan otorisasi.

### 2.1. Perlindungan IDOR (*Insecure Direct Object Reference*)
- Setiap endpoint yang memanipulasi atau menampilkan data (misal: `/api/employees/:id`, `/api/leaves/:id`, `/api/kpi/:id`) **wajib memverifikasi kepemilikan dan relasi hirarki**:
  - Karyawan hanya boleh melihat data miliknya sendiri.
  - Atasan hanya boleh melihat data bawahan yang berada dalam satu rantai divisi (*Tree Branch*).
  - HR GA dan Management memiliki hak akses luas sesuai matriks role PRD.
- Validasi dilakukan di level middleware/service backend, bukan sekadar menyembunyikan tombol di frontend.

### 2.2. Keamanan Kredensial & Password
- Password di-hash menggunakan algoritma modern standar industri: **Argon2id** (pilihan utama) atau **bcrypt** dengan *salt rounds* minimal 10.
- Password dalam bentuk teks polos (*plain text*) tidak boleh dicatat dalam file log (*logging sanitization*).

### 2.3. Anti-Brute Force & Rate Limiting
- Terapkan pembatasan frekuensi request (*Rate Limiting*):
  - **Endpoint Login (`/api/auth/login`)**: Maksimal 5 kali percobaan gagal per IP/Email dalam jendela waktu 15 menit. Percobaan berikutnya diblokir sementara (*temporary lockout*).
  - **Endpoint Publik / Clock-in**: Diberi batas wajar (misal: maksimal 30 request per menit per sesi) untuk mencegah serangan DoS atau spamming.

### 2.4. Validasi Ketat Unggah Berkas (*File Upload Security*)
Fitur selfie absensi, unggah KTP/NPWP, dan struk reimbursement rawan disalahgunakan jika tidak divalidasi:
1. **Validasi Tipe Biner (*Magic Bytes / File Signature*)**:
   - Backend tidak boleh hanya memeriksa ekstensi nama file (misal: `.jpg`) atau *MIME type* kiriman browser.
   - Gunakan pustaka pemeriksa biner (seperti `file-type`) untuk memastikan isi berkas benar-benar gambar JPEG/PNG atau dokumen PDF.
2. **Batas Ukuran Berkas**:
   - Foto selfie & struk klaim: Maksimal **3 MB**.
   - Dokumen PDF: Maksimal **5 MB**.
3. **Pemberian Nama Acak (UUID)**:
   - Berkas yang disimpan di server wajib diubah namanya menjadi string acak UUID v4 (contoh: `d3b07384-d113-46fb-9b24-9b8830155b76.jpg`).
   - Mencegah serangan *Directory Traversal* (`../../etc/passwd`) dan penimpaan file (*file overwrite*).

### 2.5. Pencegahan SQL Injection & Validasi Input
- Gunakan **Prisma ORM** yang secara bawaan menerapkan *Parameterized Queries* pada seluruh perintah SQL.
- Seluruh input request body divalidasi menggunakan skema deklaratif yang ketat (misal: pustaka **Zod**).

---

## 3. Keamanan Sisi Database (DB Security)

### 3.1. Isolasi Port Database
- Port PostgreSQL (`5432`) **TIDAK BOLEH diekspos ke internet publik** (jangan pasang `ports: - "5432:5432"` di file `docker-compose.yml` untuk lingkungan produksi).
- Database hanya boleh berkomunikasi di dalam jaringan internal Docker (*Private Bridge Network*) dengan kontainer Backend.

### 3.2. Enkripsi Data Saat Tersimpan (*Encryption at Rest*)
- Kolom data yang sangat sensitif (NIK, NPWP, Nomor Rekening Gaji) dienkripsi di level aplikasi sebelum masuk ke tabel database menggunakan algoritma simetris **AES-256-GCM**.
- Kunci enkripsi (*Master Secret Key*) disimpan di variabel *environment* dan tidak dimasukkan ke dalam repositori Git.

### 3.3. Akses Berkas Terproteksi (*Secure File Stream*)
- Berkas yang diunggah disimpan di folder privat yang tidak dapat diakses langsung oleh web server publik.
- Akses ke berkas dilayani melalui endpoint terotentikasi:
  `GET /api/files/:fileId`
- Server mengecek izin user sebelum membaca dan mengalirkan (*streaming*) file ke browser.

---

## 4. Keamanan Infrastruktur & Server (DevOps Security)

### 4.1. Kewajiban Koneksi Terenkripsi (HTTPS / SSL)
- Seluruh komunikasi dari browser ke server klien **wajib menggunakan HTTPS** (sertifikat SSL otomatis via Let's Encrypt / Certbot).
- **Alasan Operasional**: Browser modern (Google Chrome, Apple Safari, Mozilla Firefox) **secara otomatis menonaktifkan fitur Geolocation (GPS) dan Akses Kamera** apabila website dibuka menggunakan protokol HTTP biasa tanpa SSL.

### 4.2. Pengaturan Firewall Server (UFW)
Pada sistem operasi Linux server milik klien, hanya port berikut yang dibuka:
- Port `80` (HTTP — dikonfigurasi auto-redirect ke HTTPS)
- Port `443` (HTTPS — lalu lintas aplikasi terenkripsi)
- Port `SSH` (untuk administrasi server — wajib menggunakan otentikasi SSH Key, nonaktifkan *password authentication* dan *root login*).

### 4.3. Menjalankan Kontainer Tanpa Hak Root (*Non-Root Container*)
- Di dalam file `Dockerfile`, hindari menjalankan aplikasi dengan user `root`.
- Gunakan user sistem bawaan Node.js (`USER node`) untuk membatasi dampak buruk apabila terjadi celah pada library pihak ketiga.

---

## 5. Checklist Verifikasi Keamanan Sebelum Handover

- [ ] Password akun di-hash menggunakan Argon2id atau bcrypt (bukan plain text atau MD5).
- [ ] Token otentikasi menggunakan cookie bertanda `HttpOnly`, `Secure`, dan `SameSite=Lax`.
- [ ] Port database PostgreSQL tertutup dari akses internet luar.
- [ ] Upload file divalidasi ukuran, tipe biner (*magic bytes*), dan di-rename ke UUID acak.
- [ ] Endpoint data sensitif memiliki filter hak akses IDOR & *Tree Branch*.
- [ ] Data NIK, NPWP, dan Gaji disensor secara visual pada tampilan antarmuka.
- [ ] Domain server telah terpasang sertifikat SSL/HTTPS aktif (agar GPS dan Kamera berfungsi).
- [ ] File `.env` tidak masuk ke repositori Git (`.gitignore` aktif).

