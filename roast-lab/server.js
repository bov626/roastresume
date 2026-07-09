/*
 * Optional local server for Roast Lab.
 *
 *   Run this server with an ANTHROPIC_API_KEY in .env, then open http://localhost:5055
 *
 * Where to put your key (pick one, do NOT paste it in chat or commit it):
 *   1. Create roast-lab/.env  with:   ANTHROPIC_API_KEY=sk-ant-...
 *   2. Or inline:  ANTHROPIC_API_KEY=sk-ant-... node server.js
 *
 * Run:
 *   cd roast-lab && npm install && node server.js
 *   open http://localhost:5055
 *
 * Claude is told to return ONLY issue ids from the fixed taxonomy in roast-engine.js,
 * so the frontend renders the same roast copy and scoring every time.
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const {
  ISSUES,
  scoreFor,
  compareIssues,
  crispPageTarget,
  normalizeCrispPageEvidence,
  verdictForNotResume,
} = require("./roast-engine.js");
const {
  isGateEnabled,
  verifyToken,
  verifyAccessCode,
  gateStatus,
} = require("./community-gate.js");

/* ── minimal .env loader (no dependency) ── */
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) {
    console.warn(".env load skipped:", e.message);
  }
})();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const PORT = process.env.PORT || 5055;
// Flagship vision model by default. Override with ROAST_MODEL in .env if this
// snapshot isn't available on your account (e.g. claude-opus-4-5, claude-sonnet-4-6).
const MODEL = process.env.ROAST_MODEL || "claude-opus-4-8";

app.use(express.static(__dirname));

// Only flag an issue when the model is at least this confident.
const CONFIDENCE_MIN = Number(process.env.CONFIDENCE_MIN || 0.5);
const EVIDENCE_MAX = 420;
const REVIEW_ENABLED = process.env.ROAST_REVIEW !== "0";
const VALID_IDS = new Set(ISSUES.map((i) => i.id));
const ISSUE_BY_ID = Object.fromEntries(ISSUES.map((i) => [i.id, i]));

// The model only judges "vision" issues. Mechanical ones (source: "code") are
// detected deterministically below, so we don't waste the model on them.
const VISION_ISSUES = ISSUES.filter((i) => i.source !== "code");
const TAXONOMY_TEXT = VISION_ISSUES.map((i) => {
  const hint = i.evidenceHint ? ` [evidence must be: ${i.evidenceHint}]` : "";
  return `- ${i.id} (${i.severity}) — ${i.title}: ${i.definition}${hint}`;
}).join("\n");

const VALID_ID_LIST = [...VALID_IDS];

/* Forced tool output — guarantees valid JSON (free-form JSON breaks on quotes in evidence). */
const REPORT_TOOL = {
  name: "report_resume_issues",
  description: "Report every resume problem found after reading the PDF. Only include real issues.",
  input_schema: {
    type: "object",
    properties: {
      is_resume: {
        type: "boolean",
        description:
          "true if this PDF is a resume/CV. false if it is clearly not a resume (menu, invoice, homework, blank page, random document).",
      },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: VALID_ID_LIST, description: "Issue id from the checklist" },
            evidence: {
              type: "string",
              description:
                "Short quote or observation, max 420 chars. For id weak_verbs: ONE verb word only (e.g. Led), never a bullet.",
            },
            confidence: { type: "number", description: "0.0 to 1.0" },
          },
          required: ["id", "evidence", "confidence"],
        },
      },
    },
    required: ["is_resume", "issues"],
  },
};

/* Pass 2 — reviewer confirms/rejects each Pass-1 flag with sharper evidence. */
const REVIEW_TOOL = {
  name: "review_resume_issues",
  description:
    "Review each flagged issue after re-reading the PDF. Confirm only issues you can prove. Reject false positives.",
  input_schema: {
    type: "object",
    properties: {
      reviews: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: VALID_ID_LIST, description: "Issue id from Pass 1" },
            verdict: { type: "string", enum: ["confirm", "reject"] },
            evidence: {
              type: "string",
              description:
                "Required if confirm: specific page number, quote, role name, or count. Max 420 chars.",
            },
            reason: { type: "string", description: "Brief reason if reject" },
          },
          required: ["id", "verdict"],
        },
      },
    },
    required: ["reviews"],
  },
};

function buildDetectPrompt(filename) {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `You are a brutally honest resume reviewer for a roast service. You are given a candidate's resume as a PDF (filename: "${filename}").

Today's date: ${today}. Treat any month/year on or before today as past or present, not future.

If the PDF is clearly NOT a resume/CV (menu, invoice, homework, blank page, cover letter only, random document), set is_resume to false and return an empty issues array. Do NOT run the checklist.

Your job is to FIND real problems, not give the benefit of the doubt. Most resumes have 8-15 issues from this list. Read the ENTIRE PDF, every page, top to bottom: header/contact, summary, section order, every job, bullets, skills, education, projects.

Checklist (id (severity) — title: detection rule):
${TAXONOMY_TEXT}

Rules:
- Read the PDF carefully before judging. Quote exact text or name the section you saw.
- Include ONLY issues that genuinely apply. Do not invent problems.
- For each issue, provide SPECIFIC actionable evidence (max 420 chars): page numbers, exact quotes, role names, counts. Never vague.
- no_metrics: judge impact semantically, not by whether a number exists. Input scale (12M hosts, 200GB processed) or vague 'optimized/improved' without a quantified result is NOT impact. Each role needs at least one tangible bullet; flag roles where 25%+ of bullets are weak or none show real outcomes. Evidence: verbatim weak bullet text.
- too_long: flag 3+ pages always. Flag 2 pages only if candidate has under 10 years experience. Evidence must state page count.
- typos evidence must quote the exact error you see. Do not guess.
- date_gaps: flag ONLY missing, vague, or contradictory dates on roles. Do NOT flag employment gaps between jobs. Do NOT call past or current months future-dated.
- multi_column: ONLY for true side-by-side columns or sidebars. Right-aligned dates on one column is fine.
- overlapping_experience: flag when two Work Experience roles have overlapping date ranges (more than one month). Name both roles.
- skill_dump: flag a flat ungrouped comma list OR more than 4 skill subcategories. Up to 4 labeled sections (Tools, AI, PM, etc.) is fine.
- irrelevant_certs: ONLY off-target items in Certifications / Training Courses / Professional Development. Quote exact cert or course name. Never flag For Fun, hobbies, skills, or jobs.
- bad_summary: check Summary, Profile, About, OR Objective. Flag if longer than 2 sentences, keyword soup, or generic seeking-language. Quote opening words.
- no_summary: flag ONLY when there is no Summary, Profile, About, Overview, Objective, or intro paragraph before Experience or Skills. Do NOT flag headerless taglines (e.g. "QA Lead (10+ Yrs) specializing in…") or any summary-like section at the top.
- keyword_spam: check section ORDER. Flag Skills / Technical Skills / Core Competencies that appear BEFORE Work Experience or Professional Experience.
- unnecessary_projects: flag Projects section when the candidate has 3+ years of paid experience or internships (not recent grads).
- volunteer_on_resume: flag Volunteering / Volunteer Work / Community Service when they also have paid jobs or internships. It belongs on LinkedIn, not the resume.
- publications_on_resume: flag Publications / Research / Selected Papers when candidate also has paid jobs. Always flag; Pass 2 may reject academia targets.
- first_person: flag 2+ experience bullets starting with I, I'm, My, We, or Our.
- passive_voice: flag 2+ passive bullets (Was responsible for, Duties included). Do not flag Was promoted.
- present_tense_past_roles: flag 2+ present-tense bullet openers (Manage, Lead) on roles that already ended. Present/Current roles are fine.
- unprofessional_email: flag joke local-parts, legacy domains (hotmail, aol, yahoo), or mostly-number emails.
- too_many_bullets: count bullets per job title block (per promotion sub-role), not per whole company. Flag any single sub-role with more than 5 bullets.
- promotions: flag when one company block spans 3+ years but shows only one job title line. Multiple title lines with separate dates under one company is correct.
- no_exp_context: flag roles that jump straight into bullets with no line explaining the company, team, product, or project. Name the role or company in evidence.
- thin_education: split Education into separate degrees/programmes. Flag when any degree uses fewer than 2 lines and lacks GPA, honors, coursework, or thesis detail. Multiple one-liner degrees always flag.
- Do NOT flag bold_bullet_overuse, overlapping_experience, promotions, stale_experience, full_url_links, too_long, unprofessional_email, first_person, passive_voice, or present_tense_past_roles if code already caught them unless you see something code missed.
- For each issue, provide a short evidence quote (max 420 chars). Use straight quotes only, no newlines.
- CRITICAL for weak_verbs: evidence must be exactly ONE word, the verb that is the FIRST WORD of 3+ experience bullets (e.g. Led, Managed, Built). Count bullet openers only. Do NOT count job titles, section headers, skills keywords, or 'Management' in a competencies list. If the verb opens fewer than 3 bullets, do not flag weak_verbs at all.
- confidence is 0.0-1.0 (how sure you are).
- Never use em dashes or en dashes in evidence.
- Call report_resume_issues with is_resume true and every problem you find. If the resume is clean (rare), return an empty issues array.`;
}

/* Claude call with PDF + forced structured tool output. */
async function callClaude(promptText, file, { tools, toolChoice } = {}) {
  const body = {
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: file.buffer.toString("base64"),
            },
          },
        ],
      },
    ],
  };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  return res.json();
}

function logApiUsage(data, ms) {
  const u = data.usage || {};
  const inTok = u.input_tokens ?? "?";
  const outTok = u.output_tokens ?? "?";
  console.log(
    `  Claude ${ms}ms · tokens in=${inTok} out=${outTok} · stop=${data.stop_reason || "?"} · model=${data.model || MODEL}`
  );
  return { apiMs: ms, inputTokens: u.input_tokens, outputTokens: u.output_tokens, stopReason: data.stop_reason, model: data.model || MODEL };
}

