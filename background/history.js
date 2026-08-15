const HISTORY_KEY = "productHistory";
const COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000;

async function getHistory() {
  const data = await browser.storage.local.get(HISTORY_KEY);
  return data[HISTORY_KEY] || {};
}

async function addToHistory(url, meta = {}) {
  const history = await getHistory();
  const normalizedUrl = normalizeHistoryUrl(url);
  const previous = history[normalizedUrl] || history[url] || {};
  history[normalizedUrl] = {
    timestamp: Date.now(),
    title: meta.title || previous.title || "",
    site: meta.site || previous.site || "",
    comment: meta.comment ?? previous.comment ?? "",
  };
  if (normalizedUrl !== url && history[url]) {
    delete history[url];
  }
  await browser.storage.local.set({ [HISTORY_KEY]: history });
}

function normalizeHistoryUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${path}`;
  } catch (_) {
    return url;
  }
}

function formatProductLabel(url, title) {
  if (title) return title;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || url;
  } catch (_) {
    return url;
  }
}

async function getRecentHistoryEntries() {
  await clearExpiredHistory();
  const history = await getHistory();
  const now = Date.now();

  return Object.entries(history)
    .filter(([, entry]) => now - entry.timestamp < COOLDOWN_MS)
    .map(([url, entry]) => ({
      url,
      title: formatProductLabel(url, entry.title),
      site: entry.site || "",
      comment: entry.comment || "",
      timestamp: entry.timestamp,
      commentedAt: new Date(entry.timestamp).toLocaleString(),
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

async function isOnCooldown(url) {
  const history = await getHistory();
  const entry = history[url];
  if (!entry) return false;
  return Date.now() - entry.timestamp < COOLDOWN_MS;
}

async function clearExpiredHistory() {
  const history = await getHistory();
  const now = Date.now();
  let changed = false;
  for (const [url, entry] of Object.entries(history)) {
    if (now - entry.timestamp >= COOLDOWN_MS) {
      delete history[url];
      changed = true;
    }
  }
  if (changed) {
    await browser.storage.local.set({ [HISTORY_KEY]: history });
  }
}
