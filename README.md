# Asisten Belajar Pintar

Aplikasi web chatbot pembelajaran SMP (VII, VIII, IX) dengan penyimpanan SQLite, halaman administrasi guru, unggah PDF/DOCX/PPTX, pencarian materi, dan integrasi AI API opsional.

## Persyaratan
- Node.js 18 atau lebih baru (disarankan Node.js 20 LTS).
- Koneksi internet hanya diperlukan untuk memasang paket dan menggunakan API AI.
- Untuk jawaban generatif, siapkan API key dari penyedia AI yang kompatibel dengan endpoint `chat/completions`. Tanpa API key, chatbot masih mencari materi dan menampilkan kutipan relevan.

## Menjalankan aplikasi
1. Ekstrak ZIP.
2. Buka terminal di folder aplikasi.
3. Jalankan `npm install`.
4. Salin `.env.example` menjadi `.env`.
5. Ubah `TEACHER_PASSWORD` menjadi kata sandi kuat dan ubah `SESSION_SECRET` menjadi rahasia acak panjang.
6. (Opsional) Isi `AI_API_KEY`, `AI_BASE_URL`, dan `AI_MODEL` sesuai penyedia AI.
7. Jalankan `npm start`.
8. Buka `http://localhost:3000`.
9. Buka `http://localhost:3000/guru.html` untuk login guru dan memasukkan materi.

## Penyimpanan
Database berada di `data/asisten-belajar.sqlite`. Database dibuat otomatis dan bertahan setelah server dimulai ulang. Jangan hapus folder `data` jika ingin mempertahankan materi dan catatan pertanyaan.

## Fitur
- Chatbot siswa dengan filter mata pelajaran, kelas, dan topik.
- Pencarian kata kunci pada bagian-bagian materi.
- Jawaban AI berbasis konteks materi yang ditemukan (RAG sederhana), bila API key tersedia.
- Admin guru: tambah, edit, hapus materi; unggah PDF, DOCX, PPTX; lihat pertanyaan siswa.
- Pembatasan ukuran unggahan, validasi ekstensi, rate limit dasar, dan API key hanya di server.
- Antarmuka responsif.

## Catatan penting / batasan
- Ini adalah fondasi aplikasi yang dapat dijalankan sendiri, bukan layanan cloud yang sudah dipasang untuk sekolah.
- Pencarian saat ini memakai skor kata kunci lokal, belum embedding semantik/vector database. Untuk semantic search penuh, tambahkan embedding model dan vector store.
- Belum ada OCR untuk PDF hasil scan; PDF harus memiliki lapisan teks.
- Login guru menggunakan satu kata sandi admin dari `.env`, belum mendukung akun individual/role management. Gunakan HTTPS dan tambahkan perlindungan CSRF/monitoring sebelum dibuka ke internet.
- Sumber ditampilkan pada tingkat dokumen/topik; nomor halaman belum dipetakan.
- Pertanyaan siswa disimpan di database. Beri tahu pengguna dan sesuaikan kebijakan privasi sekolah sebelum penggunaan nyata.
- Untuk penggunaan produksi, tambahkan backup database, audit keamanan, HTTPS/reverse proxy, pengelolaan akun guru, dan pengujian beban.

## Tes cepat
1. Login sebagai guru dan tambahkan materi dengan judul, mata pelajaran, kelas, topik, dan isi.
2. Kembali ke halaman utama, pilih filter yang sesuai.
3. Tanyakan kata kunci atau konsep yang ada dalam materi.
4. Pastikan chatbot menampilkan jawaban/kutipan dan sumber.
5. Tanyakan topik yang tidak ada dalam database; chatbot seharusnya menyatakan materi belum ditemukan.
6. Restart server lalu periksa apakah materi masih tersedia.
7. Coba membuka `/api/materials` tanpa login; harus ditolak.

## API penting
- `POST /api/teacher/login`
- `GET /api/materials` (guru)
- `POST /api/materials` (guru)
- `POST /api/materials/upload` (guru)
- `POST /api/chat` (siswa)
