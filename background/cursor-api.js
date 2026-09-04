const CURSOR_API_BASE = "https://api.cursor.com/v1";
const CURSOR_API_ORIGIN = "https://api.cursor.com/";
const CURSOR_POLL_INTERVAL_MS = 2000;
const CURSOR_RUN_TIMEOUT_MS = 300000;
const CURSOR_CREATE_TIMEOUT_MS = 300000;
const CURSOR_HEARTBEAT_MS = 15000;
const CURSOR_RUNNING_TIMEOUT_MS = 120000;
const CURSOR_RUN_MAX_ATTEMPTS = 3;
const CURSOR_ACTIVE_STATUSES = new Set(["CREATING", "RUNNING"]);

const AGENT_STORAGE_KEY = "cursorCommentAgentId";
const COMMENT_AGENT_NAME = "CommentExt";

let commentAgentId = null;

async function loadStoredAgentId() {
  const data = await browser.storage.local.get(AGENT_STORAGE_KEY);
  return data[AGENT_STORAGE_KEY] || null;
}

async function storeAgentId(agentId) {
  if (agentId) {
    await browser.storage.local.set({ [AGENT_STORAGE_KEY]: agentId });
  } else {
    await browser.storage.local.remove(AGENT_STORAGE_KEY);
  }
}

async function hydrateCursorAgent() {
  if (commentAgentId) {
    if (await verifyAgentUsable(commentAgentId)) return commentAgentId;
    commentAgentId = null;
    await storeAgentId(null);
  }

  const storedId = await loadStoredAgentId();
  if (storedId && (await verifyAgentUsable(storedId))) {
    commentAgentId = storedId;
    return commentAgentId;
  }

  if (storedId) {
    await storeAgentId(null);
  }

  return null;
}

function isStaleAgentError(err) {
  const message = err?.message || "";
  return /404|410|not found|no longer exists/i.test(message);
}

function isActiveAgentStatus(status) {
  return String(status || "").toUpperCase() === "ACTIVE";
}

async function verifyAgentUsable(agentId) {
  if (!agentId) return false;
  try {
    const response = await cursorRequest(`/agents/${agentId}`, { timeout: 30000 });
    const agent = response?.agent || response;
    return isActiveAgentStatus(agent?.status);
  } catch (_) {
    return false;
  }
}

async function findExistingCommentAgent() {
  const storedId = await loadStoredAgentId();
  if (storedId && (await verifyAgentUsable(storedId))) {
    return storedId;
  }

  let cursor = null;
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({
      limit: "20",
      includeArchived: "false",
    });
    if (cursor) query.set("cursor", cursor);

    const list = await cursorRequest(`/agents?${query.toString()}`, {
      timeout: 30000,
    });
    const items = list?.items || [];

    for (const item of items) {
      if (item.name === COMMENT_AGENT_NAME && isActiveAgentStatus(item.status)) {
        return item.id;
      }
    }

    cursor = list?.nextCursor;
    if (!cursor) break;
  }

  return null;
}

function cleanGeneratedComment(text) {
  let cleaned = (text || "").trim();
  cleaned = cleaned.replace(
    /\s*(Copy|Regenerate|Good response|Bad response)\s*$/gi,
    ""
  );
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

async function getAuthHeaders() {
  const key = await getEffectiveApiKey();
  if (!key) {
    throw new Error(
      "Cursor API key is not set. Open Settings in the extension popup and add your API key."
    );
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

function httpRequest(url, options = {}) {
  const method = options.method || "GET";
  const headers = options.headers || {};
  const body = options.body ?? null;
  const timeout = options.timeout || CURSOR_CREATE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = timeout;

    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }

    const startedAt = Date.now();
    let heartbeatTimer = null;
    if (typeof options.onWaiting === "function") {
      heartbeatTimer = setInterval(() => {
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        options.onWaiting(elapsedSec);
      }, CURSOR_HEARTBEAT_MS);
    }

    const cleanup = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };

    xhr.onload = () => {
      cleanup();
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        responseText: xhr.responseText,
      });
    };

    xhr.onerror = () => {
      cleanup();
      reject(
        new Error(
          `NetworkError reaching Cursor API. In Firefox, open about:addons → CommentExt → Permissions and allow api.cursor.com.`
        )
      );
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(
        new Error(
          `Cursor API request timed out after ${Math.round(timeout / 1000)}s (${method} ${url})`
        )
      );
    };

    xhr.send(body);
  });
}