function cleanEvidence(id, raw) {
  let e = String(raw || "").trim().replace(/\s+/g, " ");
  if (id === "weak_verbs") {
    // Accept a single verb word only
    const word = e.match(/^([A-Za-z]+)$/);
    if (word) return word[1].charAt(0).toUpperCase() + word[1].slice(1).toLowerCase();
    // Model pasted a bullet or phrase — reject so UI falls back gracefully
    if (e.length > 18 || e.includes(",") || /\s/.test(e)) {
      console.warn(`  weak_verbs: rejected bad evidence "${e.slice(0, 50)}..." (expected one verb word)`);
      return "";
    }
  }
  if (id === "no_metrics" && noMetricsEvidenceIsMetaAnalysis(e)) {
    const quoted = e.match(/["“]([^"”]{12,})["”]/);
    if (quoted) e = quoted[1].trim();
  }
  return e.slice(0, EVIDENCE_MAX);
}

/* Count how many lines look like experience bullets opening with this verb (deterministic guard). */
function countBulletOpeners(text, verb) {
  const target = String(verb || "").trim().toLowerCase();
  if (!target) return 0;
  let count = 0;
  for (const raw of String(text || "").split(/\n+/)) {
    const line = raw.trim();
    if (!line || line.length < 12) continue;
    if (line.includes("|")) continue; // pipe-separated skills rows
    if (/^[A-Z0-9\s&/]{3,}$/.test(line) && line.length < 60) continue; // section headers
    const cleaned = line.replace(/^[\u2022\u25CF\u25E6\-\*\u00B7•·]\s*/, "").trim();
    const first = cleaned.match(/^([A-Za-z]+)/);
    if (first && first[1].toLowerCase() === target) count++;
  }
  return count;
}

async function extractPdfText(buffer) {
  try {
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  } catch (e) {
    console.warn("  pdf text extract failed:", e.message);
    return "";
  }
}

function firstSectionIndex(text, patterns) {
  const lower = String(text || "").toLowerCase();
  let best = -1;
  for (const pat of patterns) {
    const m = lower.match(pat);
    if (m && m.index != null && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

function hasProfessionalExperience(text) {
  const t = String(text || "");
  if (/\b(intern(ship)?|systems engineer|software engineer|developer|analyst|consultant|manager|work experience|professional experience)\b/i.test(t)) {
    return true;
  }
  return /\b(20\d{2}\s*[-–—]\s*(20\d{2}|present|current))\b/i.test(t);
}

function hasThreePlusYearsExperience(text) {
  const t = String(text || "");
  if (/\b([3-9]|\d{2,})\+?\s*years?\s*(of\s+)?(professional\s+)?experience\b/i.test(t)) return true;
  const ranges = [...t.matchAll(/\b(20\d{2})\s*[-–—]\s*(20\d{2}|present|current)\b/gi)];
  let months = 0;
  const now = new Date();
  for (const m of ranges) {
    const y1 = parseInt(m[1], 10);
    const end = /present|current/i.test(m[2]) ? now.getFullYear() : parseInt(m[2], 10);
    if (end >= y1) months += Math.max(0, (end - y1) * 12 + 6);
  }
  return months >= 36;
}

const TOP_INTRO_SECTION_PATTERNS = [
  /(?:^|\n)\s*professional summary\b/im,
  /(?:^|\n)\s*summary\b/im,
  /(?:^|\n)\s*profile\b/im,
  /(?:^|\n)\s*about me\b/im,
  /(?:^|\n)\s*about\b/im,
  /(?:^|\n)\s*overview\b/im,
  /(?:^|\n)\s*career summary\b/im,
  /(?:^|\n)\s*executive summary\b/im,
  /(?:^|\n)\s*personal statement\b/im,
  /(?:^|\n)\s*professional profile\b/im,
  /(?:^|\n)\s*career profile\b/im,
  /(?:^|\n)\s*career overview\b/im,
  /(?:^|\n)\s*objective\b/im,
  /(?:^|\n)\s*qualifications\b/im,
];

const FIRST_CONTENT_SECTION_PATTERNS = [
  /(?:^|\n)\s*technical skills\b/im,
  /(?:^|\n)\s*core competencies\b/im,
  /(?:^|\n)\s*key skills\b/im,
  /(?:^|\n)\s*skills\b/im,
  /(?:^|\n)\s*work experience\b/im,
  /(?:^|\n)\s*professional experience\b/im,
  /(?:^|\n)\s*employment history\b/im,
  /(?:^|\n)\s*experience\b/im,
];

function isContactOrHeaderLine(line) {
  const t = String(line || "").trim();
  if (!t) return true;
  if (/^[\w.+-]+@[\w.-]+\.\w+$/i.test(t)) return true;
  if (/^\+?\d[\d\s().-]{7,}$/.test(t)) return true;
  if (/linkedin|github|http|www\.|\blinkedin\b|\bgithub\b/i.test(t) && t.length < 120) return true;
  if (/^[A-Z][a-zA-Z''.-]+(\s+[A-Z][a-zA-Z''.-]+){0,3}$/.test(t) && t.length < 50) return true;
  if (t.length < 55 && /\b(remote|hybrid|brazil|usa|canada|uk|india|city|state)\b/i.test(t)) return true;
  if (t.length < 40 && /^[A-Z][a-z]+(\s+[A-Z][a-z]+){0,2},?\s*[A-Za-z .]{0,30}$/.test(t)) return true;
  return false;
}

function looksLikeIntroProse(line) {
  const t = String(line || "").trim();
  if (t.length < 30) return false;
  if (
    /^(experience|skills|education|projects|summary|profile|about|work experience|professional experience|employment|certifications)\b/i.test(
      t
    )
  ) {
    return false;
  }
  // Headerless tagline under contact info (e.g. "QA Lead (10+ Yrs) specializing in…")
  if (
    t.length >= 35 &&
    /\b(\d+\+?\s*(?:yrs?|years?)|specializ(?:e|es|ed|ing)|with\s+\d+\+?)\b/i.test(t)
  ) {
    return true;
  }
  if (
    t.length >= 45 &&
    /\b(\d+\+?\s*(?:yrs?|years?)|engineer|developer|manager|designer|analyst|specialist|lead|director|coordinator|consultant|architect|experienced|proven|passionate|skilled|expert|building|leading|focused on|background in|professional with|seeking to)\b/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

function hasIntroProseBeforeSection(textBefore) {
  const lines = String(textBefore || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    if (isContactOrHeaderLine(line)) continue;
    if (looksLikeIntroProse(line)) return true;
  }
  return false;
}

function detectMissingSummary(text) {
  const t = String(text || "");
  if (t.length < 80) return null;

  const introIdx = firstSectionIndex(t, TOP_INTRO_SECTION_PATTERNS);
  const firstContentIdx = firstSectionIndex(t, FIRST_CONTENT_SECTION_PATTERNS);
  if (firstContentIdx < 0) return null;
  if (introIdx >= 0 && introIdx < firstContentIdx) return null;

  const before = t.slice(0, firstContentIdx);
  if (hasIntroProseBeforeSection(before)) return null;

  return {
    id: "no_summary",
    found: true,
    evidence: "Resume opens with Experience or Skills, no summary section",
    confidence: 0.93,
  };
}

function scanIntroBlock(text, label) {
  const match = text.match(
    new RegExp(
      `\\b${label}\\b([\\s\\S]{0,900}?)(?=\\n\\s*(skills|technical skills|work experience|professional experience|experience|education|projects)\\b)`,
      "i"
    )
  );
  if (!match) return null;
  const block = match[1].trim();
  const sentences = block.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length > 2 || block.length > 260) {
    return sentences[0].trim().slice(0, 80);
  }
  if (
    /\b(seeking a challenging|leverage my skills|looking for an opportunity|passionate about|motivated professional)\b/i.test(
      block
    )
  ) {
    return sentences[0]?.trim().slice(0, 80) || block.slice(0, 80);
  }
  return null;
}

function contentChecksFromPdf(pdfText) {
  const text = String(pdfText || "");
  if (text.length < 80) return [];

  const flags = [];

  const missingSummary = detectMissingSummary(text);
  if (missingSummary) flags.push(missingSummary);

  const skillsIdx = firstSectionIndex(text, [
    /(?:^|\n)\s*technical skills\b/im,
    /(?:^|\n)\s*core competencies\b/im,
    /(?:^|\n)\s*key skills\b/im,
    /(?:^|\n)\s*skills\b/im,
  ]);
  const expIdx = firstSectionIndex(text, [
    /(?:^|\n)\s*work experience\b/im,
    /(?:^|\n)\s*professional experience\b/im,
    /(?:^|\n)\s*employment history\b/im,
  ]);
  if (skillsIdx >= 0 && expIdx >= 0 && skillsIdx < expIdx) {
    flags.push({
      id: "keyword_spam",
      found: true,
      evidence: "Skills section before Work Experience",
      confidence: 0.95,
    });
  }

  const summaryEvidence = scanIntroBlock(text, "summary");
  const profileEvidence = scanIntroBlock(text, "profile");
  const objectiveEvidence = scanIntroBlock(text, "objective");
  const aboutEvidence = scanIntroBlock(text, "about");
  const badIntro =
    summaryEvidence || profileEvidence || objectiveEvidence || aboutEvidence;
  if (badIntro) {
    flags.push({
      id: "bad_summary",
      found: true,
      evidence: badIntro,
      confidence: 0.92,
    });
  }

  if (
    /\b(projects|personal projects|selected projects|academic projects)\b/i.test(text) &&
    hasThreePlusYearsExperience(text)
  ) {
    flags.push({
      id: "unnecessary_projects",
      found: true,
      evidence: "Projects section with 3+ years experience",
      confidence: 0.9,
    });
  }

  if (
    /\b(volunteer(?:ing)?(?:\s+work)?|community service|volunteer experience)\b/i.test(text) &&
    hasProfessionalExperience(text)
  ) {
    const vol = text.match(/\b(volunteer(?:ing)?(?:\s+work)?|community service)\b/i);
    flags.push({
      id: "volunteer_on_resume",
      found: true,
      evidence: vol ? vol[0] : "Volunteer section",
      confidence: 0.9,
    });
  }

  if (
    /\b(publications?|selected papers|research papers|peer[- ]reviewed publications?)\b/i.test(text) &&
    hasProfessionalExperience(text)
  ) {
    const pub = text.match(/\b(publications?|selected papers|research papers)\b/i);
    flags.push({
      id: "publications_on_resume",
      found: true,
      evidence: pub ? pub[0] : "Publications section",
      confidence: 0.9,
    });
  }

  const badEmail = detectUnprofessionalEmail(text);
  if (badEmail) flags.push(badEmail);

  if (flags.length) {
    console.log(`  content checks: ${flags.map((f) => f.id).join(", ")}`);
  }
  return flags;
}

const BULLET_OPENER_RE =
  /^(?:[\u2022\u25CF\u25E6\-\*\u00B7•·]\s*)?(led|managed|developed|delivered|designed|collaborated|partnered|promoted|prepared|conducted|executed|identified|earned|redesigned|implemented|built|created|improved|achieved|spearheaded|drove|owned|oversaw|supported|streamlined|established|launched|analyzed|coordinated|facilitated|monitored|reported|trained|mentored|advised|worked|performed|maintained|handled|assisted|contributed|reduced|increased|optimized|migrated|integrated|automated|standardized|devised|negotiated|supervised|directed|orchestrated|championed|revamped|restructured|strengthened|transformed|validated|assessed|mitigated|resolved|enhanced|accelerated|scaled|generated|presented|communicated|aligned|engaged|initiated|introduced|piloted|demonstrated|enabled|influenced|converted|acquired|completed)\b/i;

function isBoldFont(fontName) {
  const f = String(fontName || "").toLowerCase();
  if (/\b(semibold|demibold|medium|regular|light|italic|oblique)\b/.test(f)) return false;
  return /\b(bold|heavy|black)\b/.test(f);
}

const BOLD_LABEL_PREFIX_RE =
  /^(?:[\u2022\u25CF\u25E6\-\*\u00B7•·]\s*)?(key result|tech stack|technical stack|skills?|tools used|technologies)\s*:\s*/i;

function isStructuralBulletLabel(text) {
  return BOLD_LABEL_PREFIX_RE.test(String(text || "").trim());
}

function isBoldHeavyBullet(line) {
  if (!line?.hasBold) return false;
  const text = String(line.text || "").trim();
  const textLen = Math.max(line.textLen || text.length, 1);
  const boldRatio = (line.boldLen || 0) / textLen;
  if (isStructuralBulletLabel(text) && boldRatio < 0.4) return false;
  if (boldRatio < 0.28) return false;
  return true;
}

function isExperienceBulletLine(text) {
  const line = String(text || "").trim();
  if (line.length < 18) return false;
  if (/^(professional summary|summary|experience|education|skills|projects|certifications|references|volunteer)\b/i.test(line)) {
    return false;
  }
  if (/^[\u2022\u25CF\u25E6\-\*\u00B7•·]\s/.test(line)) return true;
  return BULLET_OPENER_RE.test(line);
}

function isRoleHeaderLine(text) {
  const line = String(text || "").trim();
  if (line.length < 8 || line.length > 110) return false;
  if (isExperienceBulletLine(line)) return false;
  if (
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\s*[-–—]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|present|current|\d{4})/i.test(
      line
    )
  ) {
    return true;
  }
  if (
    /\|\s*(manager|analyst|engineer|director|consultant|lead|developer|executive|associate|specialist|coordinator|intern|risk|senior|junior|head|officer|architect|supervisor|advisor)/i.test(
      line
    )
  ) {
    return true;
  }
  if (/\b(manager|analyst|engineer|director|consultant|developer|executive)\s*[-–—|]/i.test(line)) {
    return true;
  }
  return false;
}

function extractRoleLabel(headerLine) {
  const line = String(headerLine || "").trim();
  const pipe = line.split("|")[0].trim();
  return (pipe || line).slice(0, 55);
}

function clusterTextRowsDetailed(items, viewport, bucket = 5, Util) {
  const rows = new Map();
  for (const item of items) {
    const t = String(item.str || "").trim();
    if (!t) continue;

    let left;
    let top;
    let right;
    let bottom;

    if (Util?.transform) {
      const tx = Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(tx[0]) || 10;
      const itemFontSize =
        Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[0]) || fontHeight;
      const width = item.width
        ? (item.width * fontHeight) / itemFontSize
        : Math.hypot(tx[0], tx[1]) * Math.max(t.length * 0.52, 0.5);
      left = tx[4];
      top = tx[5] - fontHeight;
      right = left + width;
      bottom = top + fontHeight;
    } else {
      const fontSize = Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[0]) || 10;
      const pdfX = item.transform[4];
      const pdfY = item.transform[5];
      const itemW = item.width || fontSize * Math.max(t.length * 0.45, 1);
      const [vx0, vy0] = viewport.convertToViewportPoint(pdfX, pdfY);
      const [vx1, vy1] = viewport.convertToViewportPoint(pdfX + itemW, pdfY - fontSize);
      left = Math.min(vx0, vx1);
      top = Math.min(vy0, vy1);
      right = Math.max(vx0, vx1);
      bottom = Math.max(vy0, vy1);
    }

    const key = Math.round((top + bottom) / 2 / bucket) * bucket;
    if (!rows.has(key)) {
      rows.set(key, { parts: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    }
    const row = rows.get(key);
    row.parts.push({ str: t, fontName: item.fontName || "" });
    row.x0 = Math.min(row.x0, left);
    row.y0 = Math.min(row.y0, top);
    row.x1 = Math.max(row.x1, right);
    row.y1 = Math.max(row.y1, bottom);
  }
  return rows;
}

function viewportBboxToNormalized(x0, y0, x1, y1, pageW, pageH) {
  const pad = 2;
  const x = Math.max(0, (x0 - pad) / pageW);
  const y = Math.max(0, (y0 - pad) / pageH);
  const w = Math.min(1 - x, (x1 - x0 + pad * 2) / pageW);
  const h = Math.min(1 - y, (y1 - y0 + pad * 2) / pageH);
  return { x, y, w: Math.max(0.01, w), h: Math.max(0.008, h) };
}

async function extractPdfLinesDetailed(pdfBuffer) {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const rows = clusterTextRowsDetailed(items, viewport, 5, pdfjs.Util);
    for (const row of rows.values()) {
      const text = row.parts.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      let boldLen = 0;
      for (const part of row.parts) {
        if (isBoldFont(part.fontName)) boldLen += part.str.length;
      }
      lines.push({
        text,
        page: p,
        bbox: viewportBboxToNormalized(row.x0, row.y0, row.x1, row.y1, viewport.width, viewport.height),
        hasBold: boldLen >= 3,
        boldLen,
        textLen: text.length,
      });
    }
  }
  return lines;
}

function sliceExperienceLines(lines) {
  const start = lines.findIndex(
    (l) =>
      /^(professional experience|work experience|experience)$/i.test(l.text.trim()) ||
      /\bprofessional experience\b/i.test(l.text)
  );
  if (start < 0) return [];
  const end = lines.findIndex(
    (l, i) =>
      i > start &&
      /^(education|projects|skills|certifications|references|volunteering|volunteer|training)\b/i.test(
        l.text.trim()
      )
  );
  return lines.slice(start + 1, end >= 0 ? end : undefined);
}

function parseRolesWithBullets(expLines) {
  const roles = [];
  let current = { header: "Experience role", bullets: [] };

  for (const line of expLines) {
    if (isRoleHeaderLine(line.text)) {
      if (current.bullets.length) roles.push(current);
      current = { header: line.text, bullets: [] };
      continue;
    }
    if (isExperienceBulletLine(line.text)) current.bullets.push(line);
  }
  if (current.bullets.length) roles.push(current);
  return roles;
}

const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function hasDateRangeInLine(text) {
  return (
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\s*[-–—]/i.test(text) ||
    /\b20\d{2}\s*[-–—]\s*(20\d{2}|present|current)\b/i.test(text)
  );
}

function parseMonthYearToken(monthStr, yearStr) {
  const key = String(monthStr || "")
    .slice(0, 3)
    .toLowerCase();
  const month = MONTH_INDEX[key];
  if (month == null) return null;
  return { year: parseInt(yearStr, 10), month };
}

function parseDateRangeFromHeader(line) {
  const text = String(line || "");
  const monthRange = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\s*[-–—]\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(20\d{2}|present|current)\b/i
  );
  if (monthRange) {
    const start = parseMonthYearToken(monthRange[1], monthRange[2]);
    let end = null;
    if (/present|current/i.test(monthRange[4])) {
      const now = new Date();
      end = { year: now.getFullYear(), month: now.getMonth() };
    } else if (monthRange[3] && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(monthRange[3])) {
      const parts = monthRange[3].trim().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
      if (parts) end = parseMonthYearToken(parts[1], monthRange[4]);
    } else if (monthRange[4]) {
      end = { year: parseInt(monthRange[4], 10), month: 11 };
    }
    if (start && end) return { start, end, label: extractRoleLabel(text) };
  }

  const yearRange = text.match(/\b(20\d{2})\s*[-–—]\s*(20\d{2}|present|current)\b/i);
  if (yearRange) {
    const start = { year: parseInt(yearRange[1], 10), month: 0 };
    let end;
    if (/present|current/i.test(yearRange[2])) {
      const now = new Date();
      end = { year: now.getFullYear(), month: now.getMonth() };
    } else {
      end = { year: parseInt(yearRange[2], 10), month: 11 };
    }
    return { start, end, label: extractRoleLabel(text) };
  }
  return null;
}

function rangeToMonthIndex({ year, month }) {
  return year * 12 + month;
}

function rangesOverlapMonths(a, b) {
  const aStart = rangeToMonthIndex(a.start);
  const aEnd = rangeToMonthIndex(a.end);
  const bStart = rangeToMonthIndex(b.start);
  const bEnd = rangeToMonthIndex(b.end);
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);
  return overlapEnd - overlapStart > 1;
}

function isSlashMultiTitle(text) {
  return /\b(manager|analyst|engineer|director|developer|lead|senior|junior|pm|consultant|specialist)\s*\/\s*/i.test(
    text
  );
}

function isCompanyOnlyLine(text) {
  const t = String(text || "").trim();
  if (t.length < 3 || t.length > 70) return false;
  if (isExperienceBulletLine(t)) return false;
  if (/^(education|skills|projects|certifications)\b/i.test(t)) return false;
  if (hasDateRangeInLine(t)) return false;
  if (isSlashMultiTitle(t)) return false;
  if (isRoleHeaderLine(t) && /\b(manager|analyst|engineer|director|developer|lead)\b/i.test(t)) {
    return false;
  }
  return true;
}

function parseExperienceBlocks(expLines) {
  const blocks = [];
  let current = null;

  for (const line of expLines) {
    const text = line.text.trim();
    if (isRoleHeaderLine(text) && hasDateRangeInLine(text)) {
      if (!current) current = { company: extractRoleLabel(text), subRoles: [] };
      const range = parseDateRangeFromHeader(text);
      current.subRoles.push({
        header: text,
        bullets: [],
        range,
        slashTitle: isSlashMultiTitle(text),
      });
      continue;
    }
    if (isCompanyOnlyLine(text)) {
      if (current?.subRoles?.length) blocks.push(current);
      current = { company: text.replace(/\.$/, "").trim(), subRoles: [] };
      continue;
    }
    if (current?.subRoles?.length) {
      const last = current.subRoles[current.subRoles.length - 1];
      if (isExperienceBulletLine(text)) last.bullets.push(line);
    }
  }
  if (current?.subRoles?.length) blocks.push(current);
  return blocks;
}

function blockTenureMonths(block) {
  const ranges = block.subRoles.map((r) => r.range).filter(Boolean);
  if (!ranges.length) return 0;
  const starts = ranges.map((r) => rangeToMonthIndex(r.start));
  const ends = ranges.map((r) => rangeToMonthIndex(r.end));
  return Math.max(...ends) - Math.min(...starts) + 1;
}

function detectMissingPromotions(expLines) {
  const blocks = parseExperienceBlocks(expLines);
  for (const block of blocks) {
    const titled = block.subRoles.filter((r) => !r.slashTitle);
    if (titled.length !== 1) continue;
    const months = blockTenureMonths(block);
    if (months <= 36) continue;
    const label = block.company || extractRoleLabel(titled[0].header);
    const years = Math.round(months / 12);
    return {
      id: "promotions",
      found: true,
      evidence: `${label}, ${years} years, 1 title`,
      confidence: 0.9,
    };
  }
  return null;
}

function detectOverlappingExperience(expLines) {
  const roles = parseRolesWithBullets(expLines)
    .map((r) => ({ ...r, range: parseDateRangeFromHeader(r.header) }))
    .filter((r) => r.range);

  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      if (rangesOverlapMonths(roles[i].range, roles[j].range)) {
        const a = extractRoleLabel(roles[i].header);
        const b = extractRoleLabel(roles[j].header);
        return {
          id: "overlapping_experience",
          found: true,
          evidence: `${a} overlaps ${b}`,
          confidence: 0.92,
        };
      }
    }
  }
  return null;
}

