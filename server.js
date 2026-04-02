const express = require("express");
const session = require("express-session");
const multer = require("multer");
const Database = require("better-sqlite3");
const { v4: uuid } = require("uuid");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");

const app = express();
const PORT = 5000;
const PASS = "jumpseat2026";

/* ── Uploads dir ── */
const UPLOADS = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

/* ── Database ── */
const db = new Database(path.join(__dirname, "submissions.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    email             TEXT NOT NULL,
    resume_filename   TEXT,
    resume_orig_name  TEXT,
    submitted_at      TEXT DEFAULT (datetime('now','localtime')),
    status            TEXT DEFAULT 'new'
  )
`);

/* ── Migrations ── */
try {
  db.exec("ALTER TABLE submissions ADD COLUMN video_filename TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE submissions ADD COLUMN video_orig_name TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE submissions ADD COLUMN notes TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE submissions ADD COLUMN cloudflare_video_id TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE submissions ADD COLUMN email_sent_at TEXT");
} catch (e) {}

/* ── Middleware ── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "j5_secret_xK9#mQ",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
  }),
);

/* ── CORS ── */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ── Resume upload ── */
const resumeStorage = multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) =>
    cb(null, "resume_" + uuid() + path.extname(file.originalname)),
});
const resumeUpload = multer({
  storage: resumeStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [".pdf", ".doc", ".docx"].includes(
      path.extname(file.originalname).toLowerCase(),
    );
    cb(ok ? null : new Error("Invalid file type"), ok);
  },
});

/* ── Video upload (temp local storage, then pushed to Cloudflare) ── */
const videoStorage = multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) =>
    cb(null, "video_" + uuid() + path.extname(file.originalname)),
});
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 2000 * 1024 * 1024 }, // 2GB
  fileFilter: (req, file, cb) => {
    const ok = [".mp4", ".mov", ".m4v", ".webm"].includes(
      path.extname(file.originalname).toLowerCase(),
    );
    cb(ok ? null : new Error("Invalid file type"), ok);
  },
});

/* ────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────── */
async function uploadToCloudflare(filePath, filename) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), { filename });

  const res = await axios.post(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream`,
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 600000, // 10 minutes
    },
  );

  return res.data.result; // { uid, ... }
}

async function sendRoastEmail(toEmail, firstName, submissionId) {
  const watchUrl = `https://pleaseroastmyresume.com/watch/${submissionId}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Wilson <wilson@pleaseroastmyresume.com>",
      to: [toEmail],
      reply_to: process.env.GMAIL_USER,
      subject: "I read your resume",
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="margin:0;padding:0;background:#0a0a0a;font-family:Inter,Arial,sans-serif;">
          <div style="max-width:560px;margin:0 auto;padding:48px 32px;">
            <p style="font-size:16px;line-height:1.8;color:#fff;margin:0 0 20px;">${firstName},</p>
            <p style="font-size:16px;line-height:1.8;color:#fff;margin:0 0 20px;">I've reviewed a lot of resumes.</p>
            <p style="font-size:16px;line-height:1.8;color:#fff;margin:0 0 20px;">Yours made me question my career choices.</p>
            <p style="font-size:16px;line-height:1.8;color:#fff;margin:0 0 20px;">I'm talking "printed it out, stared at it, folded it into a paper airplane and threw it out the window" bad.</p>
            <p style="font-size:16px;line-height:1.8;color:#fff;margin:0 0 32px;">...okay, not really. But it did give me a lot to work with.</p>
            <a href="${watchUrl}" style="display:inline-block;background:#d91e1e;color:#fff;font-family:Inter,Arial,sans-serif;font-weight:700;font-size:16px;padding:16px 32px;border-radius:8px;text-decoration:none;letter-spacing:-0.01em;">Watch Your Roast →</a>
            <p style="font-size:13px;line-height:1.7;color:#666;margin:32px 0 0;">Fair warning — I don't pull punches. But everything in there is fixable, and I tell you exactly how.</p>
            <p style="font-size:16px;line-height:1.8;color:#fff;margin:40px 0 0;">Wilson</p>
            <p style="font-size:11px;color:#333;margin:40px 0 0;border-top:1px solid #1a1a1a;padding-top:20px;">
              You submitted your resume at pleaseroastmyresume.com.<br>
              <a href="https://jumpseatjobs.com" style="color:#d91e1e;text-decoration:none;">Want us to land you a second job?</a>
            </p>
          </div>
        </body>
        </html>
      `,
    }),
  });

  return res.ok;
}

