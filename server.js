const express    = require('express');
const session    = require('express-session');
const multer     = require('multer');
const Database   = require('better-sqlite3');
const { v4: uuid } = require('uuid');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = 5000;
const PASS = 'jumpseat2026';

/* ── Uploads dir ── */
const UPLOADS = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

/* ── Database ── */
const db = new Database(path.join(__dirname, 'submissions.db'));
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

/* ── Safe migrations (columns added after initial schema) ── */
try { db.exec('ALTER TABLE submissions ADD COLUMN video_filename TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE submissions ADD COLUMN video_orig_name TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE submissions ADD COLUMN notes TEXT'); } catch(e) {}

/* ── Middleware ── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'j5_secret_xK9#mQ',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8h
}));

/* ── CORS ── */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ── Resume upload ── */
const resumeStorage = multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) => cb(null, 'resume_' + uuid() + path.extname(file.originalname))
});
const resumeUpload = multer({
  storage: resumeStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf','.doc','.docx'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Invalid file type'), ok);
  }
});

/* ── Video upload ── */
const videoStorage = multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) => cb(null, 'video_' + uuid() + path.extname(file.originalname))
});
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const ok = ['.mp4','.mov','.m4v','.webm'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Invalid file type'), ok);
  }
});

/* ────────────────────────────────────────────
   PUBLIC: Form submission endpoint
──────────────────────────────────────────── */
app.post('/api/submit', resumeUpload.single('resume'), (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ ok: false, error: 'Name and email required' });

  db.prepare(`
    INSERT INTO submissions (name, email, resume_filename, resume_orig_name)
    VALUES (?, ?, ?, ?)
  `).run(name, email, req.file?.filename || null, req.file?.originalname || null);

  res.json({ ok: true });
});

/* ────────────────────────────────────────────
   AUTH helpers
──────────────────────────────────────────── */
function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  res.redirect('/admin/login');
}

/* ────────────────────────────────────────────
   ADMIN: Login
──────────────────────────────────────────── */
app.get('/admin/login', (req, res) => {
  if (req.session?.authed) return res.redirect('/admin');
  res.send(loginPage());
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === PASS) {
    req.session.authed = true;
    return res.redirect('/admin');
  }
  res.send(loginPage('Wrong password.'));
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.get('/admin', requireAuth, (req, res) => res.send(adminPage()));

/* ────────────────────────────────────────────
   ADMIN: API
──────────────────────────────────────────── */
app.get('/admin/api/submissions', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM submissions ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/admin/api/status', requireAuth, (req, res) => {
  const { id, status } = req.body;
  const valid = ['new','picked','editing','done','skipped'];
  if (!valid.includes(status)) return res.status(400).json({ ok: false });
  db.prepare('UPDATE submissions SET status = ? WHERE id = ?').run(status, id);
  res.json({ ok: true });
});

app.post('/admin/api/notes', requireAuth, (req, res) => {
  const { id, notes } = req.body;
  db.prepare('UPDATE submissions SET notes = ? WHERE id = ?').run(notes || '', id);
  res.json({ ok: true });
});

