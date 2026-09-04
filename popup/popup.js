const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const gundamitOneBtn = document.getElementById("gundamitOneBtn");
const chowbrickOneBtn = document.getElementById("chowbrickOneBtn");
const showzBtn = document.getElementById("showzBtn");
const stopAgentBtn = document.getElementById("stopAgentBtn");
const assistBtn = document.getElementById("assistBtn");
const assistStopBtn = document.getElementById("assistStopBtn");
const assistPanel = document.getElementById("assistPanel");
const desktopActions = document.getElementById("desktopActions");
const desktopSiteActions = document.getElementById("desktopSiteActions");
const clearLogBtn = document.getElementById("clearLogBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const settingsBtn = document.getElementById("settingsBtn");
const backBtn = document.getElementById("backBtn");
const mainView = document.getElementById("mainView");
const settingsView = document.getElementById("settingsView");
const settingsForm = document.getElementById("settingsForm");
const apiKeyInput = document.getElementById("apiKeyInput");
const apiKeyMeta = document.getElementById("apiKeyMeta");
const toggleApiKeyBtn = document.getElementById("toggleApiKeyBtn");
const promptRulesInput = document.getElementById("promptRulesInput");
const showzReplyRulesInput = document.getElementById("showzReplyRulesInput");
const submitDelayInput = document.getElementById("submitDelayInput");
const showzReplyDelayInput = document.getElementById("showzReplyDelayInput");
const autoLikeUsersInput = document.getElementById("autoLikeUsersInput");
const resetSettingsBtn = document.getElementById("resetSettingsBtn");
const settingsStatus = document.getElementById("settingsStatus");
const commentHistoryList = document.getElementById("commentHistoryList");
const versionLabel = document.getElementById("versionLabel");

if (versionLabel) {
  versionLabel.textContent = `v${browser.runtime.getManifest().version}`;
}

const UI_LOG_KEY = "uiLogs";
const UI_STATUS_KEY = "uiStatus";

let isAndroidUi = false;

function applyPlatformUi(android) {
  isAndroidUi = android;
  document.body.classList.toggle("android-mode", android);

  if (android) {
    desktopActions?.classList.add("hidden");
    desktopSiteActions?.classList.add("hidden");
    assistPanel?.classList.remove("hidden");
  }
}

async function initPlatformUi() {
  try {
    const platform = await browser.runtime.getPlatformInfo();
    applyPlatformUi(platform.os === "android");
  } catch (_) {
    applyPlatformUi(false);
  }
}

function setStatus(status, detail) {
  statusEl.className = `status ${status}`;
  const label = detail ? `${status}: ${detail}` : status;
  const textEl = statusEl.querySelector(".status-text");
  if (textEl) {
    textEl.textContent = label;
  } else {
    statusEl.textContent = label;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addLogEntry(entry) {
  const line = document.createElement("div");
  line.className = "log-entry";
  line.innerHTML = `<span class="time">[${escapeHtml(entry.time)}]</span>${escapeHtml(entry.message)}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderLogs(logs) {
  logEl.innerHTML = "";
  for (const entry of logs) {
    addLogEntry(entry);
  }
}

function setAgentActive(active) {
  if (stopAgentBtn) {
    stopAgentBtn.disabled = !active;
  }
}

function setRunning(running) {
  startBtn.disabled = running;
  gundamitOneBtn.disabled = running;
  chowbrickOneBtn.disabled = running;
  showzBtn.disabled = running;
  assistBtn.disabled = running;
  stopBtn.disabled = !running;
  assistStopBtn?.classList.toggle("hidden", !running || !isAndroidUi);
}

function showMainView() {
  mainView.classList.remove("hidden");
  settingsView.classList.add("hidden");
}

function showSettingsView() {
  mainView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  loadSettingsForm();
}

function setSettingsStatus(message, isError = false) {
  settingsStatus.textContent = message;
  settingsStatus.style.color = isError ? "var(--danger)" : "var(--success)";
}

function apiKeySourceLabel(source) {
  if (source === "saved") return "Using key saved in extension settings.";
  if (source === "config") return "Using key from background/config.js.";
  return "No API key configured.";
}

async function renderCommentHistory() {
  const response = await browser.runtime.sendMessage({ type: "GET_HISTORY" });
  const entries = response?.entries || [];

  if (!entries.length) {
    commentHistoryList.innerHTML =
      '<p class="comment-history-empty">No comments in the last 4 days.</p>';
    return;
  }

  commentHistoryList.innerHTML = entries
    .map(
      (entry) => `
        <div class="comment-history-item">
          <span class="comment-history-title">${escapeHtml(entry.title)}</span>
          <span class="comment-history-meta">
            ${entry.site ? `${escapeHtml(entry.site)} · ` : ""}${escapeHtml(entry.commentedAt)}
          </span>
          ${
            entry.comment
              ? `<div class="comment-history-text">${escapeHtml(entry.comment)}</div>`
              : ""
          }
          <a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.url)}</a>
        </div>
      `
    )
    .join("");
}

async function loadSettingsForm() {
  const settings = await browser.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!settings) return;

  apiKeyInput.value = settings.apiKey || "";
  apiKeyMeta.textContent = `${apiKeySourceLabel(settings.apiKeySource)} Active: ${settings.apiKeyMasked}`;
  promptRulesInput.value = settings.commentRules || "";
  showzReplyRulesInput.value = settings.showzReplyRules || "";
  autoLikeUsersInput.value = settings.autoLikeUsersText || "";
  submitDelayInput.value = settings.submitDelaySeconds ?? 15;
  showzReplyDelayInput.value = settings.showzReplyDelaySeconds ?? 10;
  apiKeyInput.type = "password";
  toggleApiKeyBtn.textContent = "Show";
  setSettingsStatus("");
  await renderCommentHistory();
}

const CURSOR_ORIGINS = ["https://api.cursor.com/"];

function beginShowZRun() {
  browser.runtime.sendMessage({ type: "START_SHOWZ" });
}

function startShowZWithPermission() {
  setRunning(true);
  setStatus("running", "ShowZ starting...");

  browser.permissions
    .request({ origins: CURSOR_ORIGINS })
    .then((granted) => {
      if (!granted) {
        denyPermission();
        return;
      }
      beginShowZRun();
    })
    .catch(() => {
      denyPermission();
    });
}

function beginAssist() {
  browser.runtime.sendMessage({ type: "START_ASSIST" });
}

function startAssistWithPermission() {
  setRunning(true);
  setStatus("running", "Assist starting...");

  browser.permissions
    .request({ origins: CURSOR_ORIGINS })
    .then((granted) => {
      if (!granted) {
        denyPermission();
        return;
      }
      beginAssist();
    })
    .catch(() => {
      denyPermission();
    });
}

function beginRun(options = {}) {
  browser.runtime.sendMessage({
    type: "START_RUN",
    siteKey: options.siteKey || null,
    commentsPerSite: options.commentsPerSite || 2,
  });
}

function startRunWithPermission(options = {}) {
  setRunning(true);
  setStatus("running", "Starting...");

  browser.permissions
    .request({ origins: CURSOR_ORIGINS })
    .then((granted) => {
      if (!granted) {
        denyPermission();
        return;
      }
      beginRun(options);
    })
    .catch(() => {
      denyPermission();
    });
}

function denyPermission() {
  addLogEntry({
    time: new Date().toLocaleTimeString(),
    message:
      "Cursor API permission denied. Enable api.cursor.com in about:addons → CommentExt → Permissions.",
  });
  setRunning(false);
  setStatus("error", "Cursor API permission required");
}

async function loadPersistedState() {
  const state = await browser.runtime.sendMessage({ type: "GET_STATE" });
  if (!state) return;

  if (state.logs?.length) {
    renderLogs(state.logs);
  }

  if (state.status) {
    setStatus(state.status, state.detail);
    setRunning(state.status === "running");
  }

  if (state.isAndroid) {
    applyPlatformUi(true);
  }

  if (typeof state.agentActive === "boolean") {
    setAgentActive(state.agentActive);
  }
}

startBtn.addEventListener("click", () => {
  startRunWithPermission({ commentsPerSite: 2 });
});

gundamitOneBtn.addEventListener("click", () => {
  startRunWithPermission({ siteKey: "gundamit", commentsPerSite: 1 });
});

chowbrickOneBtn.addEventListener("click", () => {
  startRunWithPermission({ siteKey: "chowbrick", commentsPerSite: 1 });
});

showzBtn.addEventListener("click", () => {
  startShowZWithPermission();
});

stopAgentBtn?.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "STOP_AGENT" }).then((response) => {
    setAgentActive(!!response?.active);
    setStatus("idle", "Agent stopped");
  });
});

assistBtn.addEventListener("click", () => {
  startAssistWithPermission();
});

assistStopBtn?.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "STOP_RUN" });
  setStatus("running", "Stopping...");
});

stopBtn.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "STOP_RUN" });
  setStatus("running", "Stopping...");
});

clearLogBtn.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "CLEAR_LOGS" });
  logEl.innerHTML = "";
});

clearHistoryBtn.addEventListener("click", async () => {
  if (!confirm("Clear all product history?")) return;
  await browser.runtime.sendMessage({ type: "CLEAR_HISTORY" });
  addLogEntry({ time: new Date().toLocaleTimeString(), message: "History cleared." });
  if (!settingsView.classList.contains("hidden")) {
    await renderCommentHistory();
  }
});

settingsBtn.addEventListener("click", () => {
  showSettingsView();
});

backBtn.addEventListener("click", () => {
  showMainView();
});

toggleApiKeyBtn.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
  toggleApiKeyBtn.textContent = showing ? "Show" : "Hide";
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setSettingsStatus("Saving...");

  const response = await browser.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: {
      apiKey: apiKeyInput.value.trim(),
      commentRules: promptRulesInput.value,
      showzReplyRules: showzReplyRulesInput.value,
      autoLikeUsersText: autoLikeUsersInput.value,
      submitDelaySeconds: Number(submitDelayInput.value),
      showzReplyDelaySeconds: Number(showzReplyDelayInput.value),
    },
  });

  if (response?.error) {
    setSettingsStatus(response.error, true);
    return;
  }

  if (response?.settings) {
    apiKeyMeta.textContent = `${apiKeySourceLabel(response.settings.apiKeySource)} Active: ${response.settings.apiKeyMasked}`;
  }

  setSettingsStatus("Settings saved.");
});

resetSettingsBtn.addEventListener("click", async () => {
  if (!confirm("Reset all settings to defaults?")) return;

  const response = await browser.runtime.sendMessage({ type: "RESET_SETTINGS" });
  if (response?.settings) {
    apiKeyInput.value = response.settings.apiKey || "";
    apiKeyMeta.textContent = `${apiKeySourceLabel(response.settings.apiKeySource)} Active: ${response.settings.apiKeyMasked}`;
    promptRulesInput.value = response.settings.commentRules || "";
    showzReplyRulesInput.value = response.settings.showzReplyRules || "";
    autoLikeUsersInput.value = response.settings.autoLikeUsersText || "";
    submitDelayInput.value = response.settings.submitDelaySeconds ?? 15;
    showzReplyDelayInput.value = response.settings.showzReplyDelaySeconds ?? 10;
  }
  setSettingsStatus("Defaults restored.");
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type === "LOG" && message.entry) {
    addLogEntry(message.entry);
  }
  if (message.type === "STATUS") {
    setStatus(message.status, message.detail);
    setRunning(message.status === "running");
  }
  if (message.type === "AGENT_STATUS") {
    setAgentActive(!!message.active);
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes[UI_LOG_KEY]?.newValue) {
    renderLogs(changes[UI_LOG_KEY].newValue);
  }

  if (changes[UI_STATUS_KEY]?.newValue) {
    const { status, detail } = changes[UI_STATUS_KEY].newValue;
    setStatus(status, detail);
    setRunning(status === "running");
  }
});

loadPersistedState();
initPlatformUi();
