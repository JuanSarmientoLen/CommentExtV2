const SHOWZ_LISTING_URL = "https://showzstore.com/New-Update/";
const SHOWZ_CONTENT_FILES = ["content/showz.js"];

function shuffleItems(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function notifyAgentStatus(active) {
  browser.runtime.sendMessage({ type: "AGENT_STATUS", active }).catch(() => {});
}

async function sendShowzMessage(tabId, message, timeout = MESSAGE_TIMEOUT) {
  return sendTabMessage(tabId, message, timeout, SHOWZ_CONTENT_FILES);
}

async function ensureShowZAgent() {
  if (isCursorAgentActive()) {
    log("Using active Cursor agent.");
    return;
  }

  log("Starting Cursor agent (stays active until you click Stop Agent)...");
  await verifyCursorConnection();
  await warmupCursorAgent((message) => log(message));
  notifyAgentStatus(true);
}

async function stopShowZAgent() {
  if (!isCursorAgentActive()) {
    log("Cursor agent is not running.");
    notifyAgentStatus(false);
    return;
  }

  await archiveCursorAgent();
  notifyAgentStatus(false);
  log("Cursor agent stopped.");
  updateStatus("idle", "Agent stopped");
}

async function generateReply(prompt) {
  checkStop();
  log("Generating reply with Cursor (Composer 2.5)...");

  const reply = await generateCommentWithCursor(prompt, (message) => {
    log(message);
  });

  log(`Generated reply:\n${reply}`);
  return reply;
}

async function replyOnShowZProduct(productTab, product) {
  const settings = await getSettings();
  const context = await sendShowzMessage(productTab.id, { type: "GET_REPLY_CONTEXT" });
  const eligible = context.eligibleComments || [];

  if (!eligible.length) {
    log(`No eligible comments on ${product.title || product.url}.`);
    return null;
  }

  const comment = shuffleItems(eligible)[0];
  log(`Replying to comment by ${comment.author}:\n${comment.text}`);

  const prompt = await buildReplyPrompt(
    context.description,
    comment.text,
    context.comments,
    comment.author
  );
  const replyText = await generateReply(prompt);

  const fillResult = await sendShowzMessage(productTab.id, {
    type: "EXECUTE_REPLY",
    commentIndex: comment.index,
    author: comment.author,
    text: comment.text,
    replyText,
    fillOnly: true,
    submitDelayMs: settings.showzReplyDelayMs,
  });

  if (!fillResult?.filled) {
    throw new Error("Failed to fill ShowZ reply");
  }

  log(`Reply filled for ${comment.author} (submit manually if needed):\n${replyText}`);
  return {
    author: comment.author,
    original: comment.text,
    reply: replyText,
  };
}

async function runShowZReplies() {
  if (runState.status === "running") return;

  runState.stopRequested = false;
  runState.managedTabIds = new Set();
  startKeepalive();
  updateStatus("running", "ShowZ reply...");

  try {
    await clearExpiredHistory();
    log("--- ShowZ reply started ---");
    await ensureShowZAgent();

    checkStop();
    const listingTab = await createManagedTab(SHOWZ_LISTING_URL, true);
    const history = await getHistory();

    const pickResponse = await sendShowzMessage(listingTab.id, {
      type: "PICK_RANDOM_PRODUCTS",
      history,
      used: [],
      count: 1,
    });

    const product = pickResponse?.products?.[0];
    if (!product) {
      throw new Error(
        `No eligible ShowZ products found (${pickResponse?.totalProducts ?? 0} on page).`
      );
    }

    log(`Selected product: ${product.title || product.url}`);

    const productTab = await createManagedTab(product.url, true);
    await browser.tabs.update(productTab.id, { active: true });
    await sleep(1200);

    const posted = await replyOnShowZProduct(productTab, product);
    if (!posted) {
      throw new Error("No eligible comment to reply to on selected product.");
    }

    await addToHistory(product.url, {
      title: product.title,
      site: "ShowZ",
      comment: posted.reply,
    });

    await browser.tabs.remove(listingTab.id);
    runState.managedTabIds.delete(listingTab.id);
    runState.managedTabIds.delete(productTab.id);

    log("ShowZ reply complete. Product tab left open with reply filled.");
    updateStatus("done", isCursorAgentActive() ? "Agent ready" : "Finished");
    log("Cursor agent still active — click Stop Agent when done.");
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
  }
}
