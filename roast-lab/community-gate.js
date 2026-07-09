/*
 * Community gate — scan/roast is members-only when ROAST_COMMUNITY_GATE=1.
 * Members get an access code in Skool; server issues a signed token after verify.
 */

const SKOOL_COMMUNITY_URL =
  (typeof process !== "undefined" && process.env?.ROAST_SKOOL_URL) ||
  "https://www.skool.com/remote/about";

const STORAGE_KEY = "roast:communityAccess";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isGateEnabled() {
  if (typeof process !== "undefined" && process.env) {
    return process.env.ROAST_COMMUNITY_GATE === "1";
  }
  return false;
}

function allowedCodes() {
  const raw = (typeof process !== "undefined" && process.env?.ROAST_COMMUNITY_CODES) || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function signingSecret() {
  if (typeof process === "undefined" || !process.env) return "roast-lab-dev-secret";
  return process.env.ROAST_COMMUNITY_SECRET || process.env.ANTHROPIC_API_KEY || "roast-lab-dev-secret";
}

function issueToken() {
  const crypto = require("crypto");
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = JSON.stringify({ exp, v: 1 });
  const sig = crypto.createHmac("sha256", signingSecret()).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ exp, sig })).toString("base64url");
}

function verifyToken(token) {
  if (!isGateEnabled()) return true;
  if (!token || typeof token !== "string") return false;
  try {
    const crypto = require("crypto");
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const { exp, sig } = parsed;
    if (!exp || !sig || Date.now() > exp) return false;
    const payload = JSON.stringify({ exp, v: 1 });
    const expected = crypto.createHmac("sha256", signingSecret()).update(payload).digest("hex");
    if (sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyAccessCode(code) {
  if (!isGateEnabled()) {
    return { ok: true, token: issueToken(), exp: Date.now() + TOKEN_TTL_MS };
  }
  const codes = allowedCodes();
  if (!codes.length) {
    return { ok: false, error: "Community access is not configured on the server." };
  }
  const trimmed = String(code || "").trim();
  if (!trimmed) return { ok: false, error: "Enter your community access code." };
  const ok = codes.includes(trimmed);
  if (!ok) return { ok: false, error: "That access code is not valid." };
  const exp = Date.now() + TOKEN_TTL_MS;
  return { ok: true, token: issueToken(), exp };
}

function gateStatus() {
  return {
    gateEnabled: isGateEnabled(),
    skoolUrl: SKOOL_COMMUNITY_URL,
  };
}

function readStoredAccess() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.token || !data?.exp || Date.now() > data.exp) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function storeAccess(token, exp) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ token, exp: exp || Date.now() + TOKEN_TTL_MS })
  );
}

function clearStoredAccess() {
  localStorage.removeItem(STORAGE_KEY);
}

function getAccessToken() {
  return readStoredAccess()?.token || null;
}

function hasCommunityAccess() {
  return !!getAccessToken();
}

async function fetchGateStatus() {
  const res = await fetch("/api/community/status");
  if (!res.ok) return { gateEnabled: false, skoolUrl: SKOOL_COMMUNITY_URL };
  return res.json();
}

async function verifyCommunityCode(code) {
  const res = await fetch("/api/community/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Could not verify access code.");
  }
  storeAccess(data.token, data.exp);
  return data.token;
}

function authHeaders() {
  const token = getAccessToken();
  return token ? { "X-Roast-Access-Token": token } : {};
}

const browserApi = {
  SKOOL_COMMUNITY_URL,
  STORAGE_KEY,
  readStoredAccess,
  storeAccess,
  clearStoredAccess,
  getAccessToken,
  hasCommunityAccess,
  fetchGateStatus,
  verifyCommunityCode,
  authHeaders,
};

const serverApi = {
  SKOOL_COMMUNITY_URL,
  isGateEnabled,
  allowedCodes,
  issueToken,
  verifyToken,
  verifyAccessCode,
  gateStatus,
};

if (typeof module !== "undefined") {
  module.exports = serverApi;
}
if (typeof window !== "undefined") {
  window.COMMUNITY_GATE = browserApi;
}
