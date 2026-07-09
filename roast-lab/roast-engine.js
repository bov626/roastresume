/*
 * Roast engine — shared taxonomy + mock analyzer.
 * The same ISSUE list is reused by the (optional) live server so the
 * vision model returns issue ids from a fixed, controllable set.
 */

const ISSUES = [
  {
    id: "no_metrics",
    severity: "critical",
    source: "vision",
    title: "No tangible impact",
    requiresProof: true,
    definition:
      "Flag when Work Experience bullets lack real outcomes hiring managers care about. Numbers on inputs (hosts scanned, GB processed, records handled) or vague words like 'optimized' without a quantified result are NOT impact. Each role needs at least one bullet with tangible impact OR a clear reason to care. Flag if any role has zero impact bullets OR 25%+ of its bullets are weak (duties, fake metrics, unquantified improvements). Evidence must be VERBATIM text from one weak bullet. Never summarize.",
    roast: 'Your bullets dont have impact. You literally wrote "{evidence}". Cool story, why should a hiring manager care?',
    evidenceHint:
      "paste exact weak bullet text from the resume, verbatim. Include fake-metric bullets (scale without outcome) or vague optimize/improve lines",
    sample: "Processed over 200GB of raw data, optimizing memory usage and execution time",
  },
  {
    id: "weak_verbs",
    severity: "major",
    source: "vision",
    title: "Same verb over and over",
    definition:
      "Flag ONLY when the exact same action verb is the FIRST WORD of 3+ experience bullet points across the resume. Count bullet openers only (e.g. 'Managed 50 projects…', 'Led a team…'). Do NOT count job titles, section headers, skills lists, pipe-separated keywords, summary prose, or the word appearing anywhere except as a bullet's first word. If you cannot count 3+ bullet openers for one verb, do not flag.",
    roast: 'You opened way too many bullets with "{evidence}". A thesaurus is free.',
    evidenceHint:
      "EXACTLY ONE WORD ONLY: the verb that opens 3+ experience bullets as their first word (e.g. Managed, Led, Built). Never a phrase, never a job title, never a skills keyword.",
    sample: "Led",
  },
  {
    id: "too_long",
    severity: "major",
    source: "vision",
    title: "Way too long",
    definition:
      "Flag if the resume is 3 or more pages (always). Also flag if the resume is exactly 2 pages AND the candidate has less than 10 years of total career experience (infer from employment dates). Do NOT flag 2 pages for 10+ years experience. Do NOT flag 1 page. Evidence must state page count and years when relevant.",
    roast: "This resume is {evidence}. That is too long for your experience level. Cut old roles, trim bullets, or drop the fluff. No recruiter is reading a novel.",
    evidenceHint: "exact page count with brief context, e.g. 3 pages or 2 pages, ~7 years experience",
    sample: "3 pages",
  },
  {
    id: "buzzwords",
    severity: "major",
    source: "vision",
    title: "Buzzword soup",
    definition:
      "Flag unsupported clichés used as claims without proof: 'team player', 'hard worker', 'detail-oriented', 'go-getter', 'results-driven', 'synergy', 'think outside the box'.",
    roast: 'You wrote "{evidence}" with zero proof. SHOW ME, DONT TELL ME.',
    evidenceHint: "quote the buzzword or cliché phrase exactly as written",
    sample: "results-driven team player",
  },
  {
    id: "bad_contact",
    severity: "minor",
    source: "vision",
    title: "Sketchy contact info",
    definition:
      "Flag if the header/contact area is missing city/state, phone number, and LinkedIn. Email alone is not enough for a professional resume.",
    roast: "Your contact section looks unprofessional. It could be a bad email, no LinkedIn, or no phone number.",
  },
  {
    id: "unprofessional_email",
    severity: "minor",
    source: "code",
    title: "Unprofessional email",
    definition:
      "Flag if the contact email looks unprofessional: joke or childish local-parts (beer, ninja, party), mostly numbers, gibberish, very long random local-parts, or legacy personal domains (hotmail, aol, yahoo, live, msn, mail.com). Professional addresses use firstname.lastname@company or similar.",
    roast: 'Your email "{evidence}" does not pass the sniff test. Use something like firstname.lastname@gmail.com.',
    evidenceHint: "the email address as written",
    sample: "partyninja42@hotmail.com",
  },
  {
    id: "has_photo",
    severity: "major",
    source: "vision",
    title: "You put a photo on it",
    definition: "Flag if a headshot or personal photo of the candidate appears anywhere on the resume.",
    roast: "A headshot on a resume is a fast track to the reject pile. Lose it.",
  },
  {
    id: "too_many_bullets",
    severity: "major",
    source: "vision",
    title: "Wayyy too many bullet points",
    definition:
      "Flag if ONE job title block (one promotion sub-role) in Work Experience has more than 5 bullets. When a company has multiple promotion sub-roles on separate lines with their own dates, count bullets per sub-role, not across the whole company. Do not flag when bullets are distributed across promotion splits. Evidence must name the role and bullet count.",
    roast: "{evidence} has way too many bullets. Cut the weakest ones or split promotions into separate roles.",
    evidenceHint: "company or role name with bullet count, e.g. Aditya Birla Capital, 9 bullets",
    sample: "Aditya Birla Capital, 9 bullets",
  },
  {
    id: "bold_bullet_overuse",
    severity: "critical",
    source: "code",
    title: "Bold overload on bullets",
    definition:
      "Flag when more than half of Work Experience bullets have 28%+ of the line in bold font. Ignores Key Result / Tech Stack label prefixes and light emphasis.",
    roast: "If everything is bold, nothing has impact.",
    evidenceHint: "count, e.g. 7 of 9 experience bullets use bold",
    sample: "7 of 9 experience bullets use bold",
  },
  {
    id: "references_line",
    severity: "minor",
    source: "vision",
    title: '"References available upon request"',
    definition: "Flag if the resume contains the phrase 'References available upon request' or lists actual references.",
    roast: "Nobody asked for your references here. Waste of space.",
  },
  {
    id: "skill_dump",
    severity: "major",
    source: "vision",
    title: "Skills keyword dump",
    requiresProof: true,
    definition:
      "Flag if (1) the skills section is one long flat comma list with NO subheaders, OR (2) the skills section has MORE than 4 labeled subcategories/sections (e.g. 5+ headers like Tools, Languages, Leadership, AI, Soft Skills, For Fun). Up to 4 organized categories is fine for most roles. Do NOT flag a single category line inside an otherwise clean skills section with 4 or fewer groups.",
    roast: 'Your skills section is a keyword dump: "{evidence}". Cut categories or stop listing everything you have ever touched.',
    evidenceHint:
      "flat ungrouped list quote OR count of skill categories if 5+, e.g. 6 categories: AI, Tools, PM, Leadership, Languages, For Fun",
    sample: "6 skill categories with long keyword lists",
  },
  {
    id: "typos",
    severity: "critical",
    source: "vision",
    title: "Typos / grammar errors",
    definition:
      "Flag clear spelling, grammar, verb-tense, or capitalization errors. Only flag when you can quote the specific error do not guess.",
    roast: 'Spelling mistake: "{evidence}".',
    evidenceHint: "exact typo or grammar error as written, with the mistake visible",
    sample: "managment",
  },
  {
    id: "half_blank_page",
    severity: "critical",
    source: "code",
    title: "Wasted space on last page",
    definition:
      "Detected on multi-page resumes only: the final page has 25%+ blank space below the last line of content. Either fill the page or cut to one fewer page.",
    roast: "Either fill out the full page or shorten the resume down to be a crisp {evidence}.",
    evidenceHint: "target length, e.g. one pager for a 2-page resume or two pager for 3 pages",
    sample: "one pager",
  },
  {
    id: "orphan_line",
    severity: "major",
    source: "code",
    title: "Hanging line on the last page",
    definition:
      "Detected on multi-page resumes only: the final page has just 1-2 lines of text (one bullet, one education line, etc.) with the rest of the page blank.",
    roast: "You left {evidence} stranded alone on a mostly empty page. One line does not need its own sheet of paper.",
    sample: "one line on Page 2",
  },
  {
    id: "multi_column",
    severity: "major",
    source: "vision",
    title: "Multi-column ATS trap",
    requiresProof: true,
    definition:
      "Flag if the resume uses two or more columns, a sidebar, or side-by-side sections where content runs in parallel (common Canva/Word template trap). A normal single-column resume with dates right-aligned on the same line is NOT multi-column. Evidence must describe the column layout.",
    roast: "{evidence}. Side-by-side columns break ATS parsers. Go single column.",
    evidenceHint: "describe the column/sidebar layout, e.g. skills sidebar left, experience right",
    sample: "skills sidebar plus main column",
  },
  {
    id: "graphics_bars",
    severity: "major",
    source: "vision",
    title: "Skill bars & icons",
    definition: "Flag skill rating bars, star/dot ratings, pie charts, progress meters, or decorative icons used to convey proficiency.",
    roast: "Those little proficiency bars mean nothing and will confuse parsers.",
  },
  {
    id: "date_gaps",
    severity: "minor",
    source: "vision",
    title: "Missing or vague dates",
    definition:
      "Flag ONLY missing, vague, or contradictory dates on Work Experience entries: missing end date on a past role, missing start date, year-only dates when other roles use months, or impossible dates. Do NOT flag employment gaps between roles. Do NOT flag same-month job transitions. Do NOT flag Present on a current role.",
    roast: "Fix the dates on {evidence}. Every role needs clear start and end (or Present for current).",
    evidenceHint: "role + date problem, e.g. missing end date at Acme or only year 2019",
    sample: "missing end date at Acme Corp",
  },
  {
    id: "overlapping_experience",
    severity: "minor",
    source: "vision",
    title: "Overlapping job dates",
    requiresProof: true,
    definition:
      "Flag when two or more Work Experience entries have date ranges that overlap by more than one month. Evidence must name both roles and the overlapping period. Do not flag same-month transitions. Do not flag Education overlaps.",
    roast: "{evidence}. Two jobs at the same time reads like an error or sloppy formatting. Fix the dates or explain concurrent work.",
    evidenceHint: "Role A + Role B + overlap, e.g. Analyst 2020-2022 overlaps Manager 2021-2023",
    sample: "Analyst 2020-2022 overlaps Manager 2021-2023",
  },
  {
    id: "irrelevant_old",
    severity: "minor",
    source: "vision",
    title: "Ancient history",
    definition: "Flag high-school details in the Education section. Quote the school name.",
    roast: 'Nobody cares that you went to "{evidence}". Drop high school once you have real experience.',
    evidenceHint: "high school name from Education section",
    sample: "Lincoln High School",
  },
  {
    id: "irrelevant_certs",
    severity: "minor",
    source: "vision",
    title: "Irrelevant certs or courses",
    requiresProof: true,
    definition:
      "Flag ONLY a named certification, license, or training/course listed under Certifications, Training Courses, Professional Development, or similar when it clearly does not support the candidate's target role (infer from most recent job titles). Quote the exact cert/course name. Do NOT flag For Fun, hobbies, skills, education degrees, or Work Experience jobs. Do NOT flag baseline role certs (CSPO/Scrum/PMP/SAFe/agile) when they fit the target role.",
    roast: 'You might want to remove "{evidence}" if it is not super relevant for your target role.',
    evidenceHint:
      "exact certification or course name from Certs/Training section, e.g. Android Platform Training",
    sample: "Android Platform Training",
  },
  {
    id: "no_location",
    severity: "minor",
    source: "vision",
    title: "No location / relocation clarity",
    definition: "Flag if there is no city/region located on the top of the resume.",
    roast: "Where even are you? Add in a city,state to the top of the resume.",
  },
  {
    id: "no_exp_location",
    severity: "minor",
    source: "vision",
    title: "No location on experiences",
    definition: "Flag if there is no city/region located within the experiences. If they list remote or hybrid that is fine.",
    roast: "Make sure to name where the job took place. If it was remote, call it out specifically.",
  },
  {
    id: "no_exp_context",
    severity: "major",
    source: "code",
    title: "No context for your roles",
    definition:
      "Flag if one or more Work Experience entries jump straight into bullets with no context line explaining the company, team, product, or project. Do not assume the reader knows the employer. Context can be its own line or a first bullet that sets the scene before wins. Evidence must name the company or role missing context.",
    roast:
      "Add context to each experience, dont assume hiring managers know the company, team or project you worked on.",
    evidenceHint: "company or role name missing context, e.g. J2 Interactive",
    sample: "J2 Interactive",
  },
  {
    id: "full_url_links",
    severity: "minor",
    source: "code",
    title: "Full URLs instead of clean links",
    definition:
      "Flag when LinkedIn, GitHub, portfolio, or other contact links appear as the full URL text (e.g. linkedin.com/in/johndoe, github.com/johndoe) instead of a short hyperlinked label (LinkedIn, GitHub). Clean linked text with hidden URL is correct. Do not flag.",
    roast: 'You pasted the full URL for {evidence}. Use a short label like "LinkedIn" or "GitHub", hyperlinked, not the raw link.',
    evidenceHint: "the exposed URL or platform, e.g. linkedin.com/in/johndoe",
    sample: "linkedin.com/in/johndoe",
  },
  {
    id: "unnecessary_projects",
    severity: "minor",
    source: "vision",
    title: "Nobody cares about your projects",
    definition:
      "Flag if a Projects / Personal Projects / Selected Projects section appears AND the candidate has 3+ years of professional experience (paid jobs or internships). Projects are for recent grads with no real experience. Quote the section name or one project title.",
    roast: "Projects should only really be added for recent grads who have NO experience. Cut them.",
    evidenceHint: "Projects section name or project title when candidate has 3+ years experience",
    sample: "Projects section with 3+ years at TCS",
  },
  {
    id: "bad_summary",
    severity: "major",
    source: "vision",
    title: "Generic or too long intro",
    definition:
      "Flag if a Summary, Profile, About, or Objective block exists and is (a) longer than 2 sentences, (b) keyword soup with no clear role + edge, OR (c) generic filler about what the candidate wants ('seeking a challenging role', 'leverage my skills') instead of value they bring. Quote opening phrase. Two sentences max.",
    roast: 'This intro is generic fluff: "{evidence}". Two sentences max, name your role and edge, not what you are seeking.',
    evidenceHint: "quote from the Summary or Objective block, max 12 words",
    sample: "Motivated professional seeking challenging opportunities",
  },
  {
    id: "no_summary",
    severity: "major",
    source: "code",
    title: "No summary at the top",
    definition:
      "Flag ONLY when the resume has no Summary, Profile, About, Overview, Objective, or similar intro block before Work Experience or Skills. If the resume jumps from contact info straight into Experience or opens with Skills, flag it. Do NOT flag headerless taglines (e.g. role + years + specializing) or any summary-like section above experience.",
    roast:
      "add a quick one- to two-sentence summary to give someone a compelling reason to read the whole resume.",
  },
  {
    id: "bad_filename",
    severity: "minor",
    source: "code",
    title: "Lazy file name",
    definition:
      "Flag if the provided file name is generic or messy (e.g. 'resume.pdf', 'resume_final_v2.pdf', 'Document1.pdf', 'CV copy.pdf') instead of something like 'Firstname-Lastname-Resume.pdf'. The filename is provided to you separately.",
    roast: "Your filename screams 'last-minute'. Name it Firstname-Lastname-Resume.pdf.",
  },
  {
    id: "keyword_spam",
    severity: "critical",
    source: "vision",
    title: "Keyword spam",
    definition:
      "Flag if Skills, Technical Skills, Core Competencies, or any large keyword block appears BEFORE Work Experience / Professional Experience. Experience must lead. Check section order on every page.",
    roast: "{evidence} sits above your experience. Move skills down. Your jobs are the headline.",
    evidenceHint: "section name that is too high, e.g. Skills before Work Experience",
    sample: "Skills before Work Experience",
  },
  {
    id: "top_experience",
    severity: "major",
    source: "vision",
    title: "Education missplaced",
    definition:
      "Flag if education section is placed above the expereince section. It should always be towards the bottom of the resume, unless they are a professor or a recent grad with no experience.",
    roast: "Education does not go at the top of the resume. Unless you are a professor or a recent grad with no experience. Move it down.",
  },
  {
    id: "thin_education",
    severity: "minor",
    source: "code",
    title: "Education is an afterthought",
    definition:
      "Split Education into separate degrees, programmes, and certificates. Flag when ANY entry uses fewer than 2 lines and lacks GPA, honors, coursework, thesis, or similar detail. Multiple prestigious degrees each crammed on one line always counts as thin. A fellowship or award name alone on a single line is not enough to pass.",
    roast: "Your education is one throwaway line. Either give it proper space or cut it if you have enough experience.",
    evidenceHint: "count of one-liner degrees, e.g. 4 of 4 degrees are one-liners (MBA, Oxford, …)",
    sample: "4 of 4 degrees are one-liners (Master of Business Administration, …)",
  },
  {
    id: "promotions",
    severity: "minor",
    source: "code",
    title: "Hidden promotions",
    requiresProof: true,
    definition:
      "Flag when a Work Experience entry spans more than 3 years but lists only one job title under that company. Long tenure with a single title usually means promotions were not shown. Multiple titles on separate lines under the same company (each with its own dates) counts as showing progression. Do not flag. A single line with slash-separated titles (e.g. PM / Senior PM) does not count as multiple promotions.",
    roast: "At {evidence}. If you were promoted, split each role on its own line with its own dates.",
    evidenceHint: "company + tenure, e.g. Wilson LLC, 6 years, 1 title",
    sample: "Wilson LLC, 6 years, 1 title",
  },
  {
    id: "volunteer_on_resume",
    severity: "minor",
    source: "vision",
    title: "Volunteering on the resume",
    definition:
      "Flag if a Volunteering / Volunteer Work / Community Service section appears AND the candidate also lists paid jobs or professional internships. Volunteering belongs on LinkedIn, not eating resume space. Quote the section or volunteer role name. Do NOT flag paid work.",
    roast: "{evidence} belongs on LinkedIn, not your resume. Save the space for paid impact.",
    evidenceHint: "volunteer section or role name, e.g. Red Cross volunteer",
    sample: "Volunteer section",
  },
  {
    id: "publications_on_resume",
    severity: "minor",
    source: "vision",
    title: "Publications on the resume",
    requiresProof: true,
    definition:
      "Flag if a Publications, Research, or Selected Papers section appears on an industry resume (not targeting academia). Publications belong on LinkedIn or a portfolio. Quote the section name or one publication title.",
    roast: '{evidence} belongs on LinkedIn or your portfolio, not a resume, unless you are targeting academia.',
    evidenceHint: "section name or publication title",
    sample: "Publications section",
  },
  {
    id: "stale_experience",
    severity: "minor",
    source: "code",
    title: "Ancient job still listed",
    requiresProof: true,
    definition:
      "Flag Work Experience entries where the role ended 15+ years ago and is still listed with full bullets. LinkedIn can show full history; the resume should focus on recent work. Evidence: company + role + end year.",
    roast: "{evidence}. Trim ancient roles. LinkedIn has the full story.",
    evidenceHint: "company + role + end year, e.g. IBM Analyst, ended 2004",
    sample: "IBM, Analyst, ended 2004",
  },
  {
    id: "first_person",
    severity: "minor",
    source: "code",
    title: "First-person bullets",
    definition:
      "Flag when 2+ Work Experience bullets start with first-person pronouns (I, I'm, My, We, Our). Resumes should use implied first person, not literal I/My.",
    roast: "You wrote {evidence} in first person. Drop the I/My/We and lead with the verb.",
    evidenceHint: "count plus example, e.g. 3 bullets start with I or My",
    sample: "3 bullets start with I or My",
  },
  {
    id: "passive_voice",
    severity: "minor",
    source: "code",
    title: "Passive voice bullets",
    definition:
      "Flag when 2+ Work Experience bullets use passive phrasing (Was responsible for, Were tasked with, Duties included). Do not flag Was promoted lines. Active voice reads stronger.",
    roast: "{evidence}. Rewrite in active voice: what did YOU do, not what you were assigned.",
    evidenceHint: "count plus one example passive phrase",
    sample: "2 passive bullets: Was responsible for daily operations",
  },
  {
    id: "present_tense_past_roles",
    severity: "minor",
    source: "vision",
    title: "Present tense on past jobs",
    requiresProof: true,
    definition:
      "Flag when 2+ bullets under a PAST role (ended before Present) use present-tense openers (Manage, Lead, Develop) instead of past tense (Managed, Led, Developed). Current/Present roles may use present tense.",
    roast: "{evidence} uses present tense for a job that already ended. Past roles need past-tense bullets.",
    evidenceHint: "role name + count, e.g. Acme Corp 2018-2020, 3 present-tense bullets",
    sample: "Acme Corp, 3 present-tense bullets",
  },
];

