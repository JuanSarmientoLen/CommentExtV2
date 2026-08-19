const SITES = [
  {
    key: "gundamit",
    name: "Gundamit",
    listingUrl: "https://gundamit.com/New-Update/",
  },
  {
    key: "chowbrick",
    name: "Chowbrick",
    listingUrl: "https://chowbrick.com/New-Update/",
  },
];

const COMMENTS_PER_SITE = 2;
const TAB_LOAD_TIMEOUT = 45000;
const MESSAGE_TIMEOUT = 90000;
const UI_LOG_KEY = "uiLogs";
const UI_STATUS_KEY = "uiStatus";
const MAX_UI_LOGS = 1000;

let runState = {
  status: "idle",
  stopRequested: false,
  managedTabIds: new Set(),
};

let keepaliveTimer = null;

function startKeepalive() {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(() => {
    browser.storage.local.get(UI_LOG_KEY).catch(() => {});
  }, 15000);
}

function stopKeepalive() {
  if (!keepaliveTimer) return;
  clearInterval(keepaliveTimer);
  keepaliveTimer = null;
}

async function persistLogEntry(entry) {
  const data = await browser.storage.local.get(UI_LOG_KEY);
  const logs = data[UI_LOG_KEY] || [];
  logs.push(entry);
  if (logs.length > MAX_UI_LOGS) {
    logs.splice(0, logs.length - MAX_UI_LOGS);
  }
  await browser.storage.local.set({ [UI_LOG_KEY]: logs });
}

function log(message) {
  const entry = { time: new Date().toLocaleTimeString(), message };
  persistLogEntry(entry).catch(() => {});
  browser.runtime.sendMessage({ type: "LOG", entry }).catch(() => {});
  console.log("[CommentExt]", message);
}

async function updateStatus(status, detail) {
  runState.status = status;
  const statusPayload = {
    status,
    detail: detail || "",
    updatedAt: Date.now(),
  };
  await browser.storage.local.set({ [UI_STATUS_KEY]: statusPayload });
  browser.runtime
    .sendMessage({ type: "STATUS", status, detail: detail || "" })
    .catch(() => {});
}

function shouldStop() {
  return runState.stopRequested;
}

