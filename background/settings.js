const SETTINGS_KEY = "extensionSettings";
const DEFAULT_SUBMIT_DELAY_MS = 15000;
const DEFAULT_SHOWZ_REPLY_DELAY_MS = 10000;
const MIN_SUBMIT_DELAY_MS = 1000;
const MAX_SUBMIT_DELAY_MS = 120000;

const DEFAULT_COMMENT_RULES = `You write a single product-page comment only. Rules:
- Do not use the web or claim you searched.
- At most 2 sentences. English only.
- Casual tone. No em dashes (—), no en dashes as punctuation drama, no bullet points or list formatting.
- Do not address or mention any username. Never use OneMaster or One-Master.
- Write a new top-level comment, not a reply to anyone.
- Do not repeat the same points or claims already made in OTHER_COMMENTS; find a fresh angle consistent with the same general vibe.
- Do not write anything that suggests you already own the item or have seen it in person.
- Do not use phrases like "Curious to see how".
- Avoid the word "silhouette"; use more casual wording instead.
- Output ONLY the comment text, nothing else. No quotes around it.`;

const DEFAULT_AUTO_LIKE_USERS = ["keng"];

const DEFAULT_SHOWZ_REPLY_RULES = `You write a single reply to an existing product comment. Rules:
- Be informed based on the product description and other comments on the page.
- Not political.
- Do not use em dashes or en dashes as punctuation.
- Positive tone; agree with the original comment when possible.
- When possible, add helpful extra context about the product from the page.
- At most 2 sentences. English only.
- Casual tone. No bullet points or list formatting.
- Do not address or mention any username.
- Output ONLY the reply text, nothing else. No quotes around it.`;

function isPlaceholderApiKey(key) {
  return !key || /your_api_key_here/i.test(key);
}

function maskApiKey(key) {
  if (!key || isPlaceholderApiKey(key)) return "(not set)";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function normalizeAutoLikeUsers(users) {
  if (!Array.isArray(users)) return [...DEFAULT_AUTO_LIKE_USERS];
  const normalized = users
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  return normalized.length ? normalized : [...DEFAULT_AUTO_LIKE_USERS];
}

function parseAutoLikeUsersText(text) {
  const users = String(text || "")
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  return normalizeAutoLikeUsers(users);
}

function formatAutoLikeUsersForInput(users) {
  return normalizeAutoLikeUsers(users).join("\n");
}

async function getSettings() {
  const data = await browser.storage.local.get(SETTINGS_KEY);
  const stored = data[SETTINGS_KEY] || {};
  return {
    commentRules: stored.commentRules || DEFAULT_COMMENT_RULES,
    showzReplyRules: stored.showzReplyRules || DEFAULT_SHOWZ_REPLY_RULES,
    submitDelayMs: stored.submitDelayMs ?? DEFAULT_SUBMIT_DELAY_MS,
    showzReplyDelayMs: stored.showzReplyDelayMs ?? DEFAULT_SHOWZ_REPLY_DELAY_MS,
    apiKey: stored.apiKey || "",
    autoLikeUsers: normalizeAutoLikeUsers(stored.autoLikeUsers),
  };
}

async function getEffectiveApiKey() {
  const settings = await getSettings();
  const stored = settings.apiKey.trim();
  if (!isPlaceholderApiKey(stored)) return stored;

  const configKey =
    typeof CURSOR_CONFIG !== "undefined" ? CURSOR_CONFIG.apiKey || "" : "";
  if (!isPlaceholderApiKey(configKey)) return configKey.trim();

  return "";
}

async function getSettingsForPopup() {
  const settings = await getSettings();
  const effectiveKey = await getEffectiveApiKey();
  const storedKey = settings.apiKey.trim();

  return {
    commentRules: settings.commentRules,
    showzReplyRules: settings.showzReplyRules,
    submitDelaySeconds: Math.round(settings.submitDelayMs / 1000),
    showzReplyDelaySeconds: Math.round(settings.showzReplyDelayMs / 1000),
    autoLikeUsers: settings.autoLikeUsers,
    autoLikeUsersText: formatAutoLikeUsersForInput(settings.autoLikeUsers),
    apiKey: effectiveKey,
    apiKeyMasked: maskApiKey(effectiveKey),
    apiKeySource: !isPlaceholderApiKey(storedKey)
      ? "saved"
      : !isPlaceholderApiKey(
            typeof CURSOR_CONFIG !== "undefined" ? CURSOR_CONFIG.apiKey : ""
          )
        ? "config"
        : "none",
  };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current };

  if (partial.commentRules !== undefined) {
    next.commentRules = String(partial.commentRules).trim() || DEFAULT_COMMENT_RULES;
  }

  if (partial.showzReplyRules !== undefined) {
    next.showzReplyRules =
      String(partial.showzReplyRules).trim() || DEFAULT_SHOWZ_REPLY_RULES;
  }

  if (partial.submitDelaySeconds !== undefined) {
    const seconds = Number(partial.submitDelaySeconds);
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : DEFAULT_SUBMIT_DELAY_MS;
    next.submitDelayMs = Math.max(
      MIN_SUBMIT_DELAY_MS,
      Math.min(MAX_SUBMIT_DELAY_MS, ms)
    );
  }

  if (partial.showzReplyDelaySeconds !== undefined) {
    const seconds = Number(partial.showzReplyDelaySeconds);
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : DEFAULT_SHOWZ_REPLY_DELAY_MS;
    next.showzReplyDelayMs = Math.max(
      MIN_SUBMIT_DELAY_MS,
      Math.min(MAX_SUBMIT_DELAY_MS, ms)
    );
  }

  if (partial.apiKey !== undefined) {
    next.apiKey = String(partial.apiKey).trim();
  }

  if (partial.autoLikeUsers !== undefined) {
    next.autoLikeUsers = normalizeAutoLikeUsers(partial.autoLikeUsers);
  }

  if (partial.autoLikeUsersText !== undefined) {
    next.autoLikeUsers = parseAutoLikeUsersText(partial.autoLikeUsersText);
  }

  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function resetSettings() {
  await browser.storage.local.set({
    [SETTINGS_KEY]: {
      commentRules: DEFAULT_COMMENT_RULES,
      showzReplyRules: DEFAULT_SHOWZ_REPLY_RULES,
      submitDelayMs: DEFAULT_SUBMIT_DELAY_MS,
      showzReplyDelayMs: DEFAULT_SHOWZ_REPLY_DELAY_MS,
      apiKey: "",
      autoLikeUsers: [...DEFAULT_AUTO_LIKE_USERS],
    },
  });
}