function detectStaleExperience(expLines) {
  const cutoffYear = new Date().getFullYear() - 15;
  const roles = parseRolesWithBullets(expLines).filter((r) => r.bullets.length > 0);
  for (const role of roles) {
    const range = parseDateRangeFromHeader(role.header);
    if (!range) continue;
    if (/present|current/i.test(role.header)) continue;
    if (range.end.year <= cutoffYear) {
      const label = extractRoleLabel(role.header);
      return {
        id: "stale_experience",
        found: true,
        evidence: `${label}, ended ${range.end.year}`,
        confidence: 0.9,
      };
    }
  }
  return null;
}

function estimateCareerYears(text) {
  const ranges = [...String(text || "").matchAll(/\b(20\d{2})\s*[-–—]\s*(20\d{2}|present|current)\b/gi)];
  if (!ranges.length) return 10;
  const now = new Date().getFullYear();
  let earliest = now;
  let latest = 0;
  for (const m of ranges) {
    earliest = Math.min(earliest, parseInt(m[1], 10));
    const end = /present|current/i.test(m[2]) ? now : parseInt(m[2], 10);
    latest = Math.max(latest, end);
  }
  return Math.max(1, latest - earliest);
}

async function detectTooLong(pdfBuffer, pdfText) {
  try {
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
    const numPages = doc.numPages;
    const years = estimateCareerYears(pdfText);
    if (numPages >= 3) {
      return { id: "too_long", found: true, evidence: `${numPages} pages`, confidence: 0.95 };
    }
    if (numPages === 2 && years < 10) {
      return {
        id: "too_long",
        found: true,
        evidence: `2 pages, ~${years} years experience`,
        confidence: 0.93,
      };
    }
  } catch (e) {
    console.warn("  too_long check failed:", e.message);
  }
  return null;
}

function detectFullUrlLinks(pdfText) {
  const header = String(pdfText || "").slice(0, 2000);
  const patterns = [
    /linkedin\.com\/[^\s,)]+/i,
    /github\.com\/[^\s,)]+/i,
    /(?:portfolio|personal)[^\s]*\.(?:com|io|dev|me)\/[^\s,)]+/i,
  ];
  for (const re of patterns) {
    const m = header.match(re);
    if (m) {
      return {
        id: "full_url_links",
        found: true,
        evidence: m[0].slice(0, 60),
        confidence: 0.94,
      };
    }
  }
  return null;
}

const VOICE_BULLET_MIN = 2;

const UNPROFESSIONAL_EMAIL_LOCAL_RE =
  /\b(beer|party|ninja|gamer|coolguy|cool|love|sexy|dragon|killer|awesome|boss|master|king|queen|devil|angel|rockstar|crazy|wild|hot|dude|bro|lol|haha|pimp|stud|sk8|skater|surfer|princess|baby|babe)\b/i;
const LEGACY_EMAIL_DOMAIN_RE = /@(hotmail|aol|yahoo|live|msn|mail)\.(com|co\.uk|ca|net)\b/i;

const PAST_BULLET_OPENERS = new Set(
  "led managed developed delivered designed collaborated partnered promoted prepared conducted executed identified earned redesigned implemented built created improved achieved spearheaded drove owned oversaw supported streamlined established launched analyzed coordinated facilitated monitored reported trained mentored advised worked performed maintained handled assisted contributed reduced increased optimized migrated integrated automated standardized devised negotiated supervised directed orchestrated championed revamped restructured strengthened transformed validated assessed mitigated resolved enhanced accelerated scaled generated presented communicated aligned engaged initiated introduced piloted demonstrated enabled influenced converted acquired completed"
    .split(" ")
);