/* ── Video upload per submission ── */
app.post('/admin/api/upload-video/:id', requireAuth, videoUpload.single('video'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file received' });

  /* Delete old video file if one existed */
  const row = db.prepare('SELECT video_filename FROM submissions WHERE id = ?').get(id);
  if (row?.video_filename) {
    const old = path.join(UPLOADS, row.video_filename);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  db.prepare('UPDATE submissions SET video_filename = ?, video_orig_name = ?, status = ? WHERE id = ?')
    .run(req.file.filename, req.file.originalname, 'done', id);

  res.json({ ok: true, filename: req.file.filename, orig: req.file.originalname });
});

/* ── File downloads (resume + video) ── */
app.get('/admin/uploads/:filename', requireAuth, (req, res) => {
  const file = path.join(UPLOADS, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.sendFile(file);
});

/* ────────────────────────────────────────────
   Redirect /admin/* catch-all
──────────────────────────────────────────── */
app.get('/admin/*path', requireAuth, (req, res) => res.redirect('/admin'));

/* ── Static landing page ── */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use(express.static(__dirname, { index: false }));

/* ────────────────────────────────────────────
   HTML TEMPLATES
──────────────────────────────────────────── */
function loginPage(err = '') {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Jumpseat Admin</title>
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
  ${err ? `<div class="err">${err}</div>` : ''}
  <form method="POST" action="/admin/login">
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Sign in →</button>
  </form>
</div>
</body>
</html>`;
}

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

  /* ── Header ── */
  .hdr{display:flex;align-items:center;justify-content:space-between;padding:0 28px;height:52px;border-bottom:1px solid #1a1a1a;position:sticky;top:0;background:#0a0a0a;z-index:100}
  .hdr-logo{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#d91e1e}
  .hdr-right{display:flex;align-items:center;gap:12px}
  .hdr-right span{font-size:12px;color:#444}
  .btn-sm{background:none;border:1px solid #222;color:#555;font-size:12px;font-weight:600;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:inherit}
  .btn-sm:hover{color:#fff;border-color:#444}

  /* ── Stats bar ── */
  .stats{display:flex;gap:12px;padding:20px 28px 0;flex-wrap:wrap}
  .stat{background:#111;border:1px solid #1a1a1a;border-radius:8px;padding:14px 18px;min-width:100px}
  .stat-n{font-size:26px;font-weight:700;line-height:1}
  .stat-l{font-size:11px;color:#444;margin-top:4px;text-transform:uppercase;letter-spacing:.08em}

  /* ── Pipeline tabs ── */
  .tabs{display:flex;gap:2px;padding:20px 28px 0;border-bottom:1px solid #111}
  .tab{background:none;border:none;border-bottom:2px solid transparent;color:#444;font-size:13px;font-weight:500;padding:8px 16px 10px;cursor:pointer;font-family:inherit;transition:all .15s;margin-bottom:-1px}
  .tab:hover{color:#888}
  .tab.active{color:#fff;border-bottom-color:#d91e1e}
  .tab-count{font-size:11px;opacity:.55;margin-left:5px;font-weight:400}

  /* ── Table ── */
  .tbl-wrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:10px 14px;color:#333;font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #131313;white-space:nowrap}
  td{padding:0;border-bottom:1px solid #0d0d0d;vertical-align:top}
  .td-inner{padding:12px 14px}
  tr:hover td{background:#0c0c0c}

  /* ── Name / email ── */
  .name{font-weight:600;font-size:13px;margin-bottom:2px}
  .email{color:#555;font-size:12px}
  .sub-date{font-size:11px;color:#333;margin-top:3px}

  /* ── Badges ── */
  .badge{display:inline-block;font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
  .badge-new     {background:rgba(217,30,30,.12);color:#f87171}
  .badge-picked  {background:rgba(234,179,8,.1);color:#fbbf24}
  .badge-editing {background:rgba(99,102,241,.12);color:#a5b4fc}
  .badge-done    {background:rgba(34,197,94,.1);color:#4ade80}
  .badge-skipped {background:rgba(255,255,255,.04);color:#333}

  /* ── Resume button ── */
  .btn-resume{display:inline-flex;align-items:center;gap:5px;background:rgba(217,30,30,.1);border:1px solid rgba(217,30,30,.25);color:#f87171;font-size:11px;font-weight:700;padding:5px 10px;border-radius:6px;cursor:pointer;text-decoration:none;font-family:inherit;transition:all .15s;white-space:nowrap}
  .btn-resume:hover{background:rgba(217,30,30,.2);border-color:rgba(217,30,30,.5);color:#fff}
  .no-file{color:#2a2a2a;font-size:12px}

  /* ── Video cell ── */
  .video-cell{min-width:160px}
  .btn-upload-video{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.04);border:1px dashed #222;color:#444;font-size:11px;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
  .btn-upload-video:hover{border-color:#555;color:#888}
  .btn-upload-video input[type=file]{display:none}
  .video-done{display:inline-flex;align-items:center;gap:6px}
  .video-done a{color:#4ade80;font-size:11px;font-weight:700;text-decoration:none}
  .video-done a:hover{text-decoration:underline}
  .video-done .btn-reupload{background:none;border:none;color:#333;font-size:11px;cursor:pointer;font-family:inherit;padding:0 0 0 4px}
  .video-done .btn-reupload:hover{color:#888}
  .uploading-indicator{font-size:11px;color:#a5b4fc;display:none;align-items:center;gap:5px}
  .uploading-indicator.show{display:inline-flex}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner{width:12px;height:12px;border:2px solid rgba(165,180,252,.3);border-top-color:#a5b4fc;border-radius:50%;animation:spin .7s linear infinite}

  /* ── Status select ── */
  select.status-sel{background:#111;border:1px solid #1a1a1a;color:#fff;font-size:12px;padding:5px 8px;border-radius:6px;font-family:inherit;cursor:pointer;outline:none;width:100%}
  select.status-sel:focus{border-color:#d91e1e}

  /* ── Notes ── */
  .notes-input{width:100%;background:transparent;border:none;color:#555;font-size:11px;font-family:inherit;outline:none;resize:none;height:32px;line-height:1.5;padding:0}
  .notes-input:focus{color:#aaa}
  .notes-input::placeholder{color:#2a2a2a}

  /* ── Empty ── */
  .empty{text-align:center;padding:80px;color:#222}
  .empty p{font-size:13px;margin-top:8px}

  /* ── Pulse indicator ── */
  .refresh-dot{width:5px;height:5px;border-radius:50%;background:#1e1e1e;display:inline-block;margin-right:6px;transition:background .3s;vertical-align:middle}
  .refresh-dot.pulse{background:#d91e1e}

  /* ── Toast ── */
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

<!-- Stats -->
<div class="stats" id="stats-bar">
  <div class="stat"><div class="stat-n" id="s-total">—</div><div class="stat-l">Total</div></div>
  <div class="stat"><div class="stat-n" id="s-new" style="color:#f87171">—</div><div class="stat-l">New</div></div>
  <div class="stat"><div class="stat-n" id="s-picked" style="color:#fbbf24">—</div><div class="stat-l">Picked</div></div>
  <div class="stat"><div class="stat-n" id="s-editing" style="color:#a5b4fc">—</div><div class="stat-l">Editing</div></div>
  <div class="stat"><div class="stat-n" id="s-done" style="color:#4ade80">—</div><div class="stat-l">Done</div></div>
</div>

<!-- Pipeline tabs -->
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
    if (diff < 60000)  return 'just now';
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
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
    setTimeout(() => el.classList.remove('show'), 2200);
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
      const videoCell = r.video_filename
        ? \`<div class="video-done">
             <a href="/admin/uploads/\${esc(r.video_filename)}" target="_blank">▶ \${esc(r.video_orig_name || 'Watch')}</a>
             <button class="btn-reupload" title="Replace video" onclick="triggerVideoUpload(\${r.id})">↺</button>
           </div>
           <div class="uploading-indicator" id="uploading-\${r.id}"><div class="spinner"></div> Uploading…</div>\`
        : \`<label class="btn-upload-video" title="Upload finished Short">
             <input type="file" accept=".mp4,.mov,.m4v,.webm" onchange="uploadVideo(\${r.id}, this)" />
             ↑ Upload Short
           </label>
           <div class="uploading-indicator" id="uploading-\${r.id}"><div class="spinner"></div> Uploading…</div>\`;

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

  /* Video upload */
  function triggerVideoUpload(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp4,.mov,.m4v,.webm';
    input.onchange = () => uploadVideo(id, input);
    input.click();
  }

  async function uploadVideo(id, input) {
    if (!input.files.length) return;
    const indicator = document.getElementById('uploading-' + id);
    if (indicator) indicator.classList.add('show');

    const fd = new FormData();
    fd.append('video', input.files[0]);

    try {
      const res = await fetch('/admin/api/upload-video/' + id, { method:'POST', body: fd });
      const json = await res.json();
      if (json.ok) {
        const row = allData.find(r => r.id === id);
        if (row) { row.video_filename = json.filename; row.video_orig_name = json.orig; row.status = 'done'; }
        updateStats();
        render();
        toast('Video uploaded ✓', '#4ade80');
      } else {
        toast('Upload failed', '#f87171');
      }
    } catch(e) {
      toast('Upload error', '#f87171');
    }
    if (indicator) indicator.classList.remove('show');
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

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Roast → http://localhost:' + PORT);
  console.log('  Roast Admin → http://localhost:' + PORT + '/admin');
  console.log('  Password: ' + PASS + '\n');
});
