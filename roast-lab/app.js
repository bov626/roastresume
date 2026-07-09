/* Roast Lab — landing page controller. Captures info, hands off to results.html. */

let pendingFile = null;
let gateEnabled = false;

function openModal() {
  document.getElementById("overlay").classList.add("open");
  document.body.style.overflow = "hidden";
  document.getElementById("err").textContent = "";
  document.getElementById("gate-err").textContent = "";
  pendingFile = null;
  document.getElementById("f-file").value = "";
  resetDrop();
  const btn = document.getElementById("submit-btn");
  btn.disabled = false;
  btn.textContent = "Scan my resume";
  syncGatePanels();
}

function closeModal() {
  document.getElementById("overlay").classList.remove("open");
  document.body.style.overflow = "";
}

function clearErr() {
  document.getElementById("err").textContent = "";
}

function syncGatePanels() {
  const gatePanel = document.getElementById("gate-panel");
  const uploadPanel = document.getElementById("upload-panel");
  const unlocked = !gateEnabled || window.COMMUNITY_GATE?.hasCommunityAccess?.();
  gatePanel.hidden = unlocked;
  uploadPanel.hidden = !unlocked;
}

async function refreshGateStatus() {
  if (!window.COMMUNITY_GATE?.fetchGateStatus) {
    gateEnabled = false;
    return;
  }
  try {
    const status = await window.COMMUNITY_GATE.fetchGateStatus();
    gateEnabled = !!status.gateEnabled;
    const link = document.getElementById("gate-skool-link");
    if (link && status.skoolUrl) link.href = status.skoolUrl;
  } catch {
    gateEnabled = false;
  }
}

async function unlockCommunity() {
  const err = document.getElementById("gate-err");
  const btn = document.getElementById("gate-unlock-btn");
  const code = document.getElementById("gate-code").value.trim();
  err.textContent = "";
  if (!code) {
    err.textContent = "Enter your member access code.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    await window.COMMUNITY_GATE.verifyCommunityCode(code);
    syncGatePanels();
  } catch (e) {
    err.textContent = e.message || "Could not verify access code.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Unlock scan";
  }
}

function resetDrop() {
  const drop = document.getElementById("drop");
  drop.classList.remove("has-file");
  document.getElementById("drop-icon").style.display = "";
  document.getElementById("drop-main").style.display = "";
  document.getElementById("drop-sub").style.display = "";
  const fn = document.getElementById("drop-filename");
  fn.style.display = "none";
  fn.textContent = "";
}

function showFilePicked(name) {
  const drop = document.getElementById("drop");
  drop.classList.add("has-file");
  document.getElementById("drop-icon").style.display = "none";
  document.getElementById("drop-main").style.display = "none";
  document.getElementById("drop-sub").style.display = "none";
  const fn = document.getElementById("drop-filename");
  fn.style.display = "block";
  fn.textContent = "✓ " + name;
  clearErr();
}

function isPdfFile(file) {
  if (!file) return false;
  return /\.pdf$/i.test(file.name) || file.type === "application/pdf";
}

function rejectNonPdf(file) {
  if (isPdfFile(file)) return true;
  pendingFile = null;
  document.getElementById("f-file").value = "";
  resetDrop();
  document.getElementById("err").textContent =
    "PDF only. Export your resume as a PDF and try again.";
  return false;
}

function handleFile(input) {
  if (!input.files.length) return;
  const file = input.files[0];
  if (!rejectNonPdf(file)) return;
  pendingFile = file;
  showFilePicked(pendingFile.name);
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById("drop").classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!rejectNonPdf(file)) return;
  pendingFile = file;
  showFilePicked(file.name);
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function startRoast() {
  const err = document.getElementById("err");
  if (gateEnabled && !window.COMMUNITY_GATE?.hasCommunityAccess?.()) {
    syncGatePanels();
    return (err.textContent = "Unlock the scan with your community access code first.");
  }
  if (!pendingFile) return (err.textContent = "Upload your resume first.");
  if (!isPdfFile(pendingFile)) {
    return (err.textContent = "PDF only. Export your resume as a PDF and try again.");
  }

  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  btn.textContent = "Uploading…";

  const meta = {
    filename: pendingFile.name,
    mimetype: pendingFile.type,
    size: pendingFile.size,
  };
  sessionStorage.setItem("roast:meta", JSON.stringify(meta));

  try {
    const dataUrl = await readAsDataURL(pendingFile);
    sessionStorage.setItem("roast:file", dataUrl);
  } catch (e) {
    console.warn("Could not stash file (too large?). Preview will be skipped.", e);
    sessionStorage.removeItem("roast:file");
  }

  window.location.href = "results.html";
}

document.getElementById("gate-unlock-btn")?.addEventListener("click", unlockCommunity);
document.getElementById("gate-code")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlockCommunity();
});

refreshGateStatus().then(syncGatePanels);

window.openModal = openModal;
window.closeModal = closeModal;
window.clearErr = clearErr;
window.handleFile = handleFile;
window.handleDrop = handleDrop;
window.startRoast = startRoast;