async function cursorRequest(path, options = {}) {
  const url = `${CURSOR_API_BASE}${path}`;
  const response = await httpRequest(url, {
    method: options.method || "GET",
    headers: {
      ...(await getAuthHeaders()),
      ...options.headers,
    },
    body: options.body ?? null,
    timeout: options.timeout,
    onWaiting: options.onWaiting,
  });

  if (!response.ok) {
    throw new Error(
      `Cursor API ${response.status}: ${(response.responseText || "").slice(0, 300)}`
    );
  }

  if (response.status === 204 || !response.responseText) return null;
  return JSON.parse(response.responseText);
}

async function ensureCursorPermissions() {
  const origins = [CURSOR_API_ORIGIN];
  const hasPermission = await browser.permissions.contains({ origins });
  if (hasPermission) return;

  throw new Error(
    "Cursor API access is not enabled. Click Start Run again and allow api.cursor.com, or enable it in about:addons → OneMaster CommentExt → Permissions."
  );
}

async function verifyCursorConnection() {
  await ensureCursorPermissions();
  await cursorRequest("/models", { timeout: 30000 });
}

function cursorModelPayload() {
  return {
    id: CURSOR_CONFIG.modelId,
    params: CURSOR_CONFIG.modelParams,
  };
}

async function pollCursorRun(agentId, runId, onLog) {
  const terminal = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);
  const start = Date.now();
  let lastStatus = "";
  let activeSince = null;

  while (Date.now() - start < CURSOR_RUN_TIMEOUT_MS) {
    if (typeof shouldStop === "function" && shouldStop()) {
      throw new Error("Stopped by user");
    }

    const run = await cursorRequest(`/agents/${agentId}/runs/${runId}`, {
      timeout: 30000,
    });
    const status = run.status;

    if (status !== lastStatus) {
      lastStatus = status;
      if (onLog) onLog(`Cursor run status: ${status}`);
      activeSince = CURSOR_ACTIVE_STATUSES.has(status) ? Date.now() : null;
    }

    if (activeSince && CURSOR_ACTIVE_STATUSES.has(status)) {
      const activeMs = Date.now() - activeSince;
      if (activeMs >= CURSOR_RUNNING_TIMEOUT_MS) {
        const err = new Error("CURSOR_RUNNING_TIMEOUT");
        err.agentId = agentId;
        err.runId = runId;
        throw err;
      }
    }

    if (terminal.has(status)) {
      if (status !== "FINISHED") {
        throw new Error(`Cursor run ended with status ${status}`);
      }
      const text = cleanGeneratedComment(run.result || "");
      if (!text) throw new Error("Cursor returned an empty comment");
      return text;
    }

    await sleep(CURSOR_POLL_INTERVAL_MS);
  }

  const err = new Error("CURSOR_POLL_TIMEOUT");
  err.agentId = agentId;
  err.runId = runId;
  throw err;
}

async function cancelCursorRun(agentId, runId, onLog) {
  if (!agentId || !runId) return;
  try {
    await cursorRequest(`/agents/${agentId}/runs/${runId}/cancel`, {
      method: "POST",
      timeout: 30000,
    });
    if (onLog) onLog("Cancelled stuck Cursor run.");
  } catch (_) {
    /* best effort */
  }
}

function isRetryableCursorError(err) {
  const message = err?.message || "";
  return (
    message === "CURSOR_RUNNING_TIMEOUT" ||
    message === "CURSOR_POLL_TIMEOUT" ||
    message === "Cursor returned an empty comment" ||
    /^Cursor run ended with status ERROR/i.test(message)
  );
}

