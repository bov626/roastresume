const express = require("express");
const session = require("express-session");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = 5000;
const PASS = "jumpseat2026";

/* ── Supabase ── */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

/* ── Uploads dir (resumes only, temp) ── */
const UPLOADS = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

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

/* ── Video upload ── */
const videoStorage = multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) =>
    cb(null, "video_" + uuid() + path.extname(file.originalname)),
});
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 2000 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [".mp4", ".mov", ".m4v", ".webm"].includes(
      path.extname(file.originalname).toLowerCase(),
    );
    cb(ok ? null : new Error("Invalid file type"), ok);
  },
});

/* ────────────────────────────────────────────
   CLOUDFLARE HELPERS
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
      timeout: 600000,
    },
  );
  return res.data.result;
}

async function checkCloudflareReady(videoId) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${videoId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        },
      },
    );
    const data = await res.json();
    return data?.result?.status?.state === "ready";
  } catch (e) {
    return false;
  }
}

/* ────────────────────────────────────────────
   EMAIL
──────────────────────────────────────────── */
async function sendRoastEmail(toEmail, firstName, watchToken) {
  const watchUrl = `https://pleaseroastmyresume.com/watch/${watchToken}`;

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
      text: `${firstName},

I've reviewed a lot of resumes.

Yours made me question my career choices.

I'm talking "printed it out, stared at it, folded it into a paper airplane and threw it out the window" bad.

...okay, not really. But it did give me a lot to work with.

Watch your roast here: ${watchUrl}

Fair warning — I don't pull punches. But everything in there is fixable, and I tell you exactly how.

Wilson

--
pleaseroastmyresume.com
Want us to land you a second job? jumpseatjobs.com`,
    }),
  });
  return res.ok;
}

async function sendResourcesEmail(toEmail) {
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
      subject: "Dammit Dino",
      html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your resume template is at the bottom of this email.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <div style="max-width:560px;margin:0 auto;padding:48px 32px;color:#111111;">
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">"I think Wilson has a blind barber," David said while tugging my hair.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">Everyone laughed. My cheeks lit up.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">I ran to the bathroom. In the mirror I saw a tuft of hair, significantly longer than the rest.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">I scrambled around searching for something sharp. A piece of glass. A stray knife someone forgot.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 24px;">To no avail. The hair stays.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">God dammit Dino.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">He was well into retirement age and specialized in military buzzcuts and deep-sea fishing. My parents took me to him because he was the cheapest barber in town. By a wide margin.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">You get what you pay for.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">The next time I had to get a haircut, when he called my name I started crying. Wailing. Begging my dad. "Please don't let him cut my hair."</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">For the next decade I hated every haircut I got. I put it off as long as possible. Tried many barbers. To no avail.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 24px;">Then last year I realized it was never their fault. It was mine.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">Every haircut was bad because I could never explain what I wanted. I'd sit down, say something vague, forget the clipper length, and leave looking like I lost a bet.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">One simple change fixed it: I showed the barber pictures. That's it.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">You can't explain your way to a good haircut.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 32px;">You need a solid starting point.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">Same goes for your resume.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 32px;">Here's the template: <a href="https://pleaseroastmyresume.com/resources" style="color:#111111;text-decoration:underline;">pleaseroastmyresume.com/resources</a></p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 32px;">-W.W.</p>
    <p style="font-size:13px;line-height:1.7;color:#888888;border-top:1px solid #eeeeee;padding-top:20px;margin:0;">P.S. There's also a full video walk-through of every decision we made in building it. Enjoy.</p>
  </div>
</body>
</html>`,
    }),
  });
  return res.ok;
}

async function sendReportReadyEmail(toEmail, firstName, pdfUrl) {
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
      subject: "We need to talk",
      html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    Your OE Risk Report is ready. We barely made it out alive.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <div style="max-width:560px;margin:0 auto;padding:48px 32px;color:#111111;">
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">${firstName},</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">We barely made it out alive.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">First, we took a boat to the treacherous jungle most folks know as LinkedIn. But the indigenous people call it "Kah-Nekth", which roughly translates to "Hell."</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">Alexander kept staring at the fruit on the trees. Beautiful blue rectangles with rounded edges. Each one whispered, "apply now." I knew we would lose him. He was so young.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">After that we became you. Yes you.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 16px;">Half the battle is understanding your workload.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 24px;">I can tell you this. That is the last time. Every team member has some form of complex PTSD now.</p>
    <p style="font-size:15px;line-height:1.9;margin:0 0 32px;">Hope it was worth it.</p>
    <a href="${pdfUrl}" style="display:inline-block;background:#d91e1e;color:#fff;font-family:Inter,Arial,sans-serif;font-weight:700;font-size:16px;padding:16px 32px;border-radius:8px;text-decoration:none;letter-spacing:-0.01em;">View My Report →</a>
    <p style="font-size:15px;line-height:1.9;margin:40px 0 0;">-W.W.</p>
    <p style="font-size:13px;line-height:1.7;color:#888888;border-top:1px solid #eeeeee;padding-top:20px;margin:32px 0 0;">P.S. Alex came back but he is not the same. Beware the allure of the Easy Apply.</p>
  </div>
</body>
</html>`,
    }),
  });
  return res.ok;
}