const PRESENT_BULLET_OPENERS = new Set(
  "manage lead develop build create design deliver implement support handle coordinate analyze report train mentor work perform maintain assist contribute optimize establish launch spearhead drive own oversee streamline improve achieve collaborate partner prepare conduct execute identify integrate migrate automate standardize devise negotiate supervise direct orchestrate champion revamp restructure strengthen transform validate assess mitigate resolve enhance accelerate scale generate present communicate align engage initiate introduce pilot demonstrate enable influence convert acquire complete"
    .split(" ")
);

function extractHeaderEmail(text) {
  const header = String(text || "").slice(0, 2500);
  const m = header.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  return m ? m[0] : null;
}

function isUnprofessionalEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return false;
  const local = e.slice(0, at);
  const domainFull = e.slice(at + 1);
  if (UNPROFESSIONAL_EMAIL_LOCAL_RE.test(local)) return true;
  if (/\d{5,}/.test(local)) return true;
  if (/^[0-9._+-]+$/.test(local)) return true;
  if (LEGACY_EMAIL_DOMAIN_RE.test("@" + domainFull)) return true;
  if (local.length > 28 && !local.includes(".")) return true;
  if (/^[a-z0-9]{14,}$/.test(local) && !local.includes(".")) return true;
  return false;
}

function detectUnprofessionalEmail(pdfText) {
  const email = extractHeaderEmail(pdfText);
  if (!email || !isUnprofessionalEmail(email)) return null;
  return {
    id: "unprofessional_email",
    found: true,
    evidence: email.slice(0, 80),
    confidence: 0.94,
  };
}

function bulletFirstWord(text) {
  const line = String(text || "").trim();
  const cleaned = line.replace(/^[\u2022\u25CF\u25E6\-\*\u00B7•·]\s*/, "").trim();
  const m = cleaned.match(/^([A-Za-z]+)/);
  return m ? m[1].toLowerCase() : "";
}

function isPresentTenseOpener(text) {
  const w = bulletFirstWord(text);
  if (!w || w.length < 3) return false;
  if (PAST_BULLET_OPENERS.has(w)) return false;
  if (/ed$/.test(w) && w.length > 4) return false;
  return PRESENT_BULLET_OPENERS.has(w);
}

