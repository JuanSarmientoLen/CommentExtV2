const CURSOR_API_BASE = "https://api.cursor.com/v1";
const CURSOR_API_ORIGIN = "https://api.cursor.com/";
const CURSOR_POLL_INTERVAL_MS = 2000;
const CURSOR_RUN_TIMEOUT_MS = 300000;
const CURSOR_CREATE_TIMEOUT_MS = 300000;
const CURSOR_HEARTBEAT_MS = 15000;

let commentAgentId = null;

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

  while (Date.now() - start < CURSOR_RUN_TIMEOUT_MS) {
    if (typeof shouldStop === "function" && shouldStop()) {
      throw new Error("Stopped by user");
    }

    const run = await cursorRequest(`/agents/${agentId}/runs/${runId}`, {
      timeout: 30000,
    });
    if (run.status !== lastStatus) {
      lastStatus = run.status;
      if (onLog) onLog(`Cursor run status: ${run.status}`);
    }

    if (terminal.has(run.status)) {
      if (run.status !== "FINISHED") {
        throw new Error(`Cursor run ended with status ${run.status}`);
      }
      const text = cleanGeneratedComment(run.result || "");
      if (!text) throw new Error("Cursor returned an empty comment");
      return text;
    }

    await sleep(CURSOR_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Cursor API response");
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
  return {
    agentId: created.agent.id,
    runId: created.run.id,
  };
}

async function warmupCursorAgent(onLog) {
  if (commentAgentId) return;

  await ensureCursorPermissions();
  const { agentId, runId } = await createCommentAgent(
    "Reply with exactly: ready",
    onLog
  );

  await pollCursorRun(agentId, runId, onLog);

  if (onLog) onLog("Cursor agent ready.");
}

async function startCursorCommentRun(prompt, onLog) {
  let agentId = commentAgentId;
  let runId;

  if (!agentId) {
    const created = await createCommentAgent(prompt, onLog);
    agentId = created.agentId;
    runId = created.runId;
  } else {
    if (onLog) onLog("Sending prompt to Cursor agent...");
    const created = await cursorRequest(`/agents/${agentId}/runs`, {
      method: "POST",
      timeout: 60000,
      body: JSON.stringify({
        prompt: { text: prompt },
      }),
    });
    runId = created.run.id;
    if (onLog) onLog(`Cursor run started (${created.run.status}).`);
  }

  return pollCursorRun(agentId, runId, onLog);
}

async function generateCommentWithCursor(prompt, onLog) {
  await ensureCursorPermissions();
  return startCursorCommentRun(prompt, onLog);
}

async function archiveCursorAgent() {
  if (!commentAgentId) return;
  const agentId = commentAgentId;
  commentAgentId = null;
  try {
    await cursorRequest(`/agents/${agentId}/archive`, {
      method: "POST",
      timeout: 30000,
    });
  } catch (_) {
    /* best effort */
  }
}