/* ────────────────────────────────────────────
   BACKGROUND POLLER
──────────────────────────────────────────── */
const activePollers = new Map();

function startPolling(submissionId) {
  if (activePollers.has(submissionId)) return;
  console.log(`[Poll] Starting poll for submission #${submissionId}`);

  const intervalId = setInterval(async () => {
    const { data: row } = await supabase
      .from("submissions")
      .select("name, email, cloudflare_video_id, watch_token, email_sent_at")
      .eq("id", submissionId)
      .single();

    if (!row || row.email_sent_at) {
      clearInterval(intervalId);
      activePollers.delete(submissionId);
      return;
    }

    const ready = await checkCloudflareReady(row.cloudflare_video_id);
    console.log(`[Poll] #${submissionId} ready: ${ready}`);

    if (ready) {
      clearInterval(intervalId);
      activePollers.delete(submissionId);

      const firstName = row.name.trim().split(" ")[0];
      const emailOk = await sendRoastEmail(
        row.email,
        firstName,
        row.watch_token,
      );

      if (emailOk) {
        await supabase
          .from("submissions")
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", submissionId);
        console.log(`[Email] Sent to ${row.email}`);
      } else {
        console.error(`[Email] Failed for ${row.email}`);
      }
    }
  }, 60000);

  activePollers.set(submissionId, intervalId);
}

/* ── On startup: resume polling for any pending videos ── */
(async () => {
  const { data: pending } = await supabase
    .from("submissions")
    .select("id")
    .not("cloudflare_video_id", "is", null)
    .is("email_sent_at", null);
  if (pending) pending.forEach((row) => startPolling(row.id));
})();

/* ────────────────────────────────────────────
   PUBLIC: Form submission
──────────────────────────────────────────── */
app.post("/api/submit", resumeUpload.single("resume"), async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email)
    return res
      .status(400)
      .json({ ok: false, error: "Name and email required" });

  const { error } = await supabase.from("submissions").insert({
    name,
    email,
    resume_filename: req.file?.filename || null,
    resume_orig_name: req.file?.originalname || null,
  });

  if (error) {
    console.error("Supabase insert error:", error);
    return res.status(500).json({ ok: false, error: "Database error" });
  }

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
          send_welcome_email: true,
        }),
      },
    );
  } catch (e) {
    console.error("Beehiiv error:", e.message);
  }

  try {
    await sendResourcesEmail(email);
  } catch (e) {
    console.error("Resources email error:", e.message);
  }

  res.json({ ok: true });
});

app.get("/api/queue-count", async (req, res) => {
  const { count } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true });
  res.json({ count: (count || 0) + 11 });
});