function isFirstPersonBullet(text) {
  const line = String(text || "").trim();
  const cleaned = line.replace(/^[\u2022\u25CF\u25E6\-\*\u00B7•·]\s*/, "").trim();
  return /^(I\b|I'm\b|I am\b|My\b|We\b|Our\b)/i.test(cleaned);
}

function isPassiveVoiceBullet(text) {
  const line = String(text || "").trim();
  const cleaned = line.replace(/^[\u2022\u25CF\u25E6\-\*\u00B7•·]\s*/, "").trim();
  if (/\bwas promoted\b/i.test(cleaned)) return false;
  if (/^(?:was|were)\s+(?:responsible|tasked|involved|assigned|in charge)\b/i.test(cleaned)) {
    return true;
  }
  return /\b(?:duties|responsibilities)\s+included\b/i.test(cleaned);
}

function roleEndedInPast(header) {
  if (/present|current/i.test(String(header || ""))) return false;
  const range = parseDateRangeFromHeader(header);
  if (!range) {
    return /\b20\d{2}\s*[-–—]\s*20\d{2}\b/.test(String(header || ""));
  }
  const now = new Date();
  const endIdx = rangeToMonthIndex(range.end);
  const nowIdx = rangeToMonthIndex({ year: now.getFullYear(), month: now.getMonth() });
  return endIdx < nowIdx;
}

function experienceBulletLines(expLines) {
  return expLines.filter((l) => isExperienceBulletLine(l.text));
}

function detectFirstPersonBullets(expLines) {
  const bullets = experienceBulletLines(expLines).filter((l) => isFirstPersonBullet(l.text));
  if (bullets.length < VOICE_BULLET_MIN) return null;
  return {
    id: "first_person",
    found: true,
    evidence: `${bullets.length} bullets start with I or My`,
    confidence: 0.92,
  };
}

function detectPassiveVoiceBullets(expLines) {
  const bullets = experienceBulletLines(expLines).filter((l) => isPassiveVoiceBullet(l.text));
  if (bullets.length < VOICE_BULLET_MIN) return null;
  const sample = bullets[0].text.replace(/\s+/g, " ").slice(0, 55);
  return {
    id: "passive_voice",
    found: true,
    evidence: `${bullets.length} passive bullets: ${sample}`,
    confidence: 0.91,
  };
}

function detectPresentTensePastRoles(expLines) {
  const roles = parseRolesWithBullets(expLines).filter((r) => r.bullets.length > 0);
  let worst = null;
  for (const role of roles) {
    if (!roleEndedInPast(role.header)) continue;
    const hits = role.bullets.filter((b) => isPresentTenseOpener(b.text));
    if (hits.length >= VOICE_BULLET_MIN && (!worst || hits.length > worst.count)) {
      worst = { role, count: hits.length };
    }
  }
  if (!worst) return null;
  const label = extractRoleLabel(worst.role.header);
  return {
    id: "present_tense_past_roles",
    found: true,
    evidence: `${label}, ${worst.count} present-tense bullets`,
    confidence: 0.9,
  };
}

function hasQuantifiedOutcome(line) {
  if (/\b(increased|decreased|reduced|improved|grew|saved|cut|boosted|raised|lowered|accelerated|shortened|expanded|doubled|tripled|halved)\b[^.]{0,70}\b\d+(\.\d+)?\s*%/i.test(line)) {
    return true;
  }
  if (/\b\d+(\.\d+)?\s*%\s*(increase|decrease|reduction|improvement|growth|savings|uplift|faster|more|less|drop|gain)/i.test(line)) {
    return true;
  }
  if (/\bby\s+\d+(\.\d+)?\s*%/i.test(line)) return true;
  if (/\b(reduced|saved|cut|decreased|lowered|generated|grew|added)\b[^.]{0,55}\$\s?\d/i.test(line)) {
    return true;
  }
  if (
    /\$\s?\d[\d,]*(k|m|b|million|billion)?/i.test(line) &&
    /\b(revenue|sales|savings|cost|budget|profit|arr|mrr|pipeline|funding|raised|margin|spend)\b/i.test(line)
  ) {
    return true;
  }
  if (/\b(saved|reduced|cut|decreased)\b[^.]{0,45}\b\d+\+?\s*(hours|days|weeks|months|minutes|hrs)\b/i.test(line)) {
    return true;
  }
  if (/\b\d+(\.\d+)?\s*%\s*(uptime|accuracy|retention|conversion|adoption|completion|satisfaction|csat|nps)/i.test(line)) {
    return true;
  }
  if (/\b(uptime|accuracy|retention|conversion|adoption|latency|throughput|error rate|churn)\b[^.]{0,35}\b(to|from|by)\s+\d/i.test(line)) {
    return true;
  }
  if (
    /\b\d+\+?\s*(new|active|paying)?\s*(customers|users|clients|deals|leads|signups|subscribers)\b/i.test(line) &&
    /\b(acquired|grew|onboarded|converted|signed|closed|retained|added)\b/i.test(line)
  ) {
    return true;
  }
  if (/\b(top|#|ranked)\s*\d/i.test(line) && /\b(in|among|of)\b/i.test(line)) return true;
  return false;
}

function hasBusinessOutcome(line) {
  return (
    /\b(revenue|profit|sales|churn|retention|conversion|activation|adoption|patient outcomes|cost savings|defect rate|bug rate|downtime|sla|compliance|audit|security incident|breach|fraud|nps|csat)\b/i.test(
      line
    ) &&
    (hasQuantifiedOutcome(line) || /\b(eliminated|prevented|achieved|exceeded|met|surpassed|zero)\b/i.test(line))
  );
}

function hasTangibleDeliverable(line) {
  if (
    /\b(shipped|launched|released|deployed|published|patent|award|granted|certified)\b/i.test(line) &&
    /\b(production|live|customer-facing|public|open.?source|paper|journal|conference)\b/i.test(line)
  ) {
    return true;
  }
  if (/\b(presented|won|selected|featured)\b/i.test(line) && /\b(conference|competition|award|journal|hackathon)\b/i.test(line)) {
    return true;
  }
  return false;
}

function isFakeMetricBullet(line) {
  const hasInputScale =
    /\b\d+(\.\d+)?\s*(million|billion|m\+|k\+|gb|tb|mb|pb|records|rows|hosts|devices|servers|nodes|transactions|events|logs|documents|emails|accounts)\b/i.test(
      line
    );
  if (!hasInputScale || hasQuantifiedOutcome(line) || hasBusinessOutcome(line)) return false;
  return /\b(scan|collect|gather|mine|scrape|crawl|process|analyz|ingest|extract|pull|query|handle|manage|load|parse|monitor|track|developed|built|created|implemented)\b/i.test(
    line
  );
}

function hasUnquantifiedImprovement(line) {
  if (hasQuantifiedOutcome(line)) return false;
  return (
    /\b(optimiz|improv|enhanc|streamlin|efficien|memory usage|execution time|run time|runtime|performance)\b/i.test(line) &&
    !/\b(shipped|launched|released|deployed|published|won|reduced|increased|saved|cut)\b[^.]{0,25}\b\d/i.test(line)
  );
}

function isProcessOnlyBullet(line) {
  if (!/\b(develop|built|created|designed|implemented|wrote|architected|engineered|established|deployed|launched|delivered)\b/i.test(line)) {
    return false;
  }
  if (hasQuantifiedOutcome(line) || hasBusinessOutcome(line) || hasTangibleDeliverable(line)) return false;
  return /\b(to|for)\s+(scan|collect|gather|monitor|track|process|analyze|support|enable|facilitate|manage|maintain|handle|operate|run)\b/i.test(
    line
  );
}

function classifyExperienceBullet(text) {
  const line = String(text || "").trim();
  if (line.length < 25) return "neutral";
  if (hasQuantifiedOutcome(line)) return "impact";
  if (hasBusinessOutcome(line)) return "impact";
  if (hasTangibleDeliverable(line)) return "acceptable";
  if (isFakeMetricBullet(line)) return "weak";
  if (hasUnquantifiedImprovement(line)) return "weak";
  if (isProcessOnlyBullet(line)) return "weak";
  if (
    /\b(responsible for|facilitate[d]?|support(ed|ing)?|assist(ed|ing)?|helped|participat(ed|ing)?|collaborat(ed|ing|e)?|coordinat(ed|ing|e)?|manage[d]?|handled|maintain(ed|ing)?|ensure[d]?|perform(ed|ing)?|contribute[d]?|worked with|worked on|involved in|duties include|tasked with|oversaw operations|provide[d]? support|enabl(e|ing|ed)|partner with|partnered with|monitor(ed|ing)?|operate[d]?|prepare[d]?|process(ed|ing)?|conduct(ed|ing)? meetings|serve[d]? as|act(ed)? as liaison|liaise[d]?)\b/i.test(
      line
    )
  ) {
    return "weak";
  }
  return "neutral";
}

function isDutyStyleBullet(text) {
  return classifyExperienceBullet(text) === "weak";
}

const WEAK_BULLET_RATIO_MAX = 0.25;

function roleFailsImpactBar(role) {
  const total = role.bullets.length;
  if (!total) return false;
  const classes = role.bullets.map((b) => classifyExperienceBullet(b.text));
  const weak = classes.filter((c) => c === "weak").length;
  const good = classes.filter((c) => c === "impact" || c === "acceptable").length;
  if (good === 0) return true;
  return weak / total >= WEAK_BULLET_RATIO_MAX;
}

function detectExperienceImpactGaps(expLines) {
  const roles = parseRolesWithBullets(expLines).filter((r) => r.bullets.length > 0);
  const failing = roles.filter(roleFailsImpactBar);
  if (!failing.length) return null;

  const role = failing[0];
  const weakBullet =
    role.bullets.find((b) => classifyExperienceBullet(b.text) === "weak") || role.bullets[0];
  const label = extractRoleLabel(role.header);
  const quote = weakBullet.text.replace(/\s+/g, " ").slice(0, 100);

  return {
    id: "no_metrics",
    found: true,
    evidence: `${label}: "${quote}"`,
    confidence: 0.91,
  };
}

function detectTooManyBulletsFromLines(expLines) {
  let worst = null;

  const blocks = parseExperienceBlocks(expLines);
  for (const block of blocks) {
    for (const sub of block.subRoles) {
      const count = sub.bullets.length;
      if (count > 5 && (!worst || count > worst.bullets)) {
        worst = { header: sub.header, bullets: count };
      }
    }
  }

  if (!worst) {
    const roles = parseRolesWithBullets(expLines).map((r) => ({
      header: r.header,
      bullets: r.bullets.length,
    }));
    worst = roles.sort((a, b) => b.bullets - a.bullets)[0];
  }

  if (!worst || worst.bullets <= 5) return null;

  return {
    id: "too_many_bullets",
    found: true,
    evidence: `${extractRoleLabel(worst.header)}, ${worst.bullets} bullets`,
    confidence: 0.93,
  };
}

function detectBoldBulletOveruse(expLines) {
  const bullets = expLines.filter(
    (l) => isExperienceBulletLine(l.text) && !isStructuralBulletLabel(l.text)
  );
  if (bullets.length < 3) return null;

  const boldHeavy = bullets.filter((l) => isBoldHeavyBullet(l));
  const ratio = boldHeavy.length / bullets.length;
  if (ratio <= 0.5) return null;

  return {
    id: "bold_bullet_overuse",
    found: true,
    evidence: `${boldHeavy.length} of ${bullets.length} experience bullets use heavy bold`,
    confidence: 0.92,
  };
}

function isContextLine(text) {
  const line = String(text || "").trim();
  if (line.length < 25) return false;
  if (/^tech stack/i.test(line)) return false;
  if (isRoleHeaderLine(line)) return false;
  if (/^\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(line) && line.length < 45) return false;
  if (!isExperienceBulletLine(line)) return true;
  if (
    /\b(company|team|organization|department|division|startup|health system|hospital|enterprise|platform|product|project|client|account|business unit|nonprofit|agency|firm|consulting|government)\b/i.test(
      line
    )
  ) {
    return true;
  }
  return false;
}

function detectMissingExpContext(expLines) {
  const missing = [];
  let roleHeader = null;
  let roleLines = [];

  function flushRole() {
    if (!roleHeader) return;
    const hasBullet = roleLines.some((l) => isExperienceBulletLine(l.text));
    const hasContext = roleLines.some((l) => isContextLine(l.text));
    if (hasBullet && !hasContext) missing.push(extractRoleLabel(roleHeader));
    roleHeader = null;
    roleLines.length = 0;
  }

  for (const line of expLines) {
    if (isRoleHeaderLine(line.text)) {
      flushRole();
      roleHeader = line.text;
      continue;
    }
    if (roleHeader) roleLines.push(line);
  }
  flushRole();

  if (!missing.length) return null;

  const evidence =
    missing.length === 1
      ? missing[0]
      : `${missing.length} roles missing context (${missing[0]}, …)`;

  return {
    id: "no_exp_context",
    found: true,
    evidence: evidence.slice(0, 80),
    confidence: 0.9,
  };
}

async function experienceFormattingChecks(pdfBuffer) {
  try {
    const lines = await extractPdfLinesDetailed(pdfBuffer);
    const expLines = sliceExperienceLines(lines);
    if (!expLines.length) return [];

    const flags = [];
    const tooMany = detectTooManyBulletsFromLines(expLines);
    if (tooMany) flags.push(tooMany);
    const boldOver = detectBoldBulletOveruse(expLines);
    if (boldOver) flags.push(boldOver);
    const noContext = detectMissingExpContext(expLines);
    if (noContext) flags.push(noContext);
    const impactGap = detectExperienceImpactGaps(expLines);
    if (impactGap) flags.push(impactGap);
    const overlap = detectOverlappingExperience(expLines);
    if (overlap) flags.push(overlap);
    const promotions = detectMissingPromotions(expLines);
    if (promotions) flags.push(promotions);
    const stale = detectStaleExperience(expLines);
    if (stale) flags.push(stale);
    const firstPerson = detectFirstPersonBullets(expLines);
    if (firstPerson) flags.push(firstPerson);
    const passive = detectPassiveVoiceBullets(expLines);
    if (passive) flags.push(passive);
    const presentTense = detectPresentTensePastRoles(expLines);
    if (presentTense) flags.push(presentTense);

    if (flags.length) {
      console.log(`  experience formatting: ${flags.map((f) => f.id).join(", ")}`);
    }
    return flags;
  } catch (e) {
    console.warn("  experience formatting checks failed:", e.message);
    return [];
  }
}

const EDU_ENTRY_START_RE =
  /\b(bachelor|master|mba|m\.?b\.?a|ph\.?d|b\.?a\.?|b\.?s\.?|b\.?sc|m\.?s\.?|m\.?sc|m\.?a\.?|associate|doctorate|b\.?eng|m\.?eng|jd|md|dds|dvm|programme|program|certificate|certification|diploma|postgraduate|post-graduate|executive education)\b/i;

function isEducationDegreeLine(text) {
  const t = String(text || "").trim();
  if (t.length < 8) return false;
  if (/^(skills|experience|projects|certifications|areas of)\b/i.test(t)) return false;
  return EDU_ENTRY_START_RE.test(t);
}

function isEducationContinuationLine(text, entry) {
  if (!entry?.lines?.length) return false;
  const t = String(text || "").trim();
  if (/^[\u2022\u25CF\u25E6\-\*\u00B7•·]\s/.test(t)) return true;
  if (/^\(?\d{4}\s*[-–—]/.test(t)) return true;
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}/i.test(t) && t.length < 45) {
    return true;
  }
  const entryHasDegree = entry.lines.some((l) => isEducationDegreeLine(l.text));
  if (
    entryHasDegree &&
    /\b(university|college|school|institute|academy|faculty)\b/i.test(t) &&
    !isEducationDegreeLine(t)
  ) {
    return true;
  }
  return false;
}

function extractEducationEntryLabel(text) {
  const t = String(text || "").trim();
  const chunk = t.split(/\s{2,}|\t|·/)[0].trim();
  return chunk.slice(0, 55);
}

function hasEntryRichDetail(text) {
  const t = String(text || "").trim();
  return /\b(gpa|grade point|coursework|relevant coursework|thesis|dissertation|capstone|concentration|minor in|distinction|valedictorian|provost|phi beta|student body|activities|summa|magna|cum laude|dean'?s list|with honors|honors college|honors program)\b/i.test(
    t
  );
}

function parseEducationEntries(eduLines) {
  const contentLines = eduLines.filter((l) => l.text.replace(/\s+/g, " ").trim().length > 3);
  const entries = [];
  let current = null;

  for (const line of contentLines) {
    const t = line.text.replace(/\s+/g, " ").trim();
    if (/^(areas of expertise|skills|certifications)\b/i.test(t)) break;

    if (isEducationDegreeLine(t)) {
      if (current) entries.push(current);
      current = { lines: [line], label: extractEducationEntryLabel(t) };
      continue;
    }

    if (!current) {
      current = { lines: [line], label: extractEducationEntryLabel(t) };
      continue;
    }

    if (isEducationContinuationLine(t, current)) {
      current.lines.push(line);
    } else {
      entries.push(current);
      current = { lines: [line], label: extractEducationEntryLabel(t) };
    }
  }
  if (current) entries.push(current);
  return entries;
}

function sliceEducationLines(lines) {
  const start = lines.findIndex(
    (l) => /^education$/i.test(l.text.trim()) || (/\beducation\b/i.test(l.text) && l.text.length < 25)
  );
  if (start < 0) return [];
  const end = lines.findIndex(
    (l, i) =>
      i > start &&
      /^(skills|experience|work experience|professional experience|projects|certifications|references|volunteer|volunteering|training|professional summary|areas of expertise)\b/i.test(
        l.text.trim()
      )
  );
  return lines.slice(start + 1, end >= 0 ? end : undefined);
}

function detectThinEducationFromLines(eduLines) {
  const entries = parseEducationEntries(eduLines);
  if (!entries.length) return null;

  const thinEntries = entries.filter((entry) => {
    if (entry.lines.length >= 2) return false;
    const text = entry.lines.map((l) => l.text).join(" ");
    return !hasEntryRichDetail(text);
  });

  if (!thinEntries.length) return null;

  const evidence =
    entries.length === 1
      ? `${thinEntries[0].label} — only 1 line, no GPA, honors, or coursework`
      : `${thinEntries.length} of ${entries.length} degrees are one-liners (${thinEntries[0].label}, …)`;

  return {
    id: "thin_education",
    found: true,
    evidence: evidence.slice(0, 80),
    confidence: 0.93,
  };
}

async function educationFormattingChecks(pdfBuffer) {
  try {
    const lines = await extractPdfLinesDetailed(pdfBuffer);
    const flag = detectThinEducationFromLines(sliceEducationLines(lines));
    if (flag) {
      console.log(`  education formatting: ${flag.id}`);
      return [flag];
    }
    return [];
  } catch (e) {
    console.warn("  education formatting checks failed:", e.message);
    return [];
  }
}

/* Last-page layout (multi-page PDFs only). Hanging lines / half-blank pages almost always land here. */
const CODE_ONLY_IDS = new Set(["bad_filename", "half_blank_page", "orphan_line"]);
const CONTENT_CODE_IDS = new Set([
  "keyword_spam",
  "bad_summary",
  "no_summary",
  "unnecessary_projects",
  "volunteer_on_resume",
  "too_many_bullets",
  "bold_bullet_overuse",
  "thin_education",
  "no_exp_context",
  "no_metrics",
  "overlapping_experience",
  "promotions",
  "stale_experience",
  "full_url_links",
  "too_long",
  "unprofessional_email",
  "publications_on_resume",
  "first_person",
  "passive_voice",
  "present_tense_past_roles",
]);
const SKIP_REVIEW_IDS = new Set([...CODE_ONLY_IDS, ...CONTENT_CODE_IDS]);
const LAST_PAGE_BLANK_MIN = 0.25;
const LAST_PAGE_ORPHAN_BLANK_MIN = 0.25;
const LAST_PAGE_LINE_BUCKET = 8;

let pdfjsPromise = null;
function ensurePdfjsPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    };
  }
  if (typeof globalThis.Path2D === "undefined") {
    globalThis.Path2D = class Path2D {};
  }
}
function getPdfjs() {
  if (!pdfjsPromise) {
    ensurePdfjsPolyfills();
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

function clusterTextRows(items, bucket = LAST_PAGE_LINE_BUCKET) {
  const rows = new Map();
  for (const item of items) {
    const t = String(item.str || "").trim();
    if (!t) continue;
    const key = Math.round(item.transform[5] / bucket) * bucket;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(t);
  }
  return rows;
}

async function analyzeLastPageLayout(pdfBuffer) {
  try {
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
    const numPages = doc.numPages;
    if (numPages < 2) {
      return { applicable: false, numPages, reason: "single-page" };
    }

    const page = await doc.getPage(numPages);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const { items } = await page.getTextContent();
    const rows = clusterTextRows(items);
    const lineCount = rows.size;

    if (lineCount === 0) {
      return { applicable: false, numPages, reason: "empty-last-page" };
    }

    const yKeys = [...rows.keys()];
    const minY = Math.min(...yKeys);
    const maxY = Math.max(...yKeys);
    // PDFs vary: origin bottom-left (minY = trailing blank) or top-left (pageHeight - maxY).
    const blankBelowRatio = Math.max(minY / pageHeight, (pageHeight - maxY) / pageHeight);
    const halfBlank = blankBelowRatio >= LAST_PAGE_BLANK_MIN;
    const orphan = lineCount <= 2 && blankBelowRatio >= LAST_PAGE_ORPHAN_BLANK_MIN;

    return {
      applicable: true,
      numPages,
      lastPage: numPages,
      lineCount,
      blankBelowRatio,
      halfBlank,
      orphan,
    };
  } catch (e) {
    console.warn("  last-page layout analysis failed:", e.message);
    return { applicable: false, reason: "error", error: e.message };
  }
}

async function lastPageLayoutChecks(pdfBuffer) {
  const metrics = await analyzeLastPageLayout(pdfBuffer);
  return { flags: layoutFlagsFromMetrics(metrics), metrics };
}

function layoutFlagsFromMetrics(metrics) {
  if (!metrics.applicable) {
    if (metrics.reason && metrics.reason !== "single-page") {
      console.log(`  last-page layout: skipped (${metrics.reason})`);
    }
    return [];
  }

  const flags = [];
  if (metrics.halfBlank) {
    flags.push({
      id: "half_blank_page",
      found: true,
      evidence: crispPageTarget(metrics.numPages),
      confidence: 0.95,
    });
  }
  if (metrics.orphan) {
    const ev =
      metrics.lineCount === 1
        ? `one line on Page ${metrics.lastPage}`
        : `${metrics.lineCount} lines on Page ${metrics.lastPage}`;
    flags.push({ id: "orphan_line", found: true, evidence: ev, confidence: 0.95 });
  }

  if (flags.length) {
    console.log(
      `  last-page layout: Page ${metrics.lastPage} — ${metrics.lineCount} line(s), ${(metrics.blankBelowRatio * 100).toFixed(0)}% blank below → ${flags.map((f) => f.id).join(", ")}`
    );
  } else {
    console.log(
      `  last-page layout: Page ${metrics.lastPage} — ${metrics.lineCount} line(s), ${(metrics.blankBelowRatio * 100).toFixed(0)}% blank below → clean`
    );
  }

  return flags;
}

function dropModelLayoutFlags(issues) {
  const codeOnly = new Set(
    ISSUES.filter((i) => i.source === "code").map((i) => i.id)
  );
  return issues.filter((it) => {
    if (it.id === "half_blank_page" || it.id === "orphan_line") {
      console.warn(`  ${it.id}: dropped — code-only layout check`);
      return false;
    }
    if (codeOnly.has(it.id)) {
      console.warn(`  ${it.id}: dropped — code-only issue`);
      return false;
    }
    return true;
  });
}

function mergeCandidates(candidates) {
  const first = new Map();
  const codeLatest = new Map();
  for (const c of candidates) {
    if (CODE_ONLY_IDS.has(c.id)) codeLatest.set(c.id, c);
    else if (!first.has(c.id)) first.set(c.id, c);
  }
  return [...first.values(), ...codeLatest.values()];
}

function dropBadLastPageLayoutFlags(issues, metrics) {
  return issues.filter((it) => {
    if (it.id !== "half_blank_page" && it.id !== "orphan_line") return true;
    if (!metrics?.applicable) {
      console.warn(`  ${it.id}: dropped — last-page check N/A (${metrics?.reason || "unknown"})`);
      return false;
    }
    if (it.id === "half_blank_page" && !metrics.halfBlank) {
      console.warn(
        `  half_blank_page: dropped — Page ${metrics.lastPage} trailing blank ${(metrics.blankBelowRatio * 100).toFixed(0)}% (need ${(LAST_PAGE_BLANK_MIN * 100).toFixed(0)}%+)`
      );
      return false;
    }
    if (it.id === "orphan_line" && !metrics.orphan) {
      console.warn(`  orphan_line: dropped — Page ${metrics.lastPage} has ${metrics.lineCount} line(s)`);
      return false;
    }
    return true;
  });
}

async function dropBadWeakVerbs(issues, pdfBuffer) {
  const weak = issues.find((it) => it.id === "weak_verbs");
  if (!weak) return issues;

  const verb = cleanEvidence("weak_verbs", weak.evidence);
  if (!verb) {
    console.warn("  weak_verbs: dropped (invalid evidence)");
    return issues.filter((it) => it.id !== "weak_verbs");
  }

  const text = await extractPdfText(pdfBuffer);
  if (!text) return issues;

  const count = countBulletOpeners(text, verb);
  if (count < 3) {
    console.warn(
      `  weak_verbs: dropped "${verb}" — only ${count} bullet opener(s) in PDF text (need 3+)`
    );
    return issues.filter((it) => it.id !== "weak_verbs");
  }
  console.log(`  weak_verbs: confirmed "${verb}" opens ${count} bullet(s)`);
  return issues;
}

/* --- Layout / formatting guards (strict: multi-column or unreadable only) --- */

const LAYOUT_SERIOUS_RE =
  /\b(two.?column|multi.?column|2.?column|sidebar|side bar|side-by-side|side by side|column layout|split layout|table layout|text box|textbox|overlapping|overlap|unreadable|illegible|parser|reading order|columns? break|parallel columns|canva template)\b/i;

function isDateFormatOnlyEvidence(evidence) {
  const e = String(evidence || "").toLowerCase();
  if (!e) return false;
  const hasDateCue =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\d{4}|date format|dates? differ|mm\/yy)\b/.test(e);
  const hasLayoutCue = LAYOUT_SERIOUS_RE.test(e);
  return hasDateCue && !hasLayoutCue;
}

function isValidLayoutEvidence(evidence) {
  const e = String(evidence || "").trim();
  if (e.length < 10) return false;
  if (isDateFormatOnlyEvidence(e)) return false;

  if (LAYOUT_SERIOUS_RE.test(e)) return true;

  // Reject vague hand-waving with no layout detail
  if (/^(inconsistent|formatting|messy|unclear|hard to read|ransom note)$/i.test(e)) return false;

  // "Jan 2021 vs 2021" style with no layout keyword
  if (/\bvs\b|\bversus\b/.test(e) && isDateFormatOnlyEvidence(e)) return false;

  return false;
}

function dropBadLayoutFlags(issues) {
  return issues.filter((it) => {
    if (it.id !== "multi_column") return true;

    if (!isValidLayoutEvidence(it.evidence)) {
      console.warn(
        `  ${it.id}: dropped — need multi-column or unreadable layout proof, not "${(it.evidence || "").slice(0, 60)}"`
      );
      return false;
    }
    return true;
  });
}

function dropRequiresProofWithoutEvidence(issues) {
  const needsProof = new Set(
    ISSUES.filter((i) => i.requiresProof).map((i) => i.id)
  );
  return issues.filter((it) => {
    if (!needsProof.has(it.id)) return true;
    const e = String(it.evidence || "").trim();
    if (e.length >= 8) return true;
    console.warn(`  ${it.id}: dropped (requires proof, evidence missing or too short)`);
    return false;
  });
}

function normalizePdfText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function noMetricsEvidenceIsMetaAnalysis(evidence) {
  const e = String(evidence || "").trim();
  const lower = e.toLowerCase();
  if (/^no [a-z]+ or/i.test(e)) return true;
  return (
    /\b(no numbers|no metrics|zero quantified|any experience bullet|all bullets|every bullet|lack(s)? (of )?metrics|without (any )?metrics|have zero|zero outcomes|quantified outcomes|none of the bullets)\b/i.test(
      lower
    ) ||
    /\bbullet on page \d+ has no numbers\b/i.test(lower) ||
    /\bhas no numbers:\s*["']/i.test(lower) ||
    /\bthe \w+ bullet on page\b/i.test(lower) ||
    /\be\.g\.|for example\b/i.test(lower) ||
    /\bbullets on\b|\bbullets (have|with|contain|lack)\b/i.test(lower) ||
    /\bexperience bullets?\b.*\b(zero|no|without)\b/i.test(lower)
  );
}

function evidenceAppearsInPdf(evidence, pdfText) {
  const pdf = normalizePdfText(pdfText);
  if (!pdf) return false;

  const stripQuotes = (s) => s.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  const parts = String(evidence || "")
    .split(/\s*[;|]\s*/)
    .map((p) => stripQuotes(p.trim()))
    .filter((p) => p.length >= 12);

  for (const part of parts.length ? parts : [stripQuotes(String(evidence || ""))]) {
    const norm = normalizePdfText(part);
    if (norm.length >= 12 && pdf.includes(norm)) return true;
    if (norm.length >= 20) {
      for (let len = Math.min(norm.length, 90); len >= 20; len--) {
        for (let i = 0; i <= norm.length - len; i++) {
          if (pdf.includes(norm.slice(i, i + len))) return true;
        }
      }
    }
  }
  return false;
}

function extractBulletQuoteFromEvidence(evidence) {
  const e = String(evidence || "").trim();
  const quoted = e.match(/["“”']([^"“”']{12,})["“”']/);
  if (quoted) return quoted[1].trim();
  const dashSplit = e.split(/\s*[—–-]\s+/);
  if (dashSplit.length > 1 && dashSplit[dashSplit.length - 1].length >= 12) {
    return dashSplit.slice(1).join(" - ").replace(/^["“”']|["“”']$/g, "").trim();
  }
  return e;
}

function dropNoMetricsWrongEvidence(issues, pdfText) {
  return issues.filter((it) => {
    if (it.id !== "no_metrics") return true;
    const e = String(it.evidence || "").trim();
    if (e.length < 12) {
      console.warn(`  no_metrics: dropped (evidence too short)`);
      return false;
    }
    if (noMetricsEvidenceIsMetaAnalysis(e)) {
      console.warn(`  no_metrics: dropped — paste exact bullet text, not analysis ("${e.slice(0, 80)}")`);
      return false;
    }
    const quote = extractBulletQuoteFromEvidence(e);
    const classification = classifyExperienceBullet(quote);
    if (classification === "impact" || classification === "acceptable") {
      console.warn(`  no_metrics: dropped — bullet has real impact ("${quote.slice(0, 80)}")`);
      return false;
    }
    if (classification !== "weak" && !/\b(optimiz|process|develop|collect|scan|analyz)\b/i.test(quote)) {
      console.warn(`  no_metrics: dropped — not a weak-impact bullet ("${quote.slice(0, 80)}")`);
      return false;
    }
    if (!evidenceAppearsInPdf(quote, pdfText) && !evidenceAppearsInPdf(e, pdfText)) {
      console.warn(`  no_metrics: dropped — evidence not found verbatim in PDF ("${e.slice(0, 80)}")`);
      return false;
    }
    return true;
  });
}


function extractSkillsBlock(text) {
  const t = String(text || "");
  const startMatch = t.match(/\b(SKILLS|TECHNICAL SKILLS|CORE COMPETENCIES)\b/i);
  if (!startMatch) return "";
  const rest = t.slice(startMatch.index);
  const endMatch = rest.slice(8).match(
    /\b(WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EXPERIENCE|EDUCATION|CERTIFICATIONS|PROJECTS|EMPLOYMENT)\b/i
  );
  return endMatch ? rest.slice(0, endMatch.index + 8) : rest.slice(0, 2500);
}

function countSkillCategories(pdfText) {
  const block = extractSkillsBlock(pdfText);
  if (!block) return 0;
  const categories = new Set();
  for (const line of block.split(/\n+/)) {
    const m = line.trim().match(/^(?:[•\-\*·]\s*)?([^:\n]{2,40}):\s+\S/);
    if (m) {
      const label = m[1].trim();
      if (label.length >= 2) categories.add(label.toLowerCase());
    }
  }
  return categories.size;
}

function evidenceClaimsTooManySkillSections(evidence) {
  const e = String(evidence || "");
  if (/\b([5-9]|\d{2,})\s*(skill\s*)?(categor|section|subcategor|group|header)/i.test(e)) return true;
  if (/\b(five|six|seven|eight|nine|ten)\s+(skill\s*)?(categor|section|group)/i.test(e)) return true;
  return false;
}

function evidenceIsSingleCategoryComplaint(evidence) {
  const e = String(evidence || "");
  return (
    /\b(tools line|ai\s*&\s*automation|product management|for fun line|skills line)\b/i.test(e) ||
    /\b[A-Z][a-zA-Z &]{2,30}\s*line\b/i.test(e)
  );
}

const MAX_SKILL_CATEGORIES = 4;

function validateSkillDump(issues, pdfText) {
  const categoryCount = countSkillCategories(pdfText);

  return issues.filter((it) => {
    if (it.id !== "skill_dump") return true;
    const e = String(it.evidence || "");

    if (categoryCount > MAX_SKILL_CATEGORIES) {
      console.log(`  skill_dump: confirmed — ${categoryCount} skill categories (>${MAX_SKILL_CATEGORIES})`);
      return true;
    }

    if (evidenceClaimsTooManySkillSections(e)) {
      if (categoryCount <= MAX_SKILL_CATEGORIES && categoryCount > 0) {
        console.warn(
          `  skill_dump: dropped — only ${categoryCount} skill categories found, not spam (${MAX_SKILL_CATEGORIES} max)`
        );
        return false;
      }
      return true;
    }

    // 1-4 organized categories: fine unless it's a flat list flag (categoryCount 0-1)
    if (categoryCount >= 2 && categoryCount <= MAX_SKILL_CATEGORIES) {
      console.warn(
        `  skill_dump: dropped — ${categoryCount} organized skill categories is fine (max ${MAX_SKILL_CATEGORIES})`
      );
      return false;
    }

    if (evidenceIsSingleCategoryComplaint(e) && categoryCount <= MAX_SKILL_CATEGORIES) {
      console.warn(`  skill_dump: dropped — one category line inside an organized skills section`);
      return false;
    }

    // categoryCount 0-1: likely flat dump — keep flag if model found one
    return true;
  });
}

const IRRELEVANT_CERTS_NON_CERT_RE =
  /\b(for fun|skills section|skills line|hobbies|interests section|work experience|side hustle|job at|employment section|education section|degree in)\b/i;

const IRRELEVANT_CERTS_META_RE =
  /\b(random cert|irrelevant cert|certifications don't|courses don't|don't support your|off-target for a)\b/i;

function extractCertsBlock(text) {
  const t = String(text || "");
  const startMatch = t.match(
    /\b(CERTIFICATIONS?|TRAINING COURSES?|OTHER TRAINING|PROFESSIONAL DEVELOPMENT|LICENSES?(?:\s+AND\s+CERTIFICATIONS?)?|CONTINUING EDUCATION)\b/i
  );
  if (!startMatch) return "";
  const rest = t.slice(startMatch.index);
  const endMatch = rest.slice(8).match(
    /\b(SKILLS|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EXPERIENCE|EDUCATION|PROJECTS|EMPLOYMENT)\b/i
  );
  return endMatch ? rest.slice(0, endMatch.index + 8) : rest.slice(0, 2500);
}

function dropIrrelevantCerts(issues, pdfText) {
  const certsBlock = extractCertsBlock(pdfText);

  return issues.filter((it) => {
    if (it.id !== "irrelevant_certs") return true;
    const e = String(it.evidence || "").trim();
    if (e.length < 8) {
      console.warn(`  irrelevant_certs: dropped (evidence too short)`);
      return false;
    }
    if (IRRELEVANT_CERTS_NON_CERT_RE.test(e)) {
      console.warn(`  irrelevant_certs: dropped — certs/courses only, not For Fun or jobs ("${e.slice(0, 70)}")`);
      return false;
    }
    if (IRRELEVANT_CERTS_META_RE.test(e) && !evidenceAppearsInPdf(e, pdfText)) {
      console.warn(`  irrelevant_certs: dropped — name the cert/course, not a summary ("${e.slice(0, 70)}")`);
      return false;
    }
    if (!evidenceAppearsInPdf(e, pdfText)) {
      console.warn(`  irrelevant_certs: dropped — cert/course not found verbatim in PDF ("${e.slice(0, 70)}")`);
      return false;
    }
    if (certsBlock && !evidenceAppearsInPdf(e, certsBlock) && certsBlock.length > 40) {
      console.warn(
        `  irrelevant_certs: dropped — "${e.slice(0, 50)}" not in Certifications/Training section`
      );
      return false;
    }
    return true;
  });
}

function dropTruncatedEvidence(issues) {
  return issues.filter((it) => {
    const e = String(it.evidence || "");
    if (/\.\.\.|…/.test(e)) {
      console.warn(`  ${it.id}: dropped — evidence looks truncated ("${e.slice(0, 80)}")`);
      return false;
    }
    return true;
  });
}

function monthYearFromEvidenceMatch(monthStr, yearStr) {
  const key = String(monthStr || "")
    .slice(0, 3)
    .toLowerCase();
  const month = MONTH_INDEX[key];
  if (month == null) return null;
  return new Date(parseInt(yearStr, 10), month, 1);
}

function dropBadDateGapEvidence(issues) {
  const now = new Date();
  return issues.filter((it) => {
    if (it.id !== "date_gaps") return true;
    const e = String(it.evidence || "");
    const lower = e.toLowerCase();
    if (/\bgap\b/.test(lower) && !/(missing|vague|no end|no start|only year|year only|contradict)/.test(lower)) {
      console.warn(`  date_gaps: dropped — employment gaps not flagged ("${e.slice(0, 90)}")`);
      return false;
    }
    if (!/future[- ]?dat/i.test(e)) return true;
    const dates = [
      ...e.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/gi),
    ];
    if (!dates.length) return true;
    const allNotFuture = dates.every((d) => {
      const dt = monthYearFromEvidenceMatch(d[1], d[2]);
      return dt && dt <= now;
    });
    if (allNotFuture) {
      console.warn(`  date_gaps: dropped — past/present date flagged as future ("${e.slice(0, 90)}")`);
      return false;
    }
    return true;
  });
}

function dropBadOverlappingEvidence(issues) {
  return issues.filter((it) => {
    if (it.id !== "overlapping_experience") return true;
    const e = String(it.evidence || "").trim();
    if (e.length < 12) {
      console.warn(`  overlapping_experience: dropped (evidence too short)`);
      return false;
    }
    if (!/\boverlap/i.test(e) && !/\band\b/i.test(e)) {
      console.warn(`  overlapping_experience: dropped — name both roles ("${e.slice(0, 70)}")`);
      return false;
    }
    return true;
  });
}

async function applyIssueValidators(issues, pdfBuffer, lastPageMetrics = null) {
  const pdfText = await extractPdfText(pdfBuffer);
  const metrics = lastPageMetrics || (await analyzeLastPageLayout(pdfBuffer));
  let out = issues;
  out = dropModelLayoutFlags(out);
  out = await dropBadWeakVerbs(out, pdfBuffer);
  out = dropBadLayoutFlags(out);
  out = dropBadLastPageLayoutFlags(out, metrics);
  out = dropNoMetricsWrongEvidence(out, pdfText);
  out = validateSkillDump(out, pdfText);
  out = dropIrrelevantCerts(out, pdfText);
  out = dropTruncatedEvidence(out);
  out = dropBadDateGapEvidence(out);
  out = dropBadOverlappingEvidence(out);
  out = dropRequiresProofWithoutEvidence(out);
  return out;
}

function normalizeIssues(raw) {
  return (raw || [])
    .filter((it) => it && VALID_IDS.has(it.id))
    .map((it) => ({
      id: it.id,
      found: true,
      evidence: cleanEvidence(it.id, it.evidence),
      confidence: typeof it.confidence === "number" ? it.confidence : 0.8,
    }));
}

async function pageAndLinkChecks(pdfBuffer, pdfText) {
  const flags = [];
  const tooLong = await detectTooLong(pdfBuffer, pdfText);
  if (tooLong) flags.push(tooLong);
  const urlLinks = detectFullUrlLinks(pdfText);
  if (urlLinks) flags.push(urlLinks);
  if (flags.length) {
    console.log(`  page/link checks: ${flags.map((f) => f.id).join(", ")}`);
  }
  return flags;
}

/* Extract issues from the forced tool_use block (primary, reliable path). */
function parseToolIssues(data) {
  const block = (data.content || []).find(
    (c) => c.type === "tool_use" && c.name === "report_resume_issues"
  );
  if (!block?.input) {
    return {
      ok: false,
      isResume: true,
      issues: [],
      rawPreview: JSON.stringify(data.content || []).slice(0, 500),
    };
  }
  const isResume = block.input.is_resume !== false;
  return { ok: true, isResume, issues: normalizeIssues(block.input.issues) };
}

function parseReviewIssues(data) {
  const block = (data.content || []).find(
    (c) => c.type === "tool_use" && c.name === "review_resume_issues"
  );
  if (!block?.input?.reviews) {
    return {
      ok: false,
      reviews: [],
      rawPreview: JSON.stringify(data.content || []).slice(0, 500),
    };
  }
  const reviews = (block.input.reviews || [])
    .filter((r) => r && VALID_IDS.has(r.id))
    .map((r) => ({
      id: r.id,
      verdict: r.verdict === "confirm" ? "confirm" : "reject",
      evidence: cleanEvidence(r.id, r.evidence),
      reason: String(r.reason || "").trim().slice(0, 160),
    }));
  return { ok: true, reviews };
}

function buildReviewPrompt(candidates) {
  const lines = candidates
    .map((c) => {
      const issue = ISSUE_BY_ID[c.id];
      const hint = issue?.evidenceHint ? ` [evidence: ${issue.evidenceHint}]` : "";
      return `- ${c.id} (${issue?.title || c.id}) — Pass 1 evidence: "${c.evidence || "none"}"${hint}`;
    })
    .join("\n");

  return `You are the REVIEW agent in a two-step resume roast pipeline. A detection agent flagged issues on a PDF resume. Your job is to be skeptical and accurate.

Re-read the ENTIRE PDF. For EACH flagged issue below, either:
- confirm — it genuinely applies AND you can cite specific proof from the document (page number, exact quote, role name, count)
- reject — it does not apply, was a false positive, or Pass 1 evidence was wrong

Flagged issues to review:
${lines}

Rules:
- Reject weak_verbs unless the same verb is literally the FIRST WORD of 3+ experience bullets.
- Reject typos unless you can quote the exact mistake.
- Reject multi_column on clean single-column resumes (dates right-aligned is OK).
- Reject irrelevant_certs unless evidence names a cert/course from Certs/Training. Reject For Fun/hobbies/skills/jobs. Reject CSPO/Scrum/PMP/SAFe when they fit the role.
- Reject no_metrics unless evidence is verbatim weak bullet text from the PDF. Reject meta-summaries ('no numbers', 'zero quantified outcomes', 'e.g.'). Reject when the quoted bullet has real quantified outcomes (%/$/time saved). Confirm when bullets only show input scale (GB, hosts) or vague optimize/improve with no result.
- Reject skill_dump if skills have 4 or fewer organized categories. Confirm if 5+ categories or a flat ungrouped keyword list.
- too_long: count PDF pages; confirm 3+ pages always, or 2 pages with under 10 years experience. Evidence must be page count.
- Confirm bad_summary when Summary, Profile, About, or Objective is 3+ sentences or clearly keyword-stuffed/generic seeking-language.
- Confirm no_summary when the resume jumps from contact info straight into Experience or Skills with no Summary/Profile/About/Objective block above it. Reject if any summary-like section or intro paragraph exists at the top.
- Confirm keyword_spam when Skills/Competencies section appears above Work Experience.
- Confirm unnecessary_projects when Projects section exists and candidate has 3+ years experience.
- Confirm volunteer_on_resume when a volunteer section exists alongside paid work. Reject if no volunteer section.
- Confirm publications_on_resume when Publications/Research section exists alongside paid work.
- Confirm first_person when 2+ experience bullets start with I/My/We/Our.
- Confirm passive_voice when 2+ bullets use Was responsible for or Duties included. Reject Was promoted lines.
- Confirm present_tense_past_roles when a past role has 2+ present-tense openers (Manage vs Managed). Reject on current/Present roles.
- Confirm unprofessional_email when the address has joke local-parts, legacy domains, or mostly numbers.
- Confirm too_many_bullets when one sub-role has 6+ bullets without a promotion split.
- Confirm promotions when one company spans 3+ years with only one title line. Reject when multiple title lines with separate dates exist under one company.
- Confirm overlapping_experience when two roles have date ranges overlapping more than one month. Reject same-month transitions.
- Confirm stale_experience when a role ended 15+ years ago with full bullets still listed.
- Confirm no_exp_context when a role has no company/team/project context before bullets.
- Confirm thin_education when Education splits into separate degrees and any entry is a one-liner without GPA, honors, coursework, or thesis (fellowship alone is not enough). Multiple stacked one-liner degrees always confirm.
- Reject date_gaps when the only issue is employment gap between jobs, or a past/current month flagged as future. Confirm only missing/vague/contradictory dates on roles.
- Prefer reject over confirm when unsure. False positives hurt trust.
- For every confirm, rewrite evidence to be specific and actionable (max 420 chars).
- Never use em dashes or en dashes.
- Call review_resume_issues with one entry per flagged issue above.`;
}

/* Fallback: try to salvage issues from truncated/broken free-form JSON. */
function salvageJsonIssues(text) {
  const jsonStr = extractJson(text);
  if (!jsonStr) return [];
  // Close truncated array/object so JSON.parse might succeed
  let attempt = jsonStr;
  if (!attempt.trimEnd().endsWith("}")) {
    attempt = attempt.replace(/,\s*"[^"]*$/, "").replace(/,\s*\{[^}]*$/, "");
    if (!attempt.includes("]")) attempt += "]";
    if (!attempt.trimEnd().endsWith("}")) attempt += "}";
  }
  try {
    const parsed = JSON.parse(attempt);
    return normalizeIssues(parsed.issues);
  } catch {
    // Last resort: regex-extract individual issue objects
    const out = [];
    const re =
      /\{\s*"id"\s*:\s*"([a-z_]+)"\s*,\s*"found"\s*:\s*true\s*,\s*"evidence"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"confidence"\s*:\s*([\d.]+)\s*\}/g;
    let m;
    while ((m = re.exec(jsonStr))) {
      if (VALID_IDS.has(m[1])) {
        out.push({
          id: m[1],
          found: true,
          evidence: m[2].replace(/\\"/g, '"').slice(0, EVIDENCE_MAX),
          confidence: parseFloat(m[3]) || 0.8,
        });
      }
    }
    return out;
  }
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/* Deterministic checks we don't need the model for. */
function isLazyFilename(name = "") {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return /(^resume$|^cv$|^document\d*$|^untitled|final|_?v\d+|\bcopy\b|draft|new resume)/i.test(base);
}
function codeChecks(file) {
  const out = [];
  if (isLazyFilename(file.originalname)) {
    out.push({ id: "bad_filename", evidence: file.originalname, confidence: 1 });
  }
  return out;
}

/* PASS 1 — detection. Returns candidates (kept) + considered (everything weighed). */
async function detect(file) {
  const prompt = buildDetectPrompt(file.originalname || "resume.pdf");
  const tApi = Date.now();
  const data = await callClaude(prompt, file, {
    tools: [REPORT_TOOL],
    toolChoice: { type: "tool", name: "report_resume_issues" },
  });
  const apiMeta = logApiUsage(data, Date.now() - tApi);

  let parsed = parseToolIssues(data);
  if (!parsed.ok) {
    // Fallback: model returned text instead of tool (shouldn't happen, but salvage if so)
    const text = (data.content || []).map((c) => c.text || "").join("");
    const salvaged = salvageJsonIssues(text);
    if (salvaged.length) {
      console.warn("  tool parse failed, salvaged", salvaged.length, "issues from text");
      parsed = { ok: true, isResume: true, issues: salvaged };
    } else {
      console.error("Model returned no usable tool output. Preview:", parsed.rawPreview);
      throw new Error("Model response could not be parsed. Check server logs.");
    }
  }

  if (!parsed.isResume) {
    console.log("  not a resume — skipping checklist");
    return {
      notResume: true,
      candidates: [],
      considered: [],
      codeFlags: [],
      parseOk: true,
      apiMeta,
    };
  }

  const passed = parsed.issues.filter((it) => it.confidence >= CONFIDENCE_MIN);
  const lastPageMetrics = await analyzeLastPageLayout(file.buffer);
  const pdfText = await extractPdfText(file.buffer);
  const validated = await applyIssueValidators(passed, file.buffer, lastPageMetrics);
  const code = codeChecks(file);
  const layoutFlags = layoutFlagsFromMetrics(lastPageMetrics);
  const contentFlags = contentChecksFromPdf(pdfText);
  const pageLinkFlags = await pageAndLinkChecks(file.buffer, pdfText);
  const experienceFlags = await experienceFormattingChecks(file.buffer);
  const educationFlags = await educationFormattingChecks(file.buffer);
  console.log(`  ${parsed.issues.length} flagged, ${validated.length} passed threshold (${CONFIDENCE_MIN})`);
  return {
    candidates: [
      ...validated,
      ...code,
      ...layoutFlags,
      ...contentFlags,
      ...pageLinkFlags,
      ...experienceFlags,
      ...educationFlags,
    ],
    considered: parsed.issues,
    codeFlags: [
      ...code,
      ...layoutFlags,
      ...contentFlags,
      ...pageLinkFlags,
      ...experienceFlags,
      ...educationFlags,
    ],
    parseOk: true,
    apiMeta,
  };
}

/* PASS 2 — reviewer. Skeptical second read; drops false positives, sharpens evidence. */
async function review(file, det) {
  const code = det.candidates.filter((c) => SKIP_REVIEW_IDS.has(c.id));
  const vision = det.candidates.filter((c) => !SKIP_REVIEW_IDS.has(c.id));
  if (!vision.length) return det;

  console.log(`  Pass 2 reviewing ${vision.length} issue(s)...`);
  const prompt = buildReviewPrompt(vision);
  const tApi = Date.now();
  const data = await callClaude(prompt, file, {
    tools: [REVIEW_TOOL],
    toolChoice: { type: "tool", name: "review_resume_issues" },
  });
  const reviewMeta = logApiUsage(data, Date.now() - tApi);

  const parsed = parseReviewIssues(data);
  if (!parsed.ok) {
    console.warn("  Pass 2 parse failed, keeping Pass 1 results. Preview:", parsed.rawPreview);
    return { ...det, apiMeta: { pass1: det.apiMeta, pass2: reviewMeta, pass2Ok: false } };
  }

  const byId = Object.fromEntries(parsed.reviews.map((r) => [r.id, r]));
  const confirmed = [];
  const rejected = [];
  const explicitlyRejected = new Set();
  for (const cand of vision) {
    const r = byId[cand.id];
    if (r?.verdict === "confirm") {
      confirmed.push({
        id: cand.id,
        found: true,
        evidence: r.evidence || cand.evidence,
        confidence: cand.confidence,
      });
    } else {
      if (r?.verdict === "reject") explicitlyRejected.add(cand.id);
      rejected.push({
        id: cand.id,
        reason: r?.reason || "not confirmed on review",
        pass1Evidence: cand.evidence,
      });
    }
  }

  const lastPageMetrics = await analyzeLastPageLayout(file.buffer);
  let validated = await applyIssueValidators(confirmed, file.buffer, lastPageMetrics);
  if (confirmed.length > validated.length) {
    console.warn(
      `  Pass 2 validators dropped ${confirmed.length - validated.length} confirmed issue(s) (bad evidence rewrite)`
    );
  }

  if (validated.length === 0 && vision.length > 0) {
    const fallback = vision.filter((c) => !explicitlyRejected.has(c.id));
    if (fallback.length) {
      validated = await applyIssueValidators(fallback, file.buffer, lastPageMetrics);
      if (validated.length) {
        console.warn(
          `  Pass 2 kept 0 after review — falling back to ${validated.length} Pass 1 issue(s) (skipped explicit rejects: ${[...explicitlyRejected].join(", ") || "none"})`
        );
      }
    }
  }

  const layoutFlags = layoutFlagsFromMetrics(lastPageMetrics);
  const pdfText = await extractPdfText(file.buffer);
  const contentFlags = contentChecksFromPdf(pdfText);
  const pageLinkFlags = await pageAndLinkChecks(file.buffer, pdfText);
  const experienceFlags = await experienceFormattingChecks(file.buffer);
  const educationFlags = await educationFormattingChecks(file.buffer);
  if (rejected.length) {
    console.log(
      `  Pass 2 rejected ${rejected.length}: ${rejected.map((r) => r.id).join(", ")}`
    );
  }
  console.log(`  Pass 2 confirmed ${validated.length}/${vision.length}`);

  return {
    ...det,
    candidates: [
      ...validated,
      ...code,
      ...layoutFlags,
      ...contentFlags,
      ...pageLinkFlags,
      ...experienceFlags,
      ...educationFlags,
    ],
    reviewLog: parsed.reviews,
    rejected,
    apiMeta: { pass1: det.apiMeta, pass2: reviewMeta, pass2Ok: true },
  };
}

async function finalize(det, source, file) {
  if (det.notResume) {
    return {
      notResume: true,
      score: 0,
      foundIds: [],
      evidence: {},
      verdict: verdictForNotResume(),
      source,
      debug: {
        threshold: CONFIDENCE_MIN,
        parseOk: det.parseOk,
        considered: [],
        codeFlags: [],
        api: det.apiMeta || null,
        reviewLog: null,
        rejected: null,
      },
    };
  }

  const uniq = mergeCandidates(det.candidates);
  const evidence = {};
  uniq.forEach((c) => {
    evidence[c.id] =
      c.id === "half_blank_page" ? normalizeCrispPageEvidence(c.evidence) : c.evidence;
  });
  const found = ISSUES.filter((i) => uniq.some((c) => c.id === i.id)).sort((a, b) =>
    compareIssues(a, b, evidence)
  );
  const byConf = [...det.considered].sort((a, b) => b.confidence - a.confidence);

  return {
    score: scoreFor(found, evidence),
    foundIds: found.map((i) => i.id),
    evidence,
    source,
    debug: {
      threshold: CONFIDENCE_MIN,
      parseOk: det.parseOk,
      considered: byConf,
      codeFlags: det.codeFlags.map((c) => c.id),
      api: det.apiMeta || null,
      reviewLog: det.reviewLog || null,
      rejected: det.rejected || null,
    },
  };
}

/* Append one line per roast to logs/roast-log.jsonl for offline review. */
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "roast-log.jsonl");
function appendLog(record) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n");
  } catch (e) {
    console.warn("log write failed:", e.message);
  }
}

function requireCommunityAccess(req, res, next) {
  if (!isGateEnabled()) return next();
  const token = req.get("X-Roast-Access-Token");
  if (!verifyToken(token)) {
    return res.status(403).json({
      error: "Community access required. Join the Skool community and enter your member access code.",
      code: "community_required",
    });
  }
  return next();
}

app.get("/api/community/status", (_req, res) => {
  res.json(gateStatus());
});

app.post("/api/community/verify", express.json(), (req, res) => {
  const result = verifyAccessCode(req.body?.code);
  if (!result.ok) return res.status(403).json(result);
  return res.json(result);
});

app.post("/api/roast", upload.single("resume"), requireCommunityAccess, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No resume file uploaded." });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "ANTHROPIC_API_KEY is missing. Add it to roast-lab/.env and restart the server.",
    });
  }

  const isPdf = /pdf$/i.test(file.mimetype) || /\.pdf$/i.test(file.originalname);
  if (!isPdf) {
    return res.status(400).json({ error: "PDF only. Export your resume as a PDF and try again." });
  }

  const t0 = Date.now();
  try {
    let det = await detect(file);
    if (det.notResume) {
      const out = await finalize(det, "anthropic:" + MODEL, file);
      return res.json(out);
    }
    if (REVIEW_ENABLED && det.candidates.some((c) => !SKIP_REVIEW_IDS.has(c.id))) {
      det = await review(file, det);
    }
    const out = await finalize(det, "anthropic:" + MODEL, file);
    const ms = Date.now() - t0;
    appendLog({
      ts: new Date().toISOString(),
      file: file.originalname,
      model: MODEL,
      ms,
      score: out.score,
      foundIds: out.foundIds,
      parseOk: out.debug.parseOk,
      considered: out.debug.considered,
    });
    console.log(
      `Roasted "${file.originalname}" in ${(ms / 1000).toFixed(1)}s → score ${out.score}, ${out.foundIds.length} issues (${out.foundIds.join(", ")})`
    );
    return res.json(out);
  } catch (e) {
    console.error("Roast error:", e.message);
    return res.status(502).json({ error: `Model analysis failed: ${e.message}` });
  }
});

app.listen(PORT, () => {
  const keyOk = !!process.env.ANTHROPIC_API_KEY;
  console.log(`Roast Lab on http://localhost:${PORT}  —  model: ${MODEL}`);
  console.log(`Pass 2 reviewer: ${REVIEW_ENABLED ? "ON" : "OFF (set ROAST_REVIEW=0 to disable)"}`);
  console.log(
    `Community gate: ${isGateEnabled() ? "ON (set ROAST_COMMUNITY_GATE=0 to disable)" : "OFF (set ROAST_COMMUNITY_GATE=1 to enable)"}`
  );
  if (!keyOk) console.warn("WARNING: ANTHROPIC_API_KEY not set. Analysis will fail until you add it to .env.");
});