const SEV_WEIGHT = { critical: 14, major: 8, minor: 4 };
const ISSUE_PENALTY = { half_blank_page: 20 };
const SEV_ICON = { critical: "🔴", major: "🟠", minor: "🟡" };

function penaltyFor(issue) {
  return ISSUE_PENALTY[issue.id] ?? SEV_WEIGHT[issue.severity] ?? 0;
}

const SEV_RANK = { critical: 0, major: 1, minor: 2 };

function compareIssues(a, b, evidence = {}) {
  const ra = SEV_RANK[a.severity] ?? 9;
  const rb = SEV_RANK[b.severity] ?? 9;
  if (ra !== rb) return ra - rb;
  return penaltyFor(b, evidence[b.id]) - penaltyFor(a, evidence[a.id]);
}

function verdictFor(count) {
  if (count >= 12) return { title: "CERTIFIED DISASTER", tone: "This is one of the worst we've scanned." };
  if (count >= 8) return { title: "IT'S REALLY BAD", tone: "Im not surprised you aren't getting the traction you want." };
  if (count >= 5) return { title: "IT'S BAD", tone: "Fixable but right now it's costing you interviews." };
  return { title: "IT'S MEDIOCRE", tone: "Not a dumpster fire, but it won't make anyone stop scrolling." };
}

