/* Roast Lab — results page: render PDF, run scan animation + analysis, reveal verdict. */

const meta = JSON.parse(sessionStorage.getItem("roast:meta") || "null");
const fileDataUrl = sessionStorage.getItem("roast:file");

if (!meta) {
  // Nothing to show — someone hit results.html directly.
  window.location.href = "index.html";
}

/* ── helpers ── */
function dataURLtoUint8(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function whenPdfjsReady() {
  return new Promise((resolve) => {
    if (window.__pdfjs) return resolve();
    window.addEventListener("pdfjs-ready", () => resolve(), { once: true });
    setTimeout(resolve, 3000); // don't hang forever
  });
}

/* ── PDF viewer (multi-page) ── */
const pdfViewer = { doc: null, pageCount: 0, currentPage: 1, scale: 1.6, ready: false };
const pdfRenderTasks = new WeakMap();
let resultsPdfSync = null;

async function loadPdfDocument() {
  const isPdf = /\.pdf$/i.test(meta.filename || "") || meta.mimetype === "application/pdf";
  await whenPdfjsReady();
  if (!fileDataUrl || !isPdf || !window.__pdfjs) return false;
  try {
    pdfViewer.doc = await window.__pdfjs.getDocument({ data: dataURLtoUint8(fileDataUrl) }).promise;
    pdfViewer.pageCount = pdfViewer.doc.numPages;
    pdfViewer.currentPage = 1;
    pdfViewer.ready = true;
    return true;
  } catch (e) {
    console.warn("PDF load failed:", e);
    return false;
  }
}

function isCanvasBlank(canvas) {
  if (!canvas?.width || !canvas?.height) return true;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const sample = ctx.getImageData(0, 0, Math.min(canvas.width, 48), Math.min(canvas.height, 48)).data;
    for (let i = 0; i < sample.length; i += 4) {
      if (sample[i + 3] > 0 && (sample[i] < 250 || sample[i + 1] < 250 || sample[i + 2] < 250)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function renderPdfPage(pageNum, canvas, frame, fallback, filenameEl) {
  if (!pdfViewer.ready || !pdfViewer.doc) {
    canvas.style.display = "none";
    fallback.style.display = "flex";
    if (filenameEl) filenameEl.textContent = meta.filename || "your resume";
    frame.classList.remove("tint");
    return false;
  }
  try {
    const prev = pdfRenderTasks.get(canvas);
    if (prev) {
      try {
        prev.cancel();
      } catch (_) {}
      pdfRenderTasks.delete(canvas);
    }

    const page = await pdfViewer.doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: pdfViewer.scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = "block";
    fallback.style.display = "none";

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas 2D context");

    const task = page.render({ canvasContext: ctx, viewport });
    pdfRenderTasks.set(canvas, task);
    await task.promise;
    pdfRenderTasks.delete(canvas);

    frame.classList.add("tint");
    return true;
  } catch (e) {
    if (e?.name !== "RenderingCancelledException") {
      console.warn("PDF page render failed:", e);
    }
    pdfRenderTasks.delete(canvas);
    canvas.style.display = "none";
    fallback.style.display = "flex";
    frame.classList.remove("tint");
    return false;
  }
}

function promoteScanCanvasToResults() {
  const scanCanvas = document.getElementById("doc-canvas");
  const wrap = document.querySelector("#doc-frame-results .doc-preview-wrap");
  const resultsCanvas = document.getElementById("doc-canvas-results");
  const fallback = document.getElementById("doc-fallback-results");
  const frame = document.getElementById("doc-frame-results");

  if (!scanCanvas || !wrap || !scanCanvas.width || scanCanvas.style.display === "none") return false;
  if (isCanvasBlank(scanCanvas)) return false;

  if (resultsCanvas && resultsCanvas !== scanCanvas) resultsCanvas.remove();

  scanCanvas.id = "doc-canvas-results";
  wrap.insertBefore(scanCanvas, wrap.firstChild);

  fallback.style.display = "none";
  frame.classList.add("tint");
  return true;
}

function bindPdfPager(cfg) {
  const {
    pager,
    prev,
    next,
    label,
    ghost,
    note,
    canvas,
    frame,
    fallback,
    filenameEl,
    onAfterRender,
  } = cfg;

  const syncUi = async () => {
    const multi = pdfViewer.pageCount > 1;
    pager.hidden = !multi;
    if (note) note.hidden = !multi;
    label.textContent = `Page ${pdfViewer.currentPage} of ${pdfViewer.pageCount}`;
    prev.disabled = pdfViewer.currentPage <= 1;
    next.disabled = pdfViewer.currentPage >= pdfViewer.pageCount;
    ghost.classList.toggle("visible", multi && pdfViewer.currentPage < pdfViewer.pageCount);
    if (onAfterRender) onAfterRender();
  };

  const sync = async () => {
    await renderPdfPage(pdfViewer.currentPage, canvas, frame, fallback, filenameEl);
    await syncUi();
  };

  prev.onclick = () => {
    if (pdfViewer.currentPage > 1) {
      pdfViewer.currentPage--;
      sync();
    }
  };
  next.onclick = () => {
    if (pdfViewer.currentPage < pdfViewer.pageCount) {
      pdfViewer.currentPage++;
      sync();
    }
  };
  const goToPage = (pageNum) => {
    const p = Math.max(1, Math.min(pageNum, pdfViewer.pageCount || 1));
    if (p === pdfViewer.currentPage) return syncUi();
    pdfViewer.currentPage = p;
    return sync();
  };
  sync.goToPage = goToPage;
  sync.syncUi = syncUi;
  return sync;
}

async function initDocPreview() {
  const loaded = await loadPdfDocument();
  if (!loaded) {
    document.getElementById("doc-canvas").style.display = "none";
    document.getElementById("doc-fallback").style.display = "block";
    document.getElementById("doc-fallback-name").textContent = meta.filename || "your resume";
    document.getElementById("doc-frame").classList.remove("tint");
    return false;
  }
  if (pdfViewer.pageCount > 1) {
    const n = pdfViewer.pageCount;
    const pages =
      n > 2 ? `all ${n} pages` : n === 2 ? "both pages" : `${n} pages`;
    document.getElementById("scan-sub").textContent =
      `Reading ${pages} line by line, the way a recruiter would.`;
  }
  const sync = bindPdfPager({
    pager: document.getElementById("scan-pager"),
    prev: document.getElementById("scan-prev"),
    next: document.getElementById("scan-next"),
    label: document.getElementById("scan-page-label"),
    ghost: document.getElementById("scan-stack-ghost"),
    note: document.getElementById("scan-multipage-note"),
    canvas: document.getElementById("doc-canvas"),
    frame: document.getElementById("doc-frame"),
    fallback: document.getElementById("doc-fallback"),
    filenameEl: document.getElementById("doc-fallback-name"),
  });
  await sync();
  return true;
}

async function initResultsDocPreview() {
  if (!pdfViewer.ready) {
    await loadPdfDocument();
  }
  if (!pdfViewer.ready) {
    document.getElementById("doc-canvas-results").style.display = "none";
    document.getElementById("doc-fallback-results").style.display = "flex";
    document.getElementById("doc-fallback-name-results").textContent = meta.filename || "your resume";
    return;
  }

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const promoted = promoteScanCanvasToResults();
  const canvas = document.getElementById("doc-canvas-results");

  resultsPdfSync = bindPdfPager({
    pager: document.getElementById("results-pager"),
    prev: document.getElementById("results-prev"),
    next: document.getElementById("results-next"),
    label: document.getElementById("results-page-label"),
    ghost: document.getElementById("results-stack-ghost"),
    note: document.getElementById("results-multipage-note"),
    canvas,
    frame: document.getElementById("doc-frame-results"),
    fallback: document.getElementById("doc-fallback-results"),
    filenameEl: document.getElementById("doc-fallback-name-results"),
  });

  if (promoted && pdfViewer.currentPage === 1) {
    await resultsPdfSync.syncUi();
  } else {
    await resultsPdfSync();
  }

  if (canvas && isCanvasBlank(canvas)) {
    await resultsPdfSync();
  }
}

/* ── Analysis: always live via /api/roast (no mock fallback) ── */
async function analyze() {
  if (!fileDataUrl) {
    throw new Error("Resume file was lost. Go back and upload again.");
  }
  const blob = await (await fetch(fileDataUrl)).blob();
  const fd = new FormData();
  fd.append("resume", blob, meta.filename || "resume.pdf");
  const headers = window.COMMUNITY_GATE?.authHeaders?.() || {};
  const res = await fetch("/api/roast", { method: "POST", headers, body: fd });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === "community_required") {
    window.COMMUNITY_GATE?.clearStoredAccess?.();
    throw new Error("Community access required. Go back and enter your member access code.");
  }
  if (!res.ok) {
    throw new Error(data.error || `Analysis failed (HTTP ${res.status}). Is the server running?`);
  }
  if (data.error) throw new Error(data.error);
  if (data.debug && data.debug.parseOk === false) {
    throw new Error("Analysis returned invalid data (parse failed). Restart the server and try again.");
  }
  return normalizeResult(data);
}
function normalizeResult(data) {
  if (data.notResume) {
    return {
      notResume: true,
      score: 0,
      verdict: window.ROAST.verdictForNotResume(),
      found: [],
      evidence: {},
      debug: data.debug || null,
      total: window.ROAST.ISSUES.length,
    };
  }
  const evidence = data.evidence || {};
  const found = window.ROAST.ISSUES.filter((i) => data.foundIds?.includes(i.id)).sort((a, b) =>
    window.ROAST.compareIssues(a, b, evidence)
  );
  if (data.debug) console.log("[roast debug] considered:", data.debug);
  return {
    score: typeof data.score === "number" ? data.score : window.ROAST.scoreFor(found, evidence),
    verdict: window.ROAST.verdictFor(found.length),
    found,
    evidence,
    debug: data.debug || null,
    total: window.ROAST.ISSUES.length,
  };
}

/* ── Scan animation ──
 * Minimum time the scan is shown, so it always feels like real work and never
 * rushes the model. If the model takes longer than this, the scan simply waits
 * for it (the bar eases toward ~90% and holds until the result is in).
 */
const MIN_SCAN_MS = 45000;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shortFilename(name, max = 30) {
  const n = String(name || "resume.pdf");
  return n.length > max ? n.slice(0, max - 1) + "…" : n;
}

function fakeBulletScan() {
  const total = 11 + Math.floor(Math.random() * 10);
  const n = 2 + Math.floor(Math.random() * Math.max(1, total - 1));
  return pick([
    `Reading bullet ${n} of ${total}…`,
    `On bullet ${n} of ${total}… still looking for a number…`,
    `Bullet ${n} of ${total}… no metrics yet…`,
    `Checking bullet ${n} of ${total}…`,
  ]);
}

function fakeVerbScan() {
  const n = 2 + Math.floor(Math.random() * 4);
  return pick([
    `Counting your ${n}${pick(["rd", "th"])} "Managed" in a row…`,
    `Tallying how many bullets start with "Led"…`,
    `Thesaurus check: verb #${n + 2} is still "Led"…`,
    `Action verb audit… yep, another "Managed"…`,
  ]);
}

function fakePageScan() {
  const pages = pdfViewer.pageCount || 1;
  if (pages <= 1) {
    return pick([
      "Margin and spacing scan…",
      "Layout pass…",
      "Checking whitespace and line breaks…",
      "Typography and spacing audit…",
    ]);
  }
  const page = 1 + Math.floor(Math.random() * pages);
  return pick([
    `Measuring empty space on page ${page}…`,
    `Page ${page} whitespace scan… that's a lot of blank…`,
    `Checking page ${page} for orphan lines…`,
    `Layout pass on page ${page}…`,
  ]);
}

/* Each builder returns one line. Order = escalation: playful → dread → verdict. */
const SCAN_STEP_BUILDERS = [
  () => {
    const fn = shortFilename(meta?.filename);
    return pick([
      `Opening "${fn}" and bracing myself…`,
      `Loading "${fn}"… deep breath…`,
      `Cracking open "${fn}"…`,
      `Initializing roast protocol for "${fn}"…`,
    ]);
  },
  () =>
    pick([
      "Decoding whatever Canva export this is…",
      "Extracting text and side-eyeing the margins…",
      "Parsing layout… already nervous…",
      "Reading the PDF… trying to stay professional…",
    ]),
  () => fakeVerbScan(),
  () => fakeBulletScan(),
  () =>
    pick([
      "Still no bullet point metrics…",
      "Still no numbers… anywhere…",
      "Any quantified impact yet… no…",
      "Metrics scan… still coming up empty…",
      "Looking again for %, $, headcount… nothing…",
    ]),
  () => fakePageScan(),
  () =>
    pick([
      'Flagging "synergy" and friends…',
      "Buzzword sweep… oh no…",
      "Scanning for passionate team players…",
      "Core competencies audit… yikes…",
      "Keyword radar… it's picking something up…",
    ]),
  () =>
    pick([
      "Checking if 2019–2021 is a gap or a typo…",
      "Timeline review… hmm…",
      "Date alignment pass… those don't match…",
      "Work history chronology… interesting choices…",
    ]),
  () =>
    pick([
      "Pretending to be a robot that hates your layout…",
      "ATS simulation… robot is confused…",
      "Applicant-tracking torture test…",
      "Can a parser read this… asking for a friend…",
    ]),
  () =>
    pick([
      "Reading your 47-skill keyword dump…",
      "Skills section… that's a lot of adjectives…",
      "Core skills review… none of these are skills…",
      "Competencies block… very comprehensive, very useless…",
    ]),
  () =>
    pick([
      "Wondering why the dates don't line up…",
      "Formatting consistency check… they don't…",
      "Font and spacing audit… choices were made…",
      "Margin police… you're getting a ticket…",
    ]),
  () =>
    pick([
      'Separating wins from "responsible for…"',
      "Achievements vs duties… mostly duties…",
      "Impact grading… impact not found…",
      "Bullet quality pass… these are tasks, not wins…",
    ]),
  () =>
    pick([
      "Double-checking we weren't too nice…",
      "Second-pass review… yeah, still bad…",
      "Skepticism pass… confirming the damage…",
      "Re-reading for false hope… nope…",
    ]),
  () =>
    pick([
      "Writing the part that's gonna hurt…",
      "Compiling the verdict… this won't be pretty…",
      "Calculating your score… lower than you'd like…",
      "Preparing your roast… almost sorry…",
      "Finalizing the autopsy…",
    ]),
];

function buildScanSteps() {
  return SCAN_STEP_BUILDERS.map((fn) => fn());
}

function startScan() {
  const SCAN_STEPS = buildScanSteps();
  const list = document.getElementById("checklist");
  const fill = document.getElementById("scan-fill");
  fill.style.transition = "none"; // we drive width per-frame, so no CSS easing
  list.innerHTML = "";
  const nodes = SCAN_STEPS.map((label) => {
    const li = document.createElement("li");
    li.className = "check";
    li.innerHTML = `<span class="dot"></span><span>${label}</span>`;
    list.appendChild(li);
    return li;
  });

  const markDone = (node) => {
    if (node && !node.classList.contains("on")) {
      node.classList.add("on", "ok");
      node.querySelector(".dot").textContent = "✓";
    }
  };

  const start = performance.now();
  let raf = 0;
  let running = true;
  // Hold the final step ("Compiling the verdict…") until finish() so it lands on reveal.
  const scheduled = SCAN_STEPS.length - 1;

  const frame = (now) => {
    const t = now - start;
    // Smooth, ever-slowing creep toward ~90% (asymptote; never reaches 100 on its own).
    const pct = 90 * (1 - Math.exp(-t / (MIN_SCAN_MS * 0.42)));
    fill.style.width = pct.toFixed(2) + "%";
    // Tick checks proportionally across ~92% of the minimum runtime.
    const on = Math.floor(Math.min(t / (MIN_SCAN_MS * 0.92), 1) * scheduled);
    for (let i = 0; i < on; i++) markDone(nodes[i]);
    if (running) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    finish() {
      running = false;
      cancelAnimationFrame(raf);
      nodes.forEach(markDone);
      return new Promise((resolve) => {
        const from = parseFloat(fill.style.width) || 90;
        const t0 = performance.now();
        const fin = (now) => {
          const p = Math.min((now - t0) / 550, 1);
          fill.style.width = (from + (100 - from) * p).toFixed(2) + "%";
          if (p < 1) requestAnimationFrame(fin);
          else resolve();
        };
        requestAnimationFrame(fin);
      });
    },
  };
}

function companyFromPromotionEvidence(evidence) {
  const e = String(evidence || "").trim();
  if (!e) return "Company Name";
  const beforeYears = e.split(/\d+\s*years?/i)[0].trim();
  const company = (beforeYears || e).split(",")[0].trim();
  return company || "Company Name";
}

function promotionLadderHtml(evidence, esc) {
  const company = esc(companyFromPromotionEvidence(evidence));
  return `
    <div class="promo-ladder">
      <div class="promo-ladder-label">Show promotions like this:</div>
      <div class="promo-ladder-company">${company}</div>
      <div class="promo-ladder-rung"><span class="promo-ladder-title">Project Manager</span><span class="promo-ladder-dates">2022 – Present</span></div>
      <div class="promo-ladder-rung"><span class="promo-ladder-title">Lead PM</span><span class="promo-ladder-dates">2020 – 2022</span></div>
      <div class="promo-ladder-rung"><span class="promo-ladder-title">Manager</span><span class="promo-ladder-dates">2018 – 2020</span></div>
    </div>`;
}

/* ── Reveal ── */
async function reveal(result) {
  const { score, verdict, found, total } = result;

  document.getElementById("scan-phase").style.display = "none";
  document.getElementById("results-phase").classList.add("show");

  await initResultsDocPreview();

  const clean = window.ROAST.stripEmDash;
  document.getElementById("banner-title").textContent = clean(verdict.title);

  if (result.notResume) {
    document.getElementById("found-count").textContent = "0";
    document.getElementById("banner-sub").innerHTML = clean(
      verdict.tone || "Upload a real resume if you want the autopsy."
    );
    document.getElementById("issues-count").textContent = "0";
    document.getElementById("score-val").textContent = "0";
    document.getElementById("score-ring").style.setProperty("--pct", 0);
    document.getElementById("issues").innerHTML = "";
    document.querySelector(".issues-head").style.display = "none";
    document.querySelector(".issues-sub").style.display = "none";
    document.getElementById("queue-pos").textContent = "#" + (11 + Math.floor(Math.random() * 8));
    return;
  }

  document.querySelector(".issues-head").style.display = "";
  document.querySelector(".issues-sub").style.display = "";
  document.getElementById("found-count").textContent = found.length;
  document.getElementById("banner-sub").innerHTML =
    clean(
      `Your video roast from Wilson is on the way.<br />` +
        `While you wait, we found {C} errors. ${verdict.tone}`
    ).replace("{C}", `<b>${found.length}</b>`);
  document.getElementById("issues-count").textContent = found.length;
  document.getElementById("queue-pos").textContent = "#" + (11 + Math.floor(Math.random() * 8));

  const ring = document.getElementById("score-ring");
  const valEl = document.getElementById("score-val");
  const start = performance.now();
  const dur = 900;
  (function anim(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    valEl.textContent = Math.round(score * eased);
    ring.style.setProperty("--pct", score * eased);
    if (p < 1) requestAnimationFrame(anim);
  })(start);

  const evidence = result.evidence || {};
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const wrap = document.getElementById("issues");
  wrap.innerHTML = "";
  found.forEach((issue, idx) => {
    const line = window.ROAST.renderRoast(issue, evidence[issue.id]);
    const ladder =
      issue.id === "promotions" ? promotionLadderHtml(evidence[issue.id], esc) : "";
    const el = document.createElement("div");
    el.className = "issue";
    el.style.animationDelay = idx * 55 + "ms";
    el.innerHTML = `
      <span class="ico">${window.ROAST.SEV_ICON[issue.severity]}</span>
      <div class="body"><h4>${esc(clean(issue.title))}</h4><p>${esc(line)}</p>${ladder}</div>
      <span class="sev ${issue.severity}">${issue.severity}</span>`;
    wrap.appendChild(el);
  });

  if (result.debug && (new URLSearchParams(location.search).has("debug") || found.length === 0)) {
    renderDebugPanel(result.debug, esc);
  }
}

/* Debug panel (add ?debug=1 to the URL). Shows what the model actually returned:
   every issue it weighed, its confidence, its evidence, and whether it passed. */
function formatApiDebug(api) {
  if (!api) return "";
  if (api.pass1 && api.pass2) {
    const p1 = `${(api.pass1.apiMs / 1000).toFixed(1)}s / ${api.pass1.inputTokens || "?"} in`;
    const p2 = `${(api.pass2.apiMs / 1000).toFixed(1)}s / ${api.pass2.inputTokens || "?"} in`;
    return ` · Pass1 ${p1} · Pass2 ${p2}`;
  }
  return ` · API ${(api.apiMs / 1000).toFixed(1)}s · ${api.inputTokens || "?"} in / ${api.outputTokens || "?"} out tokens`;
}

function renderDebugPanel(debug, esc) {
  const titleFor = (id) => (window.ROAST.ISSUES.find((i) => i.id === id) || {}).title || id;
  const rows = (debug.considered || [])
    .map((c) => {
      const passed = c.found && c.confidence >= debug.threshold;
      const nearMiss = c.found && !passed;
      const color = passed ? "#16b364" : nearMiss ? "#ffb020" : "#666";
      return `<tr style="border-top:1px solid #222">
        <td style="padding:6px 8px;color:${color};font-weight:700">${passed ? "SHOWN" : c.found ? "near-miss" : "no"}</td>
        <td style="padding:6px 8px;color:${color}">${c.confidence.toFixed(2)}</td>
        <td style="padding:6px 8px">${esc(titleFor(c.id))}</td>
        <td style="padding:6px 8px;color:#9a9a9a">${esc(c.evidence || "")}</td>
      </tr>`;
    })
    .join("");
  const rejectedRows = (debug.rejected || [])
    .map(
      (r) => `<tr style="border-top:1px solid #222">
        <td style="padding:6px 8px;color:#ff6b6b;font-weight:700">REJECTED</td>
        <td style="padding:6px 8px;color:#666">—</td>
        <td style="padding:6px 8px">${esc(titleFor(r.id))}</td>
        <td style="padding:6px 8px;color:#9a9a9a">${esc(r.reason || "")} · was: ${esc(r.pass1Evidence || "")}</td>
      </tr>`
    )
    .join("");
  const panel = document.createElement("div");
  panel.style.cssText =
    "max-width:1120px;margin:0 auto;padding:0 24px 40px;font-size:13px;color:#ccc";
  panel.innerHTML = `
    <div style="border:1px solid #333;border-radius:10px;overflow:hidden">
      <div style="background:#1a1a1a;padding:10px 12px;font-weight:800">
        DEBUG · threshold ${debug.threshold} · parseOk=${debug.parseOk} · code flags: ${debug.codeFlags.join(", ") || "none"}
        ${formatApiDebug(debug.api)}
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#141414;text-align:left">
          <th style="padding:6px 8px">status</th><th style="padding:6px 8px">conf</th>
          <th style="padding:6px 8px">issue</th><th style="padding:6px 8px">evidence</th>
        </tr>
        ${rows}
        ${rejectedRows}
      </table>
    </div>`;
  document.getElementById("results-phase").insertBefore(
    panel,
    document.querySelector(".results-bottom")
  );
}

function showError(message) {
  document.getElementById("scan-phase").innerHTML = `
    <div style="max-width:520px;margin:80px auto;padding:0 24px;text-align:center">
      <div style="font-size:22px;font-weight:800;margin-bottom:12px;color:#ff6b6b">Analysis failed</div>
      <div style="color:#b9b9b9;line-height:1.5;margin-bottom:24px">${message.replace(/[<>&]/g, (c) =>
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])
      )}</div>
      <button class="btn-primary" onclick="window.location.href='index.html'">← Try again</button>
    </div>`;
}

/* ── Orchestrate ── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function run() {
  if (!meta) return;

  try {
    const status = await window.COMMUNITY_GATE?.fetchGateStatus?.();
    if (status?.gateEnabled && !window.COMMUNITY_GATE?.hasCommunityAccess?.()) {
      window.location.href = "index.html";
      return;
    }
  } catch (_) {}

  await initDocPreview();

  const started = performance.now();
  const scan = startScan();

  let result;
  try {
    result = await analyze();
  } catch (e) {
    console.error("Roast failed:", e);
    showError(e.message || "Something went wrong. Check the server terminal for details.");
    return;
  }

  const elapsed = performance.now() - started;
  if (elapsed < MIN_SCAN_MS) await sleep(MIN_SCAN_MS - elapsed);

  await scan.finish();
  await reveal(result);
})();
