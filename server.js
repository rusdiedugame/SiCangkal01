require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const AdmZip = require("adm-zip");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(ROOT, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static(path.join(ROOT, "public")));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false }));

const db = new Database(path.join(DATA, "asisten-belajar.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS materials (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subject TEXT NOT NULL,
 grade TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', objectives TEXT DEFAULT '',
 content TEXT NOT NULL, formulas TEXT DEFAULT '', examples TEXT DEFAULT '',
 terms TEXT DEFAULT '', source TEXT DEFAULT '', updated_at TEXT NOT NULL,
 chunks TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS questions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL
);
`);
const insertMaterial = db.prepare(`INSERT INTO materials
(title,subject,grade,topic,objectives,content,formulas,examples,terms,source,updated_at,chunks)
VALUES (@title,@subject,@grade,@topic,@objectives,@content,@formulas,@examples,@terms,@source,@updated_at,@chunks)`);
const updateMaterial = db.prepare(`UPDATE materials SET title=@title,subject=@subject,grade=@grade,topic=@topic,
objectives=@objectives,content=@content,formulas=@formulas,examples=@examples,terms=@terms,source=@source,
updated_at=@updated_at,chunks=@chunks WHERE id=@id`);

function isTeacher(req) {
  const cookie = req.cookies.abp_teacher;
  if (!cookie || !process.env.SESSION_SECRET) return false;
  const [token, signature] = cookie.split(".");
  if (!token || !signature) return false;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) && token.length > 20;
}
function requireTeacher(req,res,next) {
  if (!isTeacher(req)) return res.status(401).json({ error: "Silakan login sebagai guru." });
  next();
}
function makeChunks(text, max = 900) {
  const cleaned = String(text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (!cleaned) return [];
  const paras = cleaned.split(/\n{2,}/);
  const chunks = []; let current = "";
  for (const p of paras) {
    if ((current + "\n\n" + p).length > max && current) { chunks.push(current.trim()); current = ""; }
    if (p.length > max) {
      if (current) { chunks.push(current.trim()); current = ""; }
      for (let i=0;i<p.length;i+=max) chunks.push(p.slice(i,i+max).trim());
    } else current += (current ? "\n\n" : "") + p;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
function words(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\u00C0-\u024F]+/g," ").trim().split(/\s+/).filter(w => w.length > 1);
}
function retrieve(question, filters={}) {
  let rows = db.prepare("SELECT * FROM materials").all();
  if (filters.subject) rows = rows.filter(r => r.subject === filters.subject);
  if (filters.grade) rows = rows.filter(r => r.grade === filters.grade);
  const qWords = [...new Set(words(question))];
  const results = [];
  for (const row of rows) {
    const chunks = JSON.parse(row.chunks || "[]");
    const all = [row.title,row.subject,row.grade,row.topic,row.objectives,row.content,row.formulas,row.examples,row.terms].join(" ");
    for (const chunk of chunks.length ? chunks : [all]) {
      const hay = words([row.title,row.subject,row.topic,chunk].join(" "));
      const set = new Set(hay);
      let score = qWords.reduce((n,w) => n + (set.has(w) ? (w.length > 5 ? 2 : 1) : 0), 0);
      // Frasa judul/topik mendapat bobot tambahan.
      const normalizedQ = String(question).toLowerCase();
      if (row.title.toLowerCase().includes(normalizedQ) || row.topic.toLowerCase().includes(normalizedQ)) score += 4;
      if (score > 0) results.push({ row, chunk, score });
    }
  }
  return results.sort((a,b)=>b.score-a.score).slice(0,5);
}
function plainMaterial(m) {
  return { id:m.id,title:m.title,subject:m.subject,grade:m.grade,topic:m.topic,objectives:m.objectives,
    content:m.content,formulas:m.formulas,examples:m.examples,terms:m.terms,source:m.source,updated_at:m.updated_at };
}
async function extractFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === ".pdf") {
    const data = await pdf(fs.readFileSync(file.path));
    return data.text || "";
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: file.path });
    return result.value || "";
  }
  if (ext === ".pptx") {
    const zip = new AdmZip(file.path);
    const slides = zip.getEntries().filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
      .sort((a,b)=>Number(a.entryName.match(/slide(\d+)/)[1])-Number(b.entryName.match(/slide(\d+)/)[1]));
    return slides.map((entry, i) => {
      const xml = entry.getData().toString("utf8");
      const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]
        .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"')).join(" ");
      return `Slide ${i+1}\n${text}`;
    }).join("\n\n");
  }
  throw new Error("Format belum didukung. Gunakan PDF, DOCX, atau PPTX.");
}
const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: Math.max(1, Number(process.env.MAX_UPLOAD_MB || 12)) * 1024 * 1024 },
  fileFilter: (req,file,cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(ext === ".pdf" || ext === ".docx" || ext === ".pptx" ? null : new Error("Hanya PDF, DOCX, dan PPTX yang diizinkan."), true);
  }
});

app.get("/api/status", (req,res) => res.json({ app:"Asisten Belajar Pintar", aiEnabled:!!process.env.AI_API_KEY }));
app.post("/api/teacher/login", async (req,res) => {
  const expected = process.env.TEACHER_PASSWORD;
  if (!expected || expected === "GantiDenganPasswordKuat") return res.status(503).json({error:"Atur TEACHER_PASSWORD di file .env terlebih dahulu."});
  const password = String(req.body.password || "");
  if (password.length > 200 || !await bcrypt.compare(password, await bcrypt.hash(expected, 10))) {
    return res.status(401).json({error:"Kata sandi tidak sesuai."});
  }
  const token = crypto.randomBytes(32).toString("hex");
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET || "temporary-session-secret-change-me").update(token).digest("hex");
  res.cookie("abp_teacher", `${token}.${sig}`, { httpOnly:true, sameSite:"strict", secure: process.env.NODE_ENV === "production", maxAge: 8*60*60*1000 });
  res.json({ok:true});
});
app.post("/api/teacher/logout", (req,res)=>{res.clearCookie("abp_teacher");res.json({ok:true});});
app.get("/api/subjects", (req,res) => {
  const rows = db.prepare("SELECT DISTINCT subject FROM materials ORDER BY subject").all().map(r=>r.subject);
  res.json(rows);
});
app.get("/api/topics", (req,res) => {
  const {subject,grade} = req.query;
  let rows = db.prepare("SELECT DISTINCT topic FROM materials WHERE topic != ''").all();
  if(subject) rows = rows.filter(r => db.prepare("SELECT 1 FROM materials WHERE topic=? AND subject=?").get(r.topic,subject));
  if(grade) rows = rows.filter(r => db.prepare("SELECT 1 FROM materials WHERE topic=? AND grade=?").get(r.topic,grade));
  res.json(rows.map(r=>r.topic));
});
app.get("/api/materials", requireTeacher, (req,res) => res.json(db.prepare("SELECT id,title,subject,grade,topic,source,updated_at FROM materials ORDER BY updated_at DESC").all()));
app.get("/api/materials/:id", requireTeacher, (req,res) => {
  const m = db.prepare("SELECT * FROM materials WHERE id=?").get(Number(req.params.id));
  if(!m) return res.status(404).json({error:"Materi tidak ditemukan."});
  res.json(plainMaterial(m));
});
app.post("/api/materials", requireTeacher, async (req,res) => {
  try {
    const b = req.body || {};
    const title = String(b.title||"").trim(), subject = String(b.subject||"").trim(), grade=String(b.grade||"").trim();
    const content = String(b.content||"").trim();
    if(!title || !subject || !grade || !content) return res.status(400).json({error:"Judul, mata pelajaran, kelas, dan isi materi wajib diisi."});
    const m = {title,subject,grade,topic:String(b.topic||""),objectives:String(b.objectives||""),content,
      formulas:String(b.formulas||""),examples:String(b.examples||""),terms:String(b.terms||""),source:String(b.source||"Input guru"),
      updated_at:new Date().toISOString(),chunks:JSON.stringify(makeChunks([content,b.formulas,b.examples,b.terms].filter(Boolean).join("\n\n")))};
    if(b.id) { m.id=Number(b.id); updateMaterial.run(m); }
    else insertMaterial.run(m);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:"Gagal menyimpan materi."}); }
});
app.post("/api/materials/upload", requireTeacher, upload.single("file"), async (req,res) => {
  if(!req.file) return res.status(400).json({error:"Pilih file terlebih dahulu."});
  try {
    const text = await extractFile(req.file);
    if(!text.trim()) return res.status(400).json({error:"Teks tidak ditemukan. PDF hasil scan mungkin memerlukan OCR."});
    const b=req.body;
    const title=String(b.title||path.basename(req.file.originalname,path.extname(req.file.originalname))).trim();
    const subject=String(b.subject||"").trim(), grade=String(b.grade||"").trim();
    if(!subject || !grade) return res.status(400).json({error:"Mata pelajaran dan kelas wajib diisi."});
    const m={title,subject,grade,topic:String(b.topic||""),objectives:"",content:text,formulas:"",examples:"",terms:"",
      source:req.file.originalname,updated_at:new Date().toISOString(),chunks:JSON.stringify(makeChunks(text))};
    insertMaterial.run(m);
    res.json({ok:true, extractedCharacters:text.length});
  } catch(e) { res.status(400).json({error:e.message || "Dokumen gagal diproses."}); }
  finally { fs.promises.unlink(req.file.path).catch(()=>{}); }
});
app.delete("/api/materials/:id", requireTeacher, (req,res) => {
  const result=db.prepare("DELETE FROM materials WHERE id=?").run(Number(req.params.id));
  res.json({ok:result.changes>0});
});
app.post("/api/chat", async (req,res) => {
  const question=String(req.body.question||"").trim().slice(0,2000);
  if(!question) return res.status(400).json({error:"Tuliskan pertanyaan terlebih dahulu."});
  const filters={subject:String(req.body.subject||""),grade:String(req.body.grade||"")};
  db.prepare("INSERT INTO questions(question,created_at) VALUES(?,?)").run(question,new Date().toISOString());
  const hits=retrieve(question,filters);
  const sources=[...new Map(hits.map(h=>[h.row.id,{title:h.row.title,subject:h.row.subject,grade:h.row.grade,topic:h.row.topic,source:h.row.source}])).values()];
  if(!hits.length) {
    return res.json({answer:"Saya belum menemukan informasi yang cukup untuk menjawab pertanyaan itu di materi yang diberikan guru. Coba pilih mata pelajaran/kelas yang sesuai atau tanyakan topik yang sudah dipelajari.",status:"not_found",sources:[]});
  }
  const context=hits.map((h,i)=>`[Sumber ${i+1}: ${h.row.subject}, ${h.row.grade}, ${h.row.topic || h.row.title}; dokumen: ${h.row.source || h.row.title}]\n${h.chunk}`).join("\n\n---\n\n");
  let answer;
  if(process.env.AI_API_KEY) {
    try {
      const response=await fetch(`${(process.env.AI_BASE_URL||"https://api.openai.com/v1").replace(/\/$/,"")}/chat/completions`,{
        method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.AI_API_KEY}`},
        body:JSON.stringify({model:process.env.AI_MODEL||"gpt-4o-mini",temperature:0.2,messages:[
          {role:"system",content:"Anda adalah Asisten Belajar Pintar untuk siswa SMP. Jawab dalam bahasa Indonesia sederhana dan ramah. Gunakan hanya konteks materi guru berikut. Jangan mengarang. Jika konteks tidak cukup, katakan bagian yang belum tersedia. Untuk hitungan, tulis diketahui, rumus, langkah, dan jawaban. Jika diminta rangkuman/latihan, buat berdasarkan konteks. Tandai bila jawaban tidak didukung materi.\n\nMATERI GURU:\n"+context},
          {role:"user",content:question}
        ]})
      });
      if(!response.ok) throw new Error("AI API error");
      const data=await response.json(); answer=data.choices?.[0]?.message?.content || "";
      if(!answer) throw new Error("Jawaban kosong");
    } catch(e) {
      answer="Layanan AI sedang tidak tersedia. Berikut bagian materi yang paling relevan:\n\n"+hits.slice(0,3).map(h=>h.chunk).join("\n\n");
    }
  } else {
    answer="Saya menemukan materi yang mungkin relevan. Berikut kutipan materi guru yang bisa membantu:\n\n"+hits.slice(0,3).map(h=>h.chunk).join("\n\n")+"\n\nCoba tanyakan bagian tertentu, misalnya “jelaskan dengan bahasa sederhana” atau “buatkan rangkuman dari bagian ini”.";
  }
  res.json({answer,status:"found",sources});
});
app.get("/api/teacher/questions", requireTeacher, (req,res) => {
  res.json(db.prepare("SELECT id,question,created_at FROM questions ORDER BY id DESC LIMIT 200").all());
});
app.get("/api/teacher/metrics", requireTeacher, (req,res) => {
  res.json({materials:db.prepare("SELECT count(*) n FROM materials").get().n,questions:db.prepare("SELECT count(*) n FROM questions").get().n});
});
app.use((err,req,res,next)=>{
  if(err instanceof multer.MulterError) return res.status(400).json({error:err.code==="LIMIT_FILE_SIZE"?"Ukuran file melewati batas.":err.message});
  if(err) return res.status(400).json({error:err.message||"Terjadi kesalahan."});
  next();
});
app.listen(PORT,()=>console.log(`Asisten Belajar Pintar berjalan di http://localhost:${PORT}`));