function checkStop() {
  if (shouldStop()) throw new Error("Stopped by user");
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (shouldStop()) {
        reject(new Error("Stopped by user"));
        return;
      }
      if (Date.now() - start >= ms) {
        resolve();
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

function waitForTabComplete(tabId, timeout = TAB_LOAD_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeout);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    browser.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        resolve();
      } else {
        browser.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

async function ensureTabScript(tabId, files) {
  try {
    await browser.tabs.sendMessage(tabId, { type: "PING" });
    return;
  } catch (_) {
    /* inject below */
  }

  await browser.scripting.executeScript({
    target: { tabId },
    files,
  });
  await sleep(500);
}

async function submitLikelySucceeded(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    const url = tab.url || "";
    return (
      url &&
      !/review-write/i.test(url) &&
      /gundamit\.com|chowbrick\.com/i.test(url)
    );
  } catch {
    return false;
  }
}

async function sendTabMessage(
  tabId,
  message,
  timeout = MESSAGE_TIMEOUT,
  contentFiles = ["content/store.js"]
) {
  checkStop();
  const files = contentFiles;
  let lastError;

  for (let attempt = 0; attempt < 4; attempt++) {
    checkStop();

    try {
      await ensureTabScript(tabId, files);
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Message timeout: ${message.type}`));
        }, timeout);

        browser.tabs
          .sendMessage(tabId, message)
          .then((result) => {
            clearTimeout(timer);
            if (result && result.error) {
              reject(new Error(result.error));
            } else {
              resolve(result);
            }
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
      return response;
    } catch (err) {
      lastError = err;
      if (shouldStop()) throw new Error("Stopped by user");

      if (message.type === "SUBMIT_COMMENT" && (await submitLikelySucceeded(tabId))) {
        return { submitted: true };
      }

      const retryable = /establish connection|receiving end|message port closed/i.test(
        err.message
      );
      if (!retryable || attempt === 3) throw err;
      await sleep(800);
    }
  }

  throw lastError;
}

async function broadcastAbort() {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) =>
      browser.tabs.sendMessage(tab.id, { type: "ABORT_RUN" }).catch(() => {})
    )
  );
}

async function closeManagedTabs() {
  const ids = [...runState.managedTabIds];
  runState.managedTabIds.clear();
  for (const id of ids) {
    try {
      await browser.tabs.remove(id);
    } catch (_) {
      /* tab may already be closed */
    }
  }
}

async function abortRun() {
  if (runState.status !== "running") return;

  runState.stopRequested = true;
  log("Stop requested — cancelling all running scripts...");
  await broadcastAbort();
  await closeManagedTabs();
  await archiveCursorAgent();
  runState.status = "idle";
  updateStatus("stopped", "Stopped by user");
  log("All tasks stopped.");
}

async function createManagedTab(url, active = false) {
  checkStop();
  const tab = await browser.tabs.create({ url, active });
  runState.managedTabIds.add(tab.id);
  await waitForTabComplete(tab.id);
  await sleep(1200);
  return tab;
}

async function generateComment(prompt) {
  checkStop();
  log("Generating comment with Cursor (Composer 2.5)...");

  const comment = await generateCommentWithCursor(prompt, (message) => {
    log(message);
  });

  log(`Generated comment:\n${comment}`);
  return comment;
}

function getSiteByKey(siteKey) {
  return SITES.find((site) => site.key === siteKey) || null;
}

function getSitesForRun(siteKey) {
  if (!siteKey) return SITES;
  const site = getSiteByKey(siteKey);
  return site ? [site] : SITES;
}

async function reloadListingTab(listingTab, site) {
  log(`Reloading ${site.name} listing page...`);
  await browser.tabs.update(listingTab.id, { url: site.listingUrl, active: true });
  await waitForTabComplete(listingTab.id);
  await sleep(1500);
}

async function skipBlockedProduct({
  site,
  product,
  listingTab,
  productTab,
  usedUrls,
  commentsPerSite,
  posted,
  attempts,
  maxAttempts,
  reason,
}) {
  log(`${reason} — adding to history and picking another product.`);
  await addToHistory(product.url, {
    title: product.title,
    site: site.name,
  });
  usedUrls.add(product.url);

  try {
    await browser.tabs.remove(productTab.id);
  } catch (_) {
    /* tab may already be closed */
  }
  runState.managedTabIds.delete(productTab.id);

  if (posted < commentsPerSite && attempts < maxAttempts) {
    await reloadListingTab(listingTab, site);
  }
}

async function processSite(site, commentsPerSite = COMMENTS_PER_SITE) {
  const usedUrls = new Set();
  log(`Opening ${site.name} New-Update page...`);
  const listingTab = await createManagedTab(site.listingUrl, true);

  let posted = 0;
  let attempts = 0;
  const maxAttempts = Math.max(12, commentsPerSite * 6);

  while (posted < commentsPerSite && attempts < maxAttempts) {
    checkStop();

    attempts += 1;
    const history = await getHistory();
    const pickResponse = await sendTabMessage(listingTab.id, {
      type: "PICK_PRODUCT",
      history,
      used: [...usedUrls],
    });

    const product = pickResponse?.product;
    if (!product) {
      const total = pickResponse?.totalProducts ?? 0;
      log(
        `No eligible products left on ${site.name} (${total} on page, ${usedUrls.size} used this run).`
      );
      break;
    }

    log(
      `Selected (${product.commentCount} comments): ${product.title || product.url}`
    );

    const productTab = await createManagedTab(product.url, true);
    const data = await sendTabMessage(productTab.id, { type: "EXTRACT_DATA" });

    await browser.tabs.update(productTab.id, { active: true });
    await sleep(800);

    const prompt = await buildPrompt(data.description, data.comments);
    const comment = await generateComment(prompt);

    const clickResult = await sendTabMessage(productTab.id, {
      type: "CLICK_COMMENT",
    });

    if (clickResult?.error) {
      const tab = await browser.tabs.get(productTab.id);
      if (!tab.url || !/review-write/i.test(tab.url)) {
        throw new Error(clickResult.error);
      }
      log("Review form already open, continuing...");
    } else if (clickResult.blocked) {
      await skipBlockedProduct({
        site,
        product,
        listingTab,
        productTab,
        usedUrls,
        commentsPerSite,
        posted,
        attempts,
        maxAttempts,
        reason: "3-day comment limit hit on comment button",
      });
      continue;
    }

    if (!clickResult?.error && !clickResult.navigated) {
      const tab = await browser.tabs.get(productTab.id);
      if (!tab.url || !/review-write/i.test(tab.url)) {
        throw new Error("Comment button did not open the review form");
      }
      log("Review form opened, continuing...");
    }

    await waitForTabComplete(productTab.id);
    await sleep(1200);

    const settings = await getSettings();
    const delaySec = Math.round(settings.submitDelayMs / 1000);
    log(`Submitting comment (${delaySec}s delay before submit)...`);
    let submitResult;
    try {
      submitResult = await sendTabMessage(productTab.id, {
        type: "SUBMIT_COMMENT",
        comment,
        delayMs: settings.submitDelayMs,
      });
    } catch (err) {
      if (await submitLikelySucceeded(productTab.id)) {
        log("Comment posted (page left review form after submit).");
        submitResult = { submitted: true };
      } else {
        throw err;
      }
    }

    if (submitResult?.blocked) {
      await skipBlockedProduct({
        site,
        product,
        listingTab,
        productTab,
        usedUrls,
        commentsPerSite,
        posted,
        attempts,
        maxAttempts,
        reason: "3-day comment limit hit on submit",
      });
      continue;
    }

    if (!submitResult?.submitted) {
      throw new Error("Comment submission failed");
    }

    await addToHistory(product.url, {
      title: product.title,
      site: site.name,
      comment,
    });
    usedUrls.add(product.url);
    posted += 1;
    log(
      `Posted comment ${posted}/${commentsPerSite} on ${site.name}:\n${comment}`
    );

    await browser.tabs.remove(productTab.id);
    runState.managedTabIds.delete(productTab.id);

    if (posted < commentsPerSite && attempts < maxAttempts) {
      await reloadListingTab(listingTab, site);
    }
  }

  await browser.tabs.remove(listingTab.id);
  runState.managedTabIds.delete(listingTab.id);

  if (posted < commentsPerSite) {
    log(`Only posted ${posted}/${commentsPerSite} on ${site.name}.`);
  }
}

async function runAutomation(options = {}) {
  if (runState.status === "running") return;

  const siteKey = options.siteKey || null;
  const commentsPerSite = options.commentsPerSite || COMMENTS_PER_SITE;
  const sites = getSitesForRun(siteKey);

  runState.stopRequested = false;
  runState.managedTabIds = new Set();
  startKeepalive();
  updateStatus("running", "Starting...");

  try {
    await archiveCursorAgent();
    await clearExpiredHistory();
    log("--- New run started ---");

    if (siteKey) {
      const site = getSiteByKey(siteKey);
      log(`Starting ${site.name} run (${commentsPerSite} comment${commentsPerSite === 1 ? "" : "s"})...`);
    } else {
      log(`Starting auto comment run (Gundamit, Chowbrick — ${commentsPerSite} each)...`);
    }

    log("Checking Cursor API access...");
    await verifyCursorConnection();
    log("Cursor API connected.");
    log("Warming up Cursor agent before scraping products...");
    await warmupCursorAgent((message) => log(message));

    for (const site of sites) {
      checkStop();
      await processSite(site, commentsPerSite);
    }

    if (shouldStop()) throw new Error("Stopped by user");

    log("Run complete. Closing managed windows...");
    await closeManagedTabs();
    updateStatus("done", "Finished");
    log("All done.");
  } catch (err) {
    await broadcastAbort();
    await closeManagedTabs();

    if (shouldStop() || err.message === "Stopped by user") {
      runState.status = "idle";
      updateStatus("stopped", "Stopped by user");
    } else {
      log(`Error: ${err.message}`);
      runState.status = "idle";
      updateStatus("error", err.message);
    }
  } finally {
    stopKeepalive();
    await archiveCursorAgent();
  }
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_RUN") {
    isAndroid().then((android) => {
      if (android) {
        log("Full auto runs are desktop-only on this device. Starting assist mode instead.");
        runAssistComment();
        return;
      }
      runAutomation({
        siteKey: message.siteKey || null,
        commentsPerSite: message.commentsPerSite || COMMENTS_PER_SITE,
      });
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "START_ASSIST") {
    runAssistComment();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "START_SHOWZ") {
    isAndroid().then((android) => {
      if (android) {
        log("ShowZ reply runs require desktop Firefox.");
        updateStatus("error", "ShowZ requires desktop");
        return;
      }
      runShowZReplies();
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "STOP_RUN") {
    abortRun();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "GET_STATE") {
    Promise.all([
      browser.storage.local.get([UI_LOG_KEY, UI_STATUS_KEY]),
      getPlatformInfoCached(),
    ]).then(([data, platform]) => {
      const savedStatus = data[UI_STATUS_KEY] || {};
      sendResponse({
        status: runState.status,
        detail: savedStatus.detail || "",
        logs: data[UI_LOG_KEY] || [],
        platform: platform.os,
        isAndroid: platform.os === "android",
      });
    });
    return true;
  }

  if (message.type === "CLEAR_LOGS") {
    browser.storage.local
      .set({ [UI_LOG_KEY]: [] })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "GET_HISTORY") {
    getRecentHistoryEntries().then((entries) => sendResponse({ entries }));
    return true;
  }

  if (message.type === "CLEAR_HISTORY") {
    browser.storage.local.remove(HISTORY_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    getSettingsForPopup().then((settings) => sendResponse(settings));
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    saveSettings(message.settings || {})
      .then(() => getSettingsForPopup())
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "RESET_SETTINGS") {
    resetSettings()
      .then(() => getSettingsForPopup())
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  return false;
});