async function beginCursorCommentRun(prompt, onLog) {
  await hydrateCursorAgent();
  let agentId = commentAgentId;
  let runId;

  if (!agentId) {
    const created = await createCommentAgent(prompt, onLog);
    agentId = created.agentId;
    runId = created.runId;
  } else {
    if (onLog) onLog("Sending prompt to Cursor agent...");
    try {
      const created = await cursorRequest(`/agents/${agentId}/runs`, {
        method: "POST",
        timeout: 60000,
        body: JSON.stringify({
          prompt: { text: prompt },
        }),
      });
      runId = created.run.id;
      if (onLog) onLog(`Cursor run started (${created.run.status}).`);
    } catch (err) {
      if (isStaleAgentError(err)) {
        commentAgentId = null;
        await storeAgentId(null);
        return beginCursorCommentRun(prompt, onLog);
      }
      throw err;
    }
  }

  return { agentId, runId };
}

async function createCommentAgent(prompt, onLog) {
  if (onLog) {
    onLog(
      "Creating Cursor cloud agent (first request usually takes 60-90 seconds)..."
    );
  }

  const created = await cursorRequest("/agents", {
    method: "POST",
    timeout: CURSOR_CREATE_TIMEOUT_MS,
    onWaiting: (elapsedSec) => {
      if (onLog) onLog(`Still provisioning Cursor agent... (${elapsedSec}s)`);
    },
    body: JSON.stringify({
      name: "CommentExt",
      prompt: { text: prompt },
      model: cursorModelPayload(),
    }),
  });

  commentAgentId = created.agent.id;
  await storeAgentId(commentAgentId);
  return {
    agentId: created.agent.id,
    runId: created.run.id,
  };
}

async function warmupCursorAgent(onLog) {
  await hydrateCursorAgent();
  if (commentAgentId) return;

  await ensureCursorPermissions();

  const existingId = await findExistingCommentAgent();
  if (existingId) {
    commentAgentId = existingId;
    await storeAgentId(existingId);
    if (onLog) onLog("Reusing active Cursor agent.");
    return;
  }

  const { agentId, runId } = await createCommentAgent(
    "Reply with exactly: ready",
    onLog
  );

  await pollCursorRun(agentId, runId, onLog);

  if (onLog) onLog("Cursor agent ready.");
}

async function startCursorCommentRun(prompt, onLog) {
  for (let attempt = 1; attempt <= CURSOR_RUN_MAX_ATTEMPTS; attempt += 1) {
    if (typeof shouldStop === "function" && shouldStop()) {
      throw new Error("Stopped by user");
    }

    let agentId;
    let runId;

    try {
      ({ agentId, runId } = await beginCursorCommentRun(prompt, onLog));
      return await pollCursorRun(agentId, runId, onLog);
    } catch (err) {
      if (err?.message === "Stopped by user") throw err;

      if (
        err?.message === "CURSOR_RUNNING_TIMEOUT" ||
        err?.message === "CURSOR_POLL_TIMEOUT"
      ) {
        await cancelCursorRun(err.agentId, err.runId, onLog);
      }

      if (!isRetryableCursorError(err) || attempt === CURSOR_RUN_MAX_ATTEMPTS) {
        if (err?.message === "CURSOR_RUNNING_TIMEOUT") {
          throw new Error(
            `Cursor stayed RUNNING for ${Math.round(CURSOR_RUNNING_TIMEOUT_MS / 1000)}s without a comment`
          );
        }
        if (err?.message === "CURSOR_POLL_TIMEOUT") {
          throw new Error("Timed out waiting for Cursor API response");
        }
        throw err;
      }

      if (onLog) {
        onLog(
          `Cursor run stalled — retrying (${attempt + 1}/${CURSOR_RUN_MAX_ATTEMPTS})...`
        );
      }
      await sleep(1200);
    }
  }

  throw new Error("Cursor failed to generate a comment after retries");
}

async function generateCommentWithCursor(prompt, onLog) {
  await ensureCursorPermissions();
  await hydrateCursorAgent();
  return startCursorCommentRun(prompt, onLog);
}

async function archiveCursorAgent() {
  await hydrateCursorAgent();
  if (!commentAgentId) return;
  const agentId = commentAgentId;
  commentAgentId = null;
  await storeAgentId(null);
  try {
    await cursorRequest(`/agents/${agentId}/archive`, {
      method: "POST",
      timeout: 30000,
    });
  } catch (_) {
    /* best effort */
  }
}

async function isCursorAgentActive() {
  await hydrateCursorAgent();
  return !!commentAgentId;
}