/* ────────────────────────────────────────────
   PUBLIC: Watch page
──────────────────────────────────────────── */
app.get("/watch/:token", async (req, res) => {
  const { data: row } = await supabase
    .from("submissions")
    .select("name, cloudflare_video_id")
    .eq("watch_token", req.params.token)
    .single();

  if (!row || !row.cloudflare_video_id) {
    return res.status(404)
      .send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Ready</title>
<style>body{background:#0a0a0a;color:#fff;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}
h1{font-size:24px;font-weight:700;}p{color:#444;margin-top:8px;font-size:14px;}</style></head>
<body><div><h1>Not ready yet.</h1><p>Check back in a few minutes.</p></div></body></html>`);
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
// Replace app.post("/api/questionnaire") at line 422 with this:

app.post("/api/questionnaire", async (req, res) => {
  const {
    name,
    email,
    jobTitle,
    seniority,
    salary,
    hoursWork,
    hoursMeetings,
    remote,
  } = req.body;

  const salaryMap = {
    lt60: "Less than $60k",
    "60-90": "$60 - $90k",
    "90-130": "$90 - $130k",
    "130-170": "$130 - $170k",
    "170-250": "$170 - $250k",
    "250plus": "$250k+",
  };

  const seniorityMap = {
    entry: "Entry",
    mid: "Mid-level",
    senior: "Senior",
  };

  // 1. Save to Supabase
  try {
    await supabase.from("questionnaire_responses").insert({
      name,
      email,
      job_title: jobTitle,
      seniority,
      salary_range: salary,
      hours_work_per_day: parseInt(hoursWork) || null,
      hours_meetings_per_day: parseInt(hoursMeetings) || null,
      work_location: remote,
    });
  } catch (e) {
    console.error("Questionnaire insert error:", e.message);
  }

  // 2. Fire Make.com webhook — Make.com generates PDF and calls /api/report-ready when done
  try {
    await axios.post(
      "https://hook.us2.make.com/ttyc8em3qf3i9swyjsjvkd4vp89913wu",
      {
        first_name: name,
        email: email,
        job_title: jobTitle,
        years_experience: seniorityMap[seniority] || seniority,
        salary_band: salaryMap[salary] || salary,
        work_hours_daily: parseInt(hoursWork) || 0,
        meeting_hours_daily: parseInt(hoursMeetings) || 0,
        is_remote: remote,
      },
    );
  } catch (e) {
    console.error("Make.com webhook error:", e.message);
  }

  res.json({ ok: true });
});

app.get("/admin/api/submissions", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("submissions")
    .select("*")
    .order("id", { ascending: false });
  if (error) return res.status(500).json([]);
  res.json(data);
});

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
      console.log(`[CF] Uploading for #${id}...`);
      const cfResult = await uploadToCloudflare(
        localPath,
        req.file.originalname,
      );
      const videoId = cfResult.uid;
      console.log(`[CF] Done. Video ID: ${videoId}`);

      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

      await supabase
        .from("submissions")
        .update({
          cloudflare_video_id: videoId,
          status: "done",
          email_sent_at: null,
        })
        .eq("id", id);

      startPolling(id);

      res.json({ ok: true, videoId });
    } catch (err) {
      console.error("[CF] Error:", err.message);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      res
        .status(500)
        .json({ ok: false, error: "Cloudflare upload failed: " + err.message });
    }
  },
);

app.get("/admin/uploads/:filename", requireAuth, (req, res) => {
  const file = path.join(UPLOADS, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).send("Not found");
  res.sendFile(file);
});

app.get("/admin/*path", requireAuth, (req, res) => res.redirect("/admin"));
app.get("/oto", (req, res) => {
  const html = fs
    .readFileSync(path.join(__dirname, "oto.html"), "utf8")
    .replace(
      "PUBLISHABLE_KEY_PLACEHOLDER",
      process.env.STRIPE_PUBLISHABLE_KEY || "",
    );
  res.type("html").send(html);
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded_page",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: "payment",
      return_url: `${req.headers.origin}/questionnaire?session_id={CHECKOUT_SESSION_ID}`,
    });
    res.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/report-ready", async (req, res) => {
  const { email, first_name, pdf_url } = req.body;

  setTimeout(
    async () => {
      try {
        await sendReportReadyEmail(email, first_name, pdf_url);
        console.log("[Report] Sent to", email);
      } catch (e) {
        console.error("[Report] Email failed:", e.message);
      }
    },
    10 * 60 * 1000,
  );

  res.json({ ok: true });
});

