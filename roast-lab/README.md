# Roast Lab

A self-contained prototype of the core flow: **ROAST button → capture modal → dedicated results page (scan → verdict)**. Built so you can iterate on the experience in seconds without touching the real site or publishing anything.

## Flow

1. **Landing** (`index.html`) — hero + ROAST button.
2. **Capture modal** — first name, email, resume upload. Copy nudges **PDF (recommended)**.
3. **Results page** (`results.html`) — a real page (not a modal, so it can't be accidentally closed):
   - A **scanning phase**: your actual PDF renders with a laser sweep while a recruiter-style checklist ticks off (~7s of "proof of work").
   - A **verdict**: banner headline ("Your resume sucks. Your video roast is on the way…"), a score ring, your **PDF in the center with the list of issues beside it**.
   - A **bottom section**: your queue position + the sales pitch (done-for-you vs. free community).

## Files

- `index.html` — landing + capture modal
- `results.html` — scan + verdict page
- `styles.css` — all styling (shared by both pages — edit here)
- `roast-engine.js` — the 25-issue taxonomy + scoring + mock analyzer (shared by browser and server)
- `app.js` — landing controller (capture → hand off via `sessionStorage`)
- `results.js` — results controller (render PDF, scan animation, analysis, reveal)
- `server.js` — **optional** local server for a real vision model (Anthropic)
- `.env.example` — copy to `.env` to hold your key (gitignored)

## Two ways to run

### 1. Mock mode — fastest loop, no backend, no key

Just open the file:

```
open roast-lab/index.html
```

Everything runs in the browser. Leave the engine dropdown on **Mock**. Edit files, refresh, done.

> `file://` can't call `/api/roast`, so live mode needs the server below.

### 2. Live mode — real Claude vision, locally

```
cd roast-lab
npm install
cp .env.example .env        # then paste your key into .env
node server.js
# open http://localhost:5055  and choose "Live" in the dropdown
```

**Where the localhost is:** the server runs at **http://localhost:5055**. (Mock mode has no server — it's just the `file://` page.)

Without a key the server still runs and returns the mock result, so nothing breaks. With a key, PDFs go to Claude and it returns issue ids from the fixed taxonomy.

## Where do I put my Anthropic key?

Create `roast-lab/.env` (already gitignored) and add:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Don't paste it into chat, and don't commit it. The default model is the flagship **`claude-opus-4-8`** (fully vision-capable). If your key can't access it, set `ROAST_MODEL=` in `.env` to a model you can (e.g. `claude-opus-4-5` or `claude-sonnet-4-6`).

---

## Vision model notes

- **PDF only, by design.** DOCX→PDF conversion (headless LibreOffice) rarely matches what the user saw on screen, so we recommend PDF in the UI and skip DOCX on the model path (it falls back to mock). If a DOCX comes in live, the server returns a mock result.
- **A resume is a page image.** Claude reads the PDF directly (`document` block, base64) — no image conversion needed. It's constrained to return only ids from our 25-issue list, so your copy and scoring stay under your control.
- **Limitations:** not fully deterministic (±1–2 issues; mitigated with a fixed checklist + strict JSON), can't fact-check claims, ~2–6s and a fraction of a cent per resume, and it's PII leaving your system (you already anonymize for the public roast — consider stripping contact info before the call too).

## Still open (once the model is wired up)

1. Review/tweak the 25 issues + roast one-liners in `roast-engine.js` to your voice.
2. Confirm the verdict thresholds (12+ = Certified Disaster, 8+ = Really Bad, 5+ = Bad).
3. Decide how mean is too mean.

Highlighting specific issues directly on the resume (hover a red mark → highlight the comment) is intentionally **out of scope for now** — noted as a later optimization once the core loop proves out.