function verdictForNotResume() {
  return {
    title: "That ain't a resume, nice try",
    tone: "Upload a real resume if you want the autopsy.",
  };
}

function scoreFor(found, evidence = {}) {
  const penalty = found.reduce((s, i) => s + penaltyFor(i, evidence[i.id]), 0);
  return Math.max(9, 100 - penalty);
}

function crispPageTarget(numPages) {
  const target = Math.max(1, (numPages || 2) - 1);
  if (target === 1) return "one pager";
  if (target === 2) return "two pager";
  if (target === 3) return "three pager";
  if (target === 4) return "four pager";
  if (target === 5) return "five pager";
  return `${target}-page resume`;
}

function normalizeCrispPageEvidence(evidence) {
  const e = String(evidence || "").trim();
  if (!e) return "one pager";
  const wordPager = e.match(/\b(one|two|three|four|five)\s+pager\b/i);
  if (wordPager) return wordPager[0].toLowerCase();
  const digitPager = e.match(/\b(\d+)[- ]pager\b/i);
  if (digitPager) return crispPageTarget(parseInt(digitPager[1], 10) + 1);
  const pageNum = e.match(/page\s*(\d+)/i);
  if (pageNum) return crispPageTarget(parseInt(pageNum[1], 10));
  const pageCount = e.match(/(\d+)\s*pages?\b/i);
  if (pageCount) return crispPageTarget(parseInt(pageCount[1], 10));
  return e;
}