app.get("/questionnaire", (req, res) =>
  res.sendFile(path.join(__dirname, "questionnaire.html")),
);
app.get("/waiting", (req, res) =>
  res.sendFile(path.join(__dirname, "waiting.html")),
);
app.get("/resources", (req, res) =>
  res.sendFile(path.join(__dirname, "resources.html")),
);
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
  .nav{padding:18px 28px;border-bottom:1px solid #111;display:flex;align-items:center;justify-content:space-between}
  .nav-logo{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d91e1e}
  .nav-link{font-size:12px;color:#333;text-decoration:none;font-weight:500;transition:color .15s}
  .nav-link:hover{color:#fff}
  .hero{max-width:780px;margin:0 auto;padding:56px 24px 32px;text-align:center}
  .eyebrow{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;background:#d91e1e;color:#fff;padding:4px 12px 6px;border-radius:4px;display:inline-block;margin-bottom:14px;}
  .headline{font-size:clamp(32px,5vw,52px);font-weight:900;letter-spacing:-.035em;line-height:1.05;margin-bottom:10px}
  .subline{font-size:14px;color:#444;letter-spacing:.01em}
  .player-outer{padding:0 24px;max-width:820px;margin:32px auto 0}
  .player-inner{aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden;border:1px solid #1a1a1a;box-shadow:0 0 0 1px #111,0 24px 80px rgba(0,0,0,.7),0 0 60px rgba(217,30,30,.06)}
  .player-inner iframe{width:100%;height:100%;border:none;display:block}
  .divider{width:32px;height:2px;background:#d91e1e;margin:48px auto 0;border-radius:2px;opacity:.6}
  .cta{max-width:500px;margin:32px auto;padding:0 24px 80px;text-align:center}
  .cta-eyebrow{font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#2a2a2a;margin-bottom:10px}
  .cta-heading{font-size:clamp(20px,3vw,26px);font-weight:900;letter-spacing:-.025em;line-height:1.2;margin-bottom:10px}
  .cta-sub{font-size:13px;color:#888;line-height:1.75;margin-bottom:24px}
  .cta-btn{display:inline-flex;align-items:center;gap:8px;background:#d91e1e;color:#fff;font-family:'Inter',sans-serif;font-size:13px;font-weight:700;padding:13px 26px;border-radius:8px;text-decoration:none;letter-spacing:-.01em;box-shadow:0 4px 24px rgba(217,30,30,.25);transition:transform .15s,box-shadow .15s}
  .cta-btn:hover{transform:translateY(-1px);box-shadow:0 6px 28px rgba(217,30,30,.35)}
  footer{padding:20px 24px;text-align:center;border-top:1px solid #0f0f0f}
  footer p{font-size:11px;color:#1a1a1a}
</style>
</head>
<body>
<div class="hero">
  <div class="eyebrow">Your Roast</div>
  <h1 class="headline">Here it is, ${firstName}.</h1>
  <p class="subline">Don't take it personally. Take it seriously.</p>
</div>
<div class="player-outer">
  <div class="player-inner">
    <iframe
      src="https://iframe.cloudflarestream.com/${videoId}?autoplay=false&muted=false&preload=none&letterboxColor=transparent&primaryColor=%23d91e1e"
      allow="accelerometer; gyroscope; encrypted-media; picture-in-picture;"
      allowfullscreen="true">
    </iframe>
  </div>
</div>
<div class="divider"></div>
<div class="cta">
  <h2 class="cta-heading">Want more than a roast?</h2>
  <p class="cta-sub">We help people land remote jobs, often two at once. If you're serious about your next move, that's what Jumpseat is for.</p>
  <a class="cta-btn" href="https://jumpseatjobs.com" target="_blank">
    See How It Works
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
  </a>
</div>
<footer><p>© 2026 Jumpseat. All rights reserved.</p></footer>
</body>
</html>`;
}

/* ────────────────────────────────────────────
   LOGIN PAGE
──────────────────────────────────────────── */
function loginPage(err = "") {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Roast Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#111;border:1px solid #1e1e1e;border-radius:14px;padding:40px 36px;width:340px}
  .logo{font-size:12px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#d91e1e;margin-bottom:28px}
  h1{font-size:22px;font-weight:700;margin-bottom:24px}
  input{width:100%;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 14px;color:#fff;font-size:14px;font-family:inherit;outline:none;margin-bottom:14px}
  input:focus{border-color:#d91e1e}
  button{width:100%;background:#d91e1e;color:#fff;border:none;border-radius:8px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
  button:hover{background:#b91a1a}
  .err{color:#f87171;font-size:13px;margin-bottom:12px}
</style></head>
<body><div class="card">
  <div class="logo">Roast Admin</div>
  <h1>Sign in</h1>
  ${err ? `<div class="err">${err}</div>` : ""}
  <form method="POST" action="/admin/login">
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Sign in →</button>
  </form>
</div></body></html>`;
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
  .hdr-logo{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#d91e1e}
  .hdr-right{display:flex;align-items:center;gap:12px}
  .hdr-right span{font-size:12px;color:#333}
  .btn-sm{background:none;border:1px solid #1e1e1e;color:#444;font-size:12px;font-weight:600;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:inherit}
  .btn-sm:hover{color:#fff;border-color:#444}
  .stats{display:flex;gap:10px;padding:20px 28px 0;flex-wrap:wrap}
  .stat{background:#111;border:1px solid #1a1a1a;border-radius:8px;padding:14px 18px;min-width:90px}
  .stat-n{font-size:24px;font-weight:700;line-height:1}
  .stat-l{font-size:10px;color:#333;margin-top:4px;text-transform:uppercase;letter-spacing:.1em}
  .tabs{display:flex;gap:2px;padding:20px 28px 0;border-bottom:1px solid #111}
  .tab{background:none;border:none;border-bottom:2px solid transparent;color:#333;font-size:13px;font-weight:500;padding:8px 16px 10px;cursor:pointer;font-family:inherit;transition:all .15s;margin-bottom:-1px}
  .tab:hover{color:#888}
  .tab.active{color:#fff;border-bottom-color:#d91e1e}
  .tab-count{font-size:11px;opacity:.45;margin-left:4px}
  .tbl-wrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:10px 16px;color:#2a2a2a;font-weight:600;font-size:10px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #111;white-space:nowrap}
  td{padding:0;border-bottom:1px solid #0d0d0d;vertical-align:middle}
  .td-inner{padding:14px 16px}
  tr:hover td{background:#0c0c0c}
  .name{font-weight:600;font-size:13px;margin-bottom:2px}
  .email{color:#444;font-size:12px}
  .sub-date{font-size:11px;color:#2a2a2a;margin-top:3px}
  .btn-resume{display:inline-flex;align-items:center;gap:5px;background:rgba(217,30,30,.08);border:1px solid rgba(217,30,30,.2);color:#c0534a;font-size:11px;font-weight:700;padding:5px 10px;border-radius:6px;cursor:pointer;text-decoration:none;font-family:inherit;transition:all .15s;white-space:nowrap}
  .btn-resume:hover{background:rgba(217,30,30,.18);color:#fff}
  .no-file{color:#1e1e1e;font-size:12px}
  .video-cell{min-width:200px}
  .btn-upload{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.03);border:1px dashed #1e1e1e;color:#333;font-size:11px;font-weight:600;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
  .btn-upload:hover{border-color:#444;color:#888}
  .btn-upload input[type=file]{display:none}
  .video-state{display:flex;flex-direction:column;gap:4px}
  .watch-link{color:#4ade80;font-size:12px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:5px}
  .watch-link:hover{text-decoration:underline}
  .state-tag{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  .state-processing{color:#fbbf24}
  .state-sent{color:#4ade80}
  .btn-replace{background:none;border:none;color:#222;font-size:11px;cursor:pointer;font-family:inherit;padding:0;margin-top:2px;transition:color .15s;text-align:left}
  .btn-replace:hover{color:#555}
  .upload-indicator{display:none;align-items:center;gap:6px;font-size:11px;color:#a5b4fc;margin-top:4px}
  .upload-indicator.show{display:flex}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner{width:11px;height:11px;border:1.5px solid rgba(165,180,252,.25);border-top-color:#a5b4fc;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
  .progress-bar{height:2px;background:#111;border-radius:2px;overflow:hidden;margin-top:5px;display:none}
  .progress-bar.show{display:block}
  .progress-fill{height:100%;background:#a5b4fc;border-radius:2px;width:0%;transition:width .15s}
  .empty{text-align:center;padding:80px;color:#1e1e1e}
  .empty p{font-size:13px;color:#2a2a2a;margin-top:8px}
  .rdot{width:5px;height:5px;border-radius:50%;background:#1a1a1a;display:inline-block;margin-right:6px;transition:background .3s;vertical-align:middle}
  .rdot.pulse{background:#d91e1e}
  #toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(16px);background:#111;border:1px solid #1e1e1e;color:#fff;font-size:12px;font-weight:600;padding:9px 18px;border-radius:8px;opacity:0;transition:all .2s;pointer-events:none;z-index:999;white-space:nowrap}
  #toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-logo">Roast Pipeline</div>
  <div class="hdr-right">
    <span><span class="rdot" id="rdot"></span>Live</span>
    <form method="POST" action="/admin/logout" style="margin:0">
      <button class="btn-sm" type="submit">Sign out</button>
    </form>
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-n" id="s-total">—</div><div class="stat-l">Total</div></div>
  <div class="stat"><div class="stat-n" id="s-pending" style="color:#f87171">—</div><div class="stat-l">Pending</div></div>
  <div class="stat"><div class="stat-n" id="s-processing" style="color:#fbbf24">—</div><div class="stat-l">Processing</div></div>
  <div class="stat"><div class="stat-n" id="s-done" style="color:#4ade80">—</div><div class="stat-l">Sent</div></div>
</div>

<div class="tabs">
  <button class="tab active" onclick="setFilter('all',this)">All <span class="tab-count" id="tc-all"></span></button>
  <button class="tab" onclick="setFilter('pending',this)">Pending <span class="tab-count" id="tc-pending"></span></button>
  <button class="tab" onclick="setFilter('processing',this)">Processing <span class="tab-count" id="tc-processing"></span></button>
  <button class="tab" onclick="setFilter('done',this)">Sent <span class="tab-count" id="tc-done"></span></button>
</div>

<div class="tbl-wrap">
  <table>
    <thead>
      <tr>
        <th style="width:220px">Person</th>
        <th style="width:100px">Resume</th>
        <th>Roast Video</th>
        <th style="width:80px;text-align:right">ID</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <div id="empty" class="empty" style="display:none">
    <div style="font-size:28px">📭</div>
    <p>Nothing here.</p>
  </div>
</div>

<div id="toast"></div>

<script>
  let allData = [];
  let currentFilter = 'all';

  function getState(r) {
    if (r.email_sent_at) return 'done';
    if (r.cloudflare_video_id) return 'processing';
    return 'pending';
  }

  function fmt(dt) {
    const d = new Date(dt), now = new Date(), diff = now - d;
    if (diff < 60000)    return 'just now';
    if (diff < 3600000)  return Math.floor(diff/60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function toast(msg, color='#fff') {
    const el = document.getElementById('toast');
    el.textContent = msg; el.style.color = color;
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
    const rows = currentFilter === 'all' ? allData : allData.filter(r => getState(r) === currentFilter);
    const tbody = document.getElementById('tbody');

    if (rows.length === 0) {
      tbody.innerHTML = '';
      document.getElementById('empty').style.display = 'block';
      return;
    }
    document.getElementById('empty').style.display = 'none';

    tbody.innerHTML = rows.map(r => {
      const state = getState(r);
      let videoCell;

      if (state === 'done') {
        videoCell = \`
          <div class="video-state">
            <a class="watch-link" href="/watch/\${esc(r.watch_token)}" target="_blank">▶ Watch Roast</a>
            <span class="state-tag state-sent">✉ Email sent</span>
            <button class="btn-replace" onclick="triggerUpload(\${r.id})">↺ Replace video</button>
          </div>
          <div class="upload-indicator" id="ind-\${r.id}"><div class="spinner"></div> Uploading…</div>
          <div class="progress-bar" id="pb-\${r.id}"><div class="progress-fill" id="pf-\${r.id}"></div></div>
        \`;
      } else if (state === 'processing') {
        videoCell = \`
          <div class="video-state">
            <a class="watch-link" href="/watch/\${esc(r.watch_token)}" target="_blank">▶ Preview</a>
            <span class="state-tag state-processing">⏳ Processing — email sending soon</span>
            <button class="btn-replace" onclick="triggerUpload(\${r.id})">↺ Replace video</button>
          </div>
          <div class="upload-indicator" id="ind-\${r.id}"><div class="spinner"></div> Uploading…</div>
          <div class="progress-bar" id="pb-\${r.id}"><div class="progress-fill" id="pf-\${r.id}"></div></div>
        \`;
      } else {
        videoCell = \`
          <label class="btn-upload">
            <input type="file" accept=".mp4,.mov,.m4v,.webm" onchange="uploadVideo(\${r.id}, this)" />
            ↑ Upload Roast
          </label>
          <div class="upload-indicator" id="ind-\${r.id}"><div class="spinner"></div> Uploading to Cloudflare…</div>
          <div class="progress-bar" id="pb-\${r.id}"><div class="progress-fill" id="pf-\${r.id}"></div></div>
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
        <td class="video-cell"><div class="td-inner">\${videoCell}</div></td>
        <td><div class="td-inner" style="text-align:right;color:#1e1e1e;font-size:11px;font-family:monospace">#\${r.id}</div></td>
      </tr>\`;
    }).join('');
  }

  function updateStats() {
    const counts = { pending:0, processing:0, done:0 };
    allData.forEach(r => counts[getState(r)]++);
    document.getElementById('s-total').textContent       = allData.length;
    document.getElementById('s-pending').textContent     = counts.pending;
    document.getElementById('s-processing').textContent  = counts.processing;
    document.getElementById('s-done').textContent        = counts.done;
    document.getElementById('tc-all').textContent        = allData.length;
    document.getElementById('tc-pending').textContent    = counts.pending;
    document.getElementById('tc-processing').textContent = counts.processing;
    document.getElementById('tc-done').textContent       = counts.done;
  }

  function triggerUpload(id) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.mp4,.mov,.m4v,.webm';
    input.onchange = () => uploadVideo(id, input);
    input.click();
  }

  async function uploadVideo(id, input) {
    if (!input.files.length) return;
    const ind = document.getElementById('ind-' + id);
    const pb  = document.getElementById('pb-' + id);
    const pf  = document.getElementById('pf-' + id);
    if (ind) ind.classList.add('show');
    if (pb)  pb.classList.add('show');

    const fd = new FormData();
    fd.append('video', input.files[0]);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/admin/api/upload-video/' + id);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && pf) pf.style.width = Math.round(e.loaded/e.total*100) + '%';
    });

    xhr.addEventListener('load', () => {
      if (ind) ind.classList.remove('show');
      if (pb)  pb.classList.remove('show');
      if (pf)  pf.style.width = '0%';
      try {
        const json = JSON.parse(xhr.responseText);
        if (json.ok) {
          const row = allData.find(r => r.id === id);
          if (row) { row.cloudflare_video_id = json.videoId; row.email_sent_at = null; }
          updateStats(); render();
          toast('Uploaded ✓ — Email sends when ready', '#4ade80');
        } else {
          toast('Upload failed: ' + (json.error || 'unknown'), '#f87171');
        }
      } catch(e) { toast('Upload error', '#f87171'); }
    });

    xhr.addEventListener('error', () => {
      if (ind) ind.classList.remove('show');
      if (pb)  pb.classList.remove('show');
      toast('Upload failed', '#f87171');
    });

    toast('Uploading to Cloudflare…', '#a5b4fc');
    xhr.send(fd);
  }

  async function load() {
    const dot = document.getElementById('rdot');
    dot.classList.add('pulse');
    const res = await fetch('/admin/api/submissions');
    allData = await res.json();
    updateStats(); render();
    setTimeout(() => dot.classList.remove('pulse'), 400);
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
  console.log("\n  Roast  → http://localhost:" + PORT);
  console.log("  Admin  → http://localhost:" + PORT + "/admin");
  console.log("  Watch  → http://localhost:" + PORT + "/watch/:token\n");
});