/* ────────────────────────────────────────────
   PUBLIC: Form submission
──────────────────────────────────────────── */
app.post("/api/submit", resumeUpload.single("resume"), async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email)
    return res
      .status(400)
      .json({ ok: false, error: "Name and email required" });

  db.prepare(
    `
    INSERT INTO submissions (name, email, resume_filename, resume_orig_name)
    VALUES (?, ?, ?, ?)
  `,
  ).run(
    name,
    email,
    req.file?.filename || null,
    req.file?.originalname || null,
  );

  const firstName = name.trim().split(" ")[0];
  const lastName = name.trim().split(" ").slice(1).join(" ") || "";
  try {
    await fetch(
      `https://api.beehiiv.com/v2/publications/${process.env.BEEHIIV_PUBLICATION_ID}/subscriptions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.BEEHIIV_API_KEY}`,
        },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          reactivate_existing: true,
          send_welcome_email: false,
        }),
      },
    );
  } catch (e) {
    console.error("Beehiiv error:", e.message);
  }

  res.json({ ok: true });
});

app.get("/api/queue-count", (req, res) => {
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM submissions").get();
  res.json({ count: row.cnt + 11 });
});

/* ────────────────────────────────────────────
   PUBLIC: Watch page
──────────────────────────────────────────── */
app.get("/watch/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db
    .prepare("SELECT name, cloudflare_video_id FROM submissions WHERE id = ?")
    .get(id);

  if (!row || !row.cloudflare_video_id) {
    return res.status(404).send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title>
      <style>body{background:#0a0a0a;color:#fff;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}
      h1{font-size:24px;font-weight:700;}p{color:#555;margin-top:8px;}</style></head>
      <body><div><h1>Video not ready yet.</h1><p>Check back soon.</p></div></body></html>
    `);
  }

  const firstName = row.name.trim().split(" ")[0];
  res.send(watchPage(firstName, row.cloudflare_video_id));
});

/* ────────────────────────────────────────────
   AUTH
──────────────────────────────────────────── */
function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  res.redirect("/admin/login");
}

app.get("/admin/login", (req, res) => {
  if (req.session?.authed) return res.redirect("/admin");
  res.send(loginPage());
});

app.post("/admin/login", (req, res) => {
  if (req.body.password === PASS) {
    req.session.authed = true;
    return res.redirect("/admin");
  }
  res.send(loginPage("Wrong password."));
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin/login");
});

app.get("/admin", requireAuth, (req, res) => res.send(adminPage()));

/* ────────────────────────────────────────────
   ADMIN: API
──────────────────────────────────────────── */
app.get("/admin/api/submissions", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM submissions ORDER BY id DESC").all();
  res.json(rows);
});

app.post("/admin/api/status", requireAuth, (req, res) => {
  const { id, status } = req.body;
  const valid = ["new", "picked", "editing", "done", "skipped"];
  if (!valid.includes(status)) return res.status(400).json({ ok: false });
  db.prepare("UPDATE submissions SET status = ? WHERE id = ?").run(status, id);
  res.json({ ok: true });
});

app.post("/admin/api/notes", requireAuth, (req, res) => {
  const { id, notes } = req.body;
  db.prepare("UPDATE submissions SET notes = ? WHERE id = ?").run(
    notes || "",
    id,
  );
  res.json({ ok: true });
});

/* ── Video upload → Cloudflare Stream → email ── */
app.post(
  "/admin/api/upload-video/:id",
  requireAuth,
  videoUpload.single("video"),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!req.file)
      return res.status(400).json({ ok: false, error: "No file received" });

    const localPath = req.file.path;

    try {
      console.log(`[CF] Uploading video for submission #${id}...`);
      const cfResult = await uploadToCloudflare(
        localPath,
        req.file.originalname,
      );
      const videoId = cfResult.uid;
      console.log(`[CF] Upload complete. Video ID: ${videoId}`);

      // Delete local file immediately
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

      // Store in DB, clear any old local video refs
      db.prepare(
        `
      UPDATE submissions
      SET cloudflare_video_id = ?, status = 'done', video_filename = NULL, video_orig_name = NULL
      WHERE id = ?
    `,
      ).run(videoId, id);

      // Send email
      const row = db
        .prepare("SELECT name, email FROM submissions WHERE id = ?")
        .get(id);
      let emailSent = false;
      if (row && process.env.RESEND_API_KEY) {
        const firstName = row.name.trim().split(" ")[0];
        emailSent = await sendRoastEmail(row.email, firstName, id);
        if (emailSent) {
          db.prepare(
            "UPDATE submissions SET email_sent_at = datetime('now') WHERE id = ?",
          ).run(id);
          console.log(`[Email] Sent to ${row.email}`);
        }
      }

      res.json({ ok: true, videoId, emailSent });
    } catch (err) {
      console.error("[CF] Upload error:", err.message);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      res
        .status(500)
        .json({
          ok: false,
          error: "Upload to Cloudflare failed: " + err.message,
        });
    }
  },
);

/* ── Resume download ── */
app.get("/admin/uploads/:filename", requireAuth, (req, res) => {
  const file = path.join(UPLOADS, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).send("Not found");
  res.sendFile(file);
});

app.get("/admin/*path", requireAuth, (req, res) => res.redirect("/admin"));

/* ── Static ── */
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use(express.static(__dirname, { index: false, maxAge: "1h" }));

/* ────────────────────────────────────────────
   WATCH PAGE
──────────────────────────────────────────── */
function watchPage(firstName, videoId) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Resume Roast</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#fff;min-height:100vh}

  .header{padding:20px 28px;border-bottom:1px solid #111;display:flex;align-items:center;justify-content:space-between}
  .header-logo{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#d91e1e}
  .header-link{font-size:12px;color:#333;text-decoration:none;transition:color .15s}
  .header-link:hover{color:#fff}

  .hero{max-width:860px;margin:0 auto;padding:60px 24px 0;text-align:center}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#d91e1e;margin-bottom:16px}
  .headline{font-size:clamp(28px,4vw,48px);font-weight:900;letter-spacing:-.03em;line-height:1.1;margin-bottom:12px}
  .subline{font-size:15px;color:#555;margin-bottom:40px}

  .player-wrap{
    max-width:800px;margin:0 auto;
    aspect-ratio:16/9;
    background:#0f0f0f;
    border:1px solid #1a1a1a;
    border-radius:16px;
    overflow:hidden;
    box-shadow:0 0 60px rgba(217,30,30,.12);
  }
  .player-wrap iframe{width:100%;height:100%;border:none;border-radius:16px;}

  .cta-section{max-width:600px;margin:48px auto;padding:0 24px 80px;text-align:center}
  .divider{width:40px;height:2px;background:#d91e1e;margin:0 auto 32px;border-radius:2px}
  .cta-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#333;margin-bottom:12px}
  .cta-heading{font-size:clamp(20px,3vw,28px);font-weight:900;letter-spacing:-.02em;line-height:1.2;margin-bottom:10px}
  .cta-sub{font-size:14px;color:#444;line-height:1.7;margin-bottom:28px}
  .cta-btn{
    display:inline-flex;align-items:center;gap:8px;
    background:#d91e1e;color:#fff;
    font-size:14px;font-weight:700;
    padding:14px 28px;border-radius:8px;
    text-decoration:none;letter-spacing:-.01em;
    box-shadow:0 4px 28px rgba(217,30,30,.3);
    transition:transform .15s,box-shadow .15s;
  }
  .cta-btn:hover{transform:translateY(-1px);box-shadow:0 6px 32px rgba(217,30,30,.4)}

  footer{padding:24px;text-align:center;border-top:1px solid #0f0f0f}
  footer p{font-size:11px;color:#222}
</style>
</head>
<body>

<div class="header">
  <div class="header-logo">Please Roast My Resume</div>
  <a class="header-link" href="https://jumpseatjobs.com" target="_blank">Want a second job? →</a>
</div>

<div class="hero">
  <div class="eyebrow">Your Roast</div>
  <h1 class="headline">Here it is, ${firstName}.</h1>
  <p class="subline">Don't take it personally. Take it seriously.</p>
</div>

<div class="player-wrap" style="margin:0 auto;max-width:800px;padding:0 24px;">
  <div style="max-width:800px;margin:0 auto;aspect-ratio:16/9;border-radius:16px;overflow:hidden;">
    <iframe
      src="https://iframe.cloudflarestream.com/${videoId}?autoplay=false&letterboxColor=transparent"
      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
      allowfullscreen="true"
      style="width:100%;height:100%;border:none;">
    </iframe>
  </div>
</div>

<div class="cta-section">
  <div class="divider"></div>
  <div class="cta-label">What's next</div>
  <h2 class="cta-heading">Want more than a roast?</h2>
  <p class="cta-sub">We help people land remote jobs — often two at once. If you're serious about your next move, that's what Jumpseat is for.</p>
  <a class="cta-btn" href="https://jumpseatjobs.com" target="_blank">
    See How It Works
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
  </a>
</div>

<footer>
  <p>© 2026 Jumpseat. A free resource from the team that gets people hired.</p>
</footer>

</body>
</html>`;
}

/* ────────────────────────────────────────────
   LOGIN PAGE
──────────────────────────────────────────── */
function loginPage(err = "") {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Roast Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#111;border:1px solid #1e1e1e;border-radius:14px;padding:40px 36px;width:340px}
  .logo{font-size:13px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#d91e1e;margin-bottom:28px}
  h1{font-size:22px;font-weight:700;margin-bottom:24px}
  input{width:100%;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 14px;color:#fff;font-size:14px;font-family:inherit;outline:none;margin-bottom:14px}
  input:focus{border-color:#d91e1e}
  button{width:100%;background:#d91e1e;color:#fff;border:none;border-radius:8px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
  button:hover{background:#b91a1a}
  .err{color:#f87171;font-size:13px;margin-bottom:12px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">Roast Admin</div>
  <h1>Sign in</h1>
  ${err ? `<div class="err">${err}</div>` : ""}
  <form method="POST" action="/admin/login">
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Sign in →</button>
  </form>
</div>
</body>
</html>`;
}

/* ────────────────────────────────────────────
   ADMIN PAGE
──────────────────────────────────────────── */
function adminPage() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Roast Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#fff;min-height:100vh}

  .hdr{display:flex;align-items:center;justify-content:space-between;padding:0 28px;height:52px;border-bottom:1px solid #1a1a1a;position:sticky;top:0;background:#0a0a0a;z-index:100}
  .hdr-logo{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#d91e1e}
  .hdr-right{display:flex;align-items:center;gap:12px}
  .hdr-right span{font-size:12px;color:#444}
  .btn-sm{background:none;border:1px solid #222;color:#555;font-size:12px;font-weight:600;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:inherit}
  .btn-sm:hover{color:#fff;border-color:#444}

  .stats{display:flex;gap:12px;padding:20px 28px 0;flex-wrap:wrap}
  .stat{background:#111;border:1px solid #1a1a1a;border-radius:8px;padding:14px 18px;min-width:100px}
  .stat-n{font-size:26px;font-weight:700;line-height:1}
  .stat-l{font-size:11px;color:#444;margin-top:4px;text-transform:uppercase;letter-spacing:.08em}

  .tabs{display:flex;gap:2px;padding:20px 28px 0;border-bottom:1px solid #111}
  .tab{background:none;border:none;border-bottom:2px solid transparent;color:#444;font-size:13px;font-weight:500;padding:8px 16px 10px;cursor:pointer;font-family:inherit;transition:all .15s;margin-bottom:-1px}
  .tab:hover{color:#888}
  .tab.active{color:#fff;border-bottom-color:#d91e1e}
  .tab-count{font-size:11px;opacity:.55;margin-left:5px;font-weight:400}

  .tbl-wrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:10px 14px;color:#333;font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #131313;white-space:nowrap}
  td{padding:0;border-bottom:1px solid #0d0d0d;vertical-align:top}
  .td-inner{padding:12px 14px}
  tr:hover td{background:#0c0c0c}

  .name{font-weight:600;font-size:13px;margin-bottom:2px}
  .email{color:#555;font-size:12px}
  .sub-date{font-size:11px;color:#333;margin-top:3px}

  .badge{display:inline-block;font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
  .badge-new     {background:rgba(217,30,30,.12);color:#f87171}
  .badge-picked  {background:rgba(234,179,8,.1);color:#fbbf24}
  .badge-editing {background:rgba(99,102,241,.12);color:#a5b4fc}
  .badge-done    {background:rgba(34,197,94,.1);color:#4ade80}
  .badge-skipped {background:rgba(255,255,255,.04);color:#333}

  .btn-resume{display:inline-flex;align-items:center;gap:5px;background:rgba(217,30,30,.1);border:1px solid rgba(217,30,30,.25);color:#f87171;font-size:11px;font-weight:700;padding:5px 10px;border-radius:6px;cursor:pointer;text-decoration:none;font-family:inherit;transition:all .15s;white-space:nowrap}
  .btn-resume:hover{background:rgba(217,30,30,.2);border-color:rgba(217,30,30,.5);color:#fff}
  .no-file{color:#2a2a2a;font-size:12px}

  .video-cell{min-width:180px}

  /* Upload button */
  .btn-upload-video{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.04);border:1px dashed #222;color:#444;font-size:11px;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
  .btn-upload-video:hover{border-color:#555;color:#888}
  .btn-upload-video input[type=file]{display:none}

  /* Done state */
  .video-done{display:flex;flex-direction:column;gap:5px}
  .video-watch-link{color:#4ade80;font-size:11px;font-weight:700;text-decoration:none}
  .video-watch-link:hover{text-decoration:underline}
  .email-sent-tag{font-size:10px;font-weight:700;color:#4ade80;letter-spacing:.06em;text-transform:uppercase;opacity:.65}
  .email-unsent-tag{font-size:10px;color:#555}
  .btn-reupload{background:none;border:none;color:#2a2a2a;font-size:11px;cursor:pointer;font-family:inherit;padding:0;transition:color .15s}
  .btn-reupload:hover{color:#888}

  /* Uploading spinner */
  .uploading-indicator{font-size:11px;color:#a5b4fc;display:none;align-items:center;gap:5px;margin-top:4px}
  .uploading-indicator.show{display:inline-flex}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner{width:12px;height:12px;border:2px solid rgba(165,180,252,.3);border-top-color:#a5b4fc;border-radius:50%;animation:spin .7s linear infinite}

  /* Upload progress bar */
  .upload-progress{display:none;margin-top:6px;height:3px;background:#111;border-radius:2px;overflow:hidden}
  .upload-progress.show{display:block}
  .upload-progress-fill{height:100%;background:#a5b4fc;border-radius:2px;width:0%;transition:width .2s}

  select.status-sel{background:#111;border:1px solid #1a1a1a;color:#fff;font-size:12px;padding:5px 8px;border-radius:6px;font-family:inherit;cursor:pointer;outline:none;width:100%}
  select.status-sel:focus{border-color:#d91e1e}

  .notes-input{width:100%;background:transparent;border:none;color:#555;font-size:11px;font-family:inherit;outline:none;resize:none;height:32px;line-height:1.5;padding:0}
  .notes-input:focus{color:#aaa}
  .notes-input::placeholder{color:#2a2a2a}

  .empty{text-align:center;padding:80px;color:#222}
  .empty p{font-size:13px;margin-top:8px}

  .refresh-dot{width:5px;height:5px;border-radius:50%;background:#1e1e1e;display:inline-block;margin-right:6px;transition:background .3s;vertical-align:middle}
  .refresh-dot.pulse{background:#d91e1e}

  #toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);background:#111;border:1px solid #222;color:#fff;font-size:13px;font-weight:500;padding:10px 20px;border-radius:8px;opacity:0;transition:all .25s;pointer-events:none;z-index:999;white-space:nowrap}
  #toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-logo">Roast Pipeline</div>
  <div class="hdr-right">
    <span><span class="refresh-dot" id="rdot"></span>Live</span>
    <form method="POST" action="/admin/logout" style="margin:0">
      <button class="btn-sm" type="submit">Sign out</button>
    </form>
  </div>
</div>

<div class="stats" id="stats-bar">
  <div class="stat"><div class="stat-n" id="s-total">—</div><div class="stat-l">Total</div></div>
  <div class="stat"><div class="stat-n" id="s-new" style="color:#f87171">—</div><div class="stat-l">New</div></div>
  <div class="stat"><div class="stat-n" id="s-picked" style="color:#fbbf24">—</div><div class="stat-l">Picked</div></div>
  <div class="stat"><div class="stat-n" id="s-editing" style="color:#a5b4fc">—</div><div class="stat-l">Editing</div></div>
  <div class="stat"><div class="stat-n" id="s-done" style="color:#4ade80">—</div><div class="stat-l">Done</div></div>
</div>

<div class="tabs">
  <button class="tab active" data-f="all"     onclick="setFilter('all',this)">All <span class="tab-count" id="tc-all"></span></button>
  <button class="tab"        data-f="new"     onclick="setFilter('new',this)">New <span class="tab-count" id="tc-new"></span></button>
  <button class="tab"        data-f="picked"  onclick="setFilter('picked',this)">Picked <span class="tab-count" id="tc-picked"></span></button>
  <button class="tab"        data-f="editing" onclick="setFilter('editing',this)">Editing <span class="tab-count" id="tc-editing"></span></button>
  <button class="tab"        data-f="done"    onclick="setFilter('done',this)">Done <span class="tab-count" id="tc-done"></span></button>
  <button class="tab"        data-f="skipped" onclick="setFilter('skipped',this)">Skipped <span class="tab-count" id="tc-skipped"></span></button>
</div>

<div class="tbl-wrap">
  <table>
    <thead>
      <tr>
        <th style="width:200px">Person</th>
        <th style="width:90px">Resume</th>
        <th style="width:120px">Status</th>
        <th class="video-cell">Roast Video</th>
        <th>Notes</th>
        <th style="width:90px;text-align:right">ID</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <div id="empty" class="empty" style="display:none">
    <div style="font-size:28px">📭</div>
    <p>Nothing here yet.</p>
  </div>
</div>

<div id="toast"></div>

<script>
  let allData = [];
  let currentFilter = 'all';

  const STATUS_LABELS = { new:'New', picked:'Picked', editing:'Editing', done:'Done', skipped:'Skipped' };
  const STATUS_BADGES = { new:'badge-new', picked:'badge-picked', editing:'badge-editing', done:'badge-done', skipped:'badge-skipped' };

  function fmt(dt) {
    const d = new Date(dt);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000)   return 'just now';
    if (diff < 3600000)  return Math.floor(diff/60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function toast(msg, color='#fff') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.color = color;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2800);
  }

  function setFilter(f, btn) {
    currentFilter = f;
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  }

  function render() {
    const rows = currentFilter === 'all' ? allData : allData.filter(r => r.status === currentFilter);
    const tbody = document.getElementById('tbody');

    if (rows.length === 0) {
      tbody.innerHTML = '';
      document.getElementById('empty').style.display = 'block';
      return;
    }
    document.getElementById('empty').style.display = 'none';

    tbody.innerHTML = rows.map(r => {
      let videoCell;

      if (r.cloudflare_video_id) {
        // Has a Cloudflare video
        const emailLine = r.email_sent_at
          ? '<span class="email-sent-tag">✉ Email sent</span>'
          : '<span class="email-unsent-tag">Email not sent</span>';
        videoCell = \`
          <div class="video-done">
            <a class="video-watch-link" href="/watch/\${r.id}" target="_blank">▶ Watch Roast</a>
            \${emailLine}
            <button class="btn-reupload" title="Replace video" onclick="triggerVideoUpload(\${r.id})">↺ Replace</button>
          </div>
          <div class="uploading-indicator" id="uploading-\${r.id}"><div class="spinner"></div> Uploading to Cloudflare…</div>
          <div class="upload-progress" id="progress-\${r.id}"><div class="upload-progress-fill" id="progress-fill-\${r.id}"></div></div>
        \`;
      } else {
        // No video yet
        videoCell = \`
          <label class="btn-upload-video" title="Upload finished roast video">
            <input type="file" accept=".mp4,.mov,.m4v,.webm" onchange="uploadVideo(\${r.id}, this)" />
            ↑ Upload Roast
          </label>
          <div class="uploading-indicator" id="uploading-\${r.id}"><div class="spinner"></div> Uploading to Cloudflare…</div>
          <div class="upload-progress" id="progress-\${r.id}"><div class="upload-progress-fill" id="progress-fill-\${r.id}"></div></div>
        \`;
      }

      return \`<tr id="row-\${r.id}">
        <td><div class="td-inner">
          <div class="name">\${esc(r.name)}</div>
          <div class="email">\${esc(r.email)}</div>
          <div class="sub-date">\${fmt(r.submitted_at)}</div>
        </div></td>
        <td><div class="td-inner">
          \${r.resume_filename
            ? \`<a class="btn-resume" href="/admin/uploads/\${esc(r.resume_filename)}" target="_blank">📄 Resume</a>\`
            : '<span class="no-file">—</span>'}
        </div></td>
        <td><div class="td-inner">
          <div style="margin-bottom:6px"><span class="badge \${STATUS_BADGES[r.status] || 'badge-skipped'}">\${STATUS_LABELS[r.status] || r.status}</span></div>
          <select class="status-sel" onchange="setStatus(\${r.id}, this.value)">
            \${['new','picked','editing','done','skipped'].map(s =>
              \`<option value="\${s}" \${r.status===s?'selected':''}>\${STATUS_LABELS[s]}</option>\`
            ).join('')}
          </select>
        </div></td>
        <td class="video-cell"><div class="td-inner">\${videoCell}</div></td>
        <td><div class="td-inner">
          <textarea class="notes-input" placeholder="Notes…" onblur="saveNotes(\${r.id}, this.value)">\${esc(r.notes||'')}</textarea>
        </div></td>
        <td><div class="td-inner" style="text-align:right;color:#222;font-size:11px;font-family:monospace">#\${r.id}</div></td>
      </tr>\`;
    }).join('');
  }

  async function setStatus(id, status) {
    await fetch('/admin/api/status', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, status })
    });
    const row = allData.find(r => r.id === id);
    if (row) { row.status = status; updateStats(); render(); }
    toast('Status updated');
  }

  async function saveNotes(id, notes) {
    await fetch('/admin/api/notes', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, notes })
    });
    const row = allData.find(r => r.id === id);
    if (row) row.notes = notes;
  }

  function triggerVideoUpload(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp4,.mov,.m4v,.webm';
    input.onchange = () => uploadVideo(id, input);
    input.click();
  }

  async function uploadVideo(id, input) {
    if (!input.files.length) return;

    const indicator   = document.getElementById('uploading-' + id);
    const progressBar = document.getElementById('progress-' + id);
    const progressFill= document.getElementById('progress-fill-' + id);

    if (indicator)    indicator.classList.add('show');
    if (progressBar)  progressBar.classList.add('show');

    const fd = new FormData();
    fd.append('video', input.files[0]);

    // XHR so we get upload progress
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/admin/api/upload-video/' + id);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && progressFill) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = pct + '%';
      }
    });

    xhr.addEventListener('load', () => {
      if (indicator)   indicator.classList.remove('show');
      if (progressBar) progressBar.classList.remove('show');
      if (progressFill) progressFill.style.width = '0%';

      try {
        const json = JSON.parse(xhr.responseText);
        if (json.ok) {
          const row = allData.find(r => r.id === id);
          if (row) {
            row.cloudflare_video_id = json.videoId;
            row.status = 'done';
            row.email_sent_at = json.emailSent ? new Date().toISOString() : null;
          }
          updateStats();
          render();
          const msg = json.emailSent ? 'Uploaded ✓ — Email sent ✉' : 'Uploaded ✓ — Email not sent';
          toast(msg, '#4ade80');
        } else {
          toast('Upload failed: ' + (json.error || 'unknown error'), '#f87171');
        }
      } catch(e) {
        toast('Upload error', '#f87171');
      }
    });

    xhr.addEventListener('error', () => {
      if (indicator)   indicator.classList.remove('show');
      if (progressBar) progressBar.classList.remove('show');
      toast('Upload failed', '#f87171');
    });

    toast('Uploading to Cloudflare…', '#a5b4fc');
    xhr.send(fd);
  }

  function updateStats() {
    const counts = { new:0, picked:0, editing:0, done:0, skipped:0 };
    allData.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    document.getElementById('s-total').textContent   = allData.length;
    document.getElementById('s-new').textContent     = counts.new;
    document.getElementById('s-picked').textContent  = counts.picked;
    document.getElementById('s-editing').textContent = counts.editing;
    document.getElementById('s-done').textContent    = counts.done;
    ['all','new','picked','editing','done','skipped'].forEach(f => {
      const el = document.getElementById('tc-' + f);
      if (el) el.textContent = f==='all' ? allData.length : (counts[f] || 0);
    });
  }

  async function load() {
    const dot = document.getElementById('rdot');
    dot.classList.add('pulse');
    const res = await fetch('/admin/api/submissions');
    allData = await res.json();
    updateStats();
    render();
    setTimeout(() => dot.classList.remove('pulse'), 500);
  }

  load();
  setInterval(load, 30000);
</script>
</body>
</html>`;
}

/* ────────────────────────────────────────────
   START
──────────────────────────────────────────── */
app.listen(PORT, "0.0.0.0", () => {
  console.log("\n  Roast → http://localhost:" + PORT);
  console.log("  Admin → http://localhost:" + PORT + "/admin");
  console.log("  Watch → http://localhost:" + PORT + "/watch/:id\n");
});