function stripEmDash(s) {
  return String(s == null ? "" : s)
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[—–]/g, "-")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function evidenceDisplayQuote(issueId, evidence) {
  let q = String(evidence == null ? "" : evidence)
    .trim()
    .replace(/\s+/g, " ");
  if (!q) return "";
  if (issueId === "half_blank_page") return normalizeCrispPageEvidence(q);
  const outer = q.match(/^["'](.+)["']$/);
  if (outer) return outer[1];
  return q;
}

function renderRoast(issue, evidence) {
  const roast = issue.roast || "";
  let out;
  if (!roast.includes("{evidence}")) {
    out = roast;
  } else {
    const q = evidenceDisplayQuote(issue.id, evidence);
    if (q) {
      out = roast.replace(/\{evidence\}/g, q);
    } else {
      const fallbacks = {
        weak_verbs: "the same verb",
        too_long: "too many pages",
        half_blank_page: "one pager",
        orphan_line: "a line",
        buzzwords: "generic buzzwords",
        multi_column: "multi-column layout",
        too_many_bullets: "One role",
        bold_bullet_overuse: "Every bullet",
        skill_dump: "a long keyword list",
        typos: "a typo",
        date_gaps: "a role with fuzzy dates",
        irrelevant_certs: "an off-target cert or course",
        bad_summary: "generic filler",
        no_summary: "no intro at the top",
        keyword_spam: "Skills",
        volunteer_on_resume: "Volunteering",
        thin_education: "Education",
        no_metrics: "a vague bullet",
        full_url_links: "your LinkedIn",
        publications_on_resume: "Publications",
        stale_experience: "an old role",
        overlapping_experience: "overlapping dates",
        promotions: "that company",
        unprofessional_email: "that email",
        first_person: "first-person bullets",
        passive_voice: "passive voice",
        present_tense_past_roles: "a past role",
        irrelevant_old: "your high school",
      };
      const fallback = fallbacks[issue.id] || "that";
      out = roast.replace(/["“”']?\{evidence\}["“”']?/g, fallback);
    }
  }
  return stripEmDash(out);
}

function mockAnalyze(file) {
  const seedStr = (file?.name || "resume") + (file?.size || 0);
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const guaranteed = ["no_metrics", "too_many_bullets", "bad_summary"];
  const pool = ISSUES.map((i) => i.id).filter((id) => !guaranteed.includes(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const extra = 5 + Math.floor(rand() * 7);
  const chosenIds = guaranteed.concat(pool.slice(0, extra));
  const evidence = {};
  ISSUES.filter((i) => chosenIds.includes(i.id)).forEach((i) => {
    if (i.sample) evidence[i.id] = i.sample;
  });
  const found = ISSUES.filter((i) => chosenIds.includes(i.id)).sort((a, b) =>
    compareIssues(a, b, evidence)
  );

  return {
    score: scoreFor(found, evidence),
    verdict: verdictFor(found.length),
    found,
    evidence,
    total: ISSUES.length,
  };
}

if (typeof window !== "undefined") {
  window.ROAST = {
    ISSUES,
    SEV_WEIGHT,
    ISSUE_PENALTY,
    penaltyFor,
    compareIssues,
    crispPageTarget,
    normalizeCrispPageEvidence,
    evidenceDisplayQuote,
    SEV_ICON,
    verdictFor,
    verdictForNotResume,
    scoreFor,
    renderRoast,
    stripEmDash,
    mockAnalyze,
  };
}
if (typeof module !== "undefined") {
  module.exports = {
    ISSUES,
    SEV_WEIGHT,
    ISSUE_PENALTY,
    penaltyFor,
    compareIssues,
    crispPageTarget,
    normalizeCrispPageEvidence,
    evidenceDisplayQuote,
    SEV_ICON,
    verdictFor,
    verdictForNotResume,
    scoreFor,
    renderRoast,
    stripEmDash,
    mockAnalyze,
  };
}
