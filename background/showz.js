const SHOWZ_LISTING_URL = "https://showzstore.com/New-Update/";
const SHOWZ_CONTENT_FILES = ["content/showz.js"];

async function showzReplyLikelySucceeded(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    const url = tab.url || "";
    return url && /showzstore\.com/i.test(url) && !/New-Update/i.test(url);
  } catch {
    return false;
  }
}

async function sendShowzReply(tabId, message) {
  try {
    return await sendShowzMessage(tabId, message);
  } catch (err) {
    if (
      /establish connection|receiving end|message port closed/i.test(err.message) &&
      (await showzReplyLikelySucceeded(tabId))
    ) {
      return { filled: true, submitted: true };
    }
    throw err;
  }
}

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

async function getShowZAutoLikeUsers() {
  const settings = await getSettings();
  return settings.autoLikeUsers || [];
}

async function ensureShowZAgent() {
  if (await isCursorAgentActive()) {
    log("Using active Cursor agent.");
    return;
  }

  log("Checking for active Cursor agent...");
  await verifyCursorConnection();
  await warmupCursorAgent((message) => log(message));
  notifyAgentStatus(await isCursorAgentActive());
}

async function stopShowZAgent() {
  if (runState.status === "running") {
    runState.stopRequested = true;
    log("Stop requested — ending ShowZ reply loop...");
    await broadcastAbort();
  }

  if (!(await isCursorAgentActive())) {
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

async function prepareShowZProductPage(productTab) {
  const autoLikeUsers = await getShowZAutoLikeUsers();
  const prep = await sendShowzMessage(productTab.id, {
    type: "PREPARE_SHOWZ_PRODUCT",
    autoLikeUsers,
  });

  if (prep.likedCount > 0) {
    log(`Liked ${prep.likedCount} comment(s) from auto-like list.`);
  }

  return prep;
}

async function replyOnShowZProduct(productTab, product) {
  const prep = await prepareShowZProductPage(productTab);

  if (prep.hasOneMasterComment) {
    log(
      `Skipping ${product.title || product.url} — OneMaster comment or reply on first page.`
    );
    return null;
  }

  const context = await sendShowzMessage(productTab.id, { type: "GET_REPLY_CONTEXT" });

  if (context.hasOneMasterComment) {
    log(
      `Skipping ${product.title || product.url} — OneMaster comment or reply on first page.`
    );
    return null;
  }

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

  const autoLikeUsers = await getShowZAutoLikeUsers();
  const settings = await getSettings();
  const delaySec = Math.round(settings.showzReplyDelayMs / 1000);

  log("Reloading product page before filling reply...");
  await browser.tabs.update(productTab.id, { url: product.url, active: true });
  await waitForTabComplete(productTab.id);
  await sleep(2000);
  await sendShowzMessage(productTab.id, {
    type: "ENSURE_REVIEWS",
    autoLikeUsers,
  });

  log(`Submitting ShowZ reply (${delaySec}s delay before submit)...`);
  const fillResult = await sendShowzReply(productTab.id, {
    type: "EXECUTE_REPLY",
    commentIndex: comment.index,
    author: comment.author,
    text: comment.text,
    replyText,
    autoLikeUsers,
    submitDelayMs: settings.showzReplyDelayMs,
  });

  if (!fillResult?.submitted) {
    throw new Error("ShowZ reply submission failed");
  }

  log(`Reply posted for ${comment.author}:\n${replyText}`);
  return {
    author: comment.author,
    original: comment.text,
    reply: replyText,
  };
}

async function reloadShowZListingTab(listingTab) {
  log("Returning to ShowZ New-Update listing...");
  await browser.tabs.update(listingTab.id, { url: SHOWZ_LISTING_URL, active: true });
  await waitForTabComplete(listingTab.id);
  await sleep(2000);
  await sendShowzMessage(listingTab.id, { type: "PING" });
}

async function runShowZReplies() {
  if (runState.status === "running") return;

  runState.stopRequested = false;
  runState.managedTabIds = new Set();
  startKeepalive();
  updateStatus("running", "ShowZ reply...");

  let replyCount = 0;
  let listingTab = null;
  let productTab = null;

  try {
    await clearExpiredHistory();
    log("--- ShowZ reply started (runs until you stop) ---");
    await ensureShowZAgent();

    checkStop();
    listingTab = await createManagedTab(SHOWZ_LISTING_URL, true);
    const usedUrls = new Set();
    let emptyPickStreak = 0;
    const maxEmptyPicks = 12;

    while (!shouldStop()) {
      try {
        checkStop();
        await ensureShowZAgent();
        notifyAgentStatus(await isCursorAgentActive());

        const history = await getHistory();
        const pickResponse = await sendShowzMessage(listingTab.id, {
          type: "PICK_RANDOM_PRODUCTS",
          history,
          used: [...usedUrls],
          count: 1,
        });

        const product = pickResponse?.products?.[0];
        if (!product) {
          emptyPickStreak += 1;
          if (emptyPickStreak >= maxEmptyPicks) {
            log("No eligible products found — refreshing listing and resetting skip list.");
            usedUrls.clear();
            emptyPickStreak = 0;
            await reloadShowZListingTab(listingTab);
            continue;
          }

          log(
            `No eligible product (${pickResponse?.totalProducts ?? 0} on page, ${usedUrls.size} skipped this cycle). Trying another...`
          );
          await sleep(1500);
          continue;
        }

        emptyPickStreak = 0;
        log(`Selected product: ${product.title || product.url}`);
        usedUrls.add(product.url);

        if (productTab) {
          try {
            await browser.tabs.remove(productTab.id);
          } catch (_) {
            /* tab may already be closed */
          }
          runState.managedTabIds.delete(productTab.id);
          productTab = null;
        }

        productTab = await createManagedTab(product.url, true);
        await browser.tabs.update(productTab.id, { active: true });
        await sleep(1200);

        const posted = await replyOnShowZProduct(productTab, product);
        if (!posted) {
          if (!shouldStop()) {
            await reloadShowZListingTab(listingTab);
          }
          continue;
        }

        await addToHistory(product.url, {
          title: product.title,
          site: "ShowZ",
          comment: posted.reply,
        });
        replyCount += 1;
        log(`ShowZ reply #${replyCount} posted. Continuing...`);
        updateStatus("running", `ShowZ #${replyCount} — next product...`);
        notifyAgentStatus(await isCursorAgentActive());

        if (!shouldStop()) {
          await reloadShowZListingTab(listingTab);
        }
      } catch (err) {
        if (shouldStop() || err.message === "Stopped by user") throw err;
        log(`ShowZ iteration error: ${err.message}. Retrying next product...`);
        try {
          if (listingTab) await reloadShowZListingTab(listingTab);
        } catch (_) {
          /* listing tab may be gone */
        }
        await sleep(2000);
      }
    }

    log(`ShowZ run stopped after ${replyCount} reply(s).`);
    if (await isCursorAgentActive()) {
      updateStatus("done", "Agent ready");
      log("Cursor agent still active — click Stop Agent when done.");
    } else if (!shouldStop()) {
      updateStatus("idle", "Finished");
    }
  } catch (err) {
    await broadcastAbort();

    if (shouldStop() || err.message === "Stopped by user") {
      log(`ShowZ run stopped after ${replyCount} reply(s).`);
      if (runState.status === "running") {
        updateStatus("stopped", "Stopped by user");
      }
    } else {
      log(`Error: ${err.message}`);
      updateStatus("error", err.message);
    }
  } finally {
    if (listingTab) {
      try {
        await browser.tabs.remove(listingTab.id);
      } catch (_) {
        /* tab may already be closed */
      }
      runState.managedTabIds.delete(listingTab.id);
    }
    if (productTab) {
      try {
        await browser.tabs.remove(productTab.id);
      } catch (_) {
        /* tab may already be closed */
      }
      runState.managedTabIds.delete(productTab.id);
    }
    if (runState.status === "running") {
      runState.status = "idle";
    }
    stopKeepalive();
  }
}
