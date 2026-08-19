const SHOWZ_LISTING_URL = "https://showzstore.com/New-Update/";
const SHOWZ_PRODUCTS_PER_RUN = 2;
const SHOWZ_CONTENT_FILES = ["content/showz.js"];

function randomReplyCount() {
  return 2 + Math.floor(Math.random() * 2);
}

function shuffleItems(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function sendShowzMessage(tabId, message, timeout = MESSAGE_TIMEOUT) {
  return sendTabMessage(tabId, message, timeout, SHOWZ_CONTENT_FILES);
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

async function processShowZProduct(productTab, product, repliesCount) {
  const context = await sendShowzMessage(productTab.id, { type: "GET_REPLY_CONTEXT" });
  const eligible = context.eligibleComments || [];

  if (!eligible.length) {
    log(`No eligible comments on ${product.title || product.url}. Skipping product.`);
    return [];
  }

  const picked = shuffleItems(eligible).slice(0, Math.min(repliesCount, eligible.length));
  const postedReplies = [];
  const settings = await getSettings();

  for (const comment of picked) {
    checkStop();
    log(`Replying to comment by ${comment.author}:\n${comment.text}`);

    const prompt = await buildReplyPrompt(
      context.description,
      comment.text,
      context.comments,
      comment.author
    );
    const replyText = await generateReply(prompt);

    await sendShowzMessage(productTab.id, {
      type: "EXECUTE_REPLY",
      commentIndex: comment.index,
      replyText,
      submitDelayMs: settings.showzReplyDelayMs,
    });

    postedReplies.push({
      author: comment.author,
      original: comment.text,
      reply: replyText,
    });
    log(`Posted reply to ${comment.author}:\n${replyText}`);
    await sleep(1500);
  }

  return postedReplies;
}

async function runShowZReplies() {
  if (runState.status === "running") return;

  runState.stopRequested = false;
  runState.managedTabIds = new Set();
  startKeepalive();
  updateStatus("running", "ShowZ replies...");

  try {
    await archiveCursorAgent();
    await clearExpiredHistory();
    log("--- ShowZ reply run started ---");
    log("Opening ShowZ New-Update page...");

    checkStop();
    const listingTab = await createManagedTab(SHOWZ_LISTING_URL, true);
    const history = await getHistory();
    const usedUrls = new Set();

    const pickResponse = await sendShowzMessage(listingTab.id, {
      type: "PICK_RANDOM_PRODUCTS",
      history,
      used: [],
      count: SHOWZ_PRODUCTS_PER_RUN,
    });

    const products = pickResponse?.products || [];
    if (!products.length) {
      throw new Error(
        `No eligible ShowZ products found (${pickResponse?.totalProducts ?? 0} on page).`
      );
    }

    log(`Selected ${products.length} random product(s) for replies.`);

    const allReplies = [];

    for (const product of products) {
      checkStop();
      log(`Opening product: ${product.title || product.url}`);

      const productTab = await createManagedTab(product.url, true);
      await browser.tabs.update(productTab.id, { active: true });
      await sleep(1200);

      const repliesCount = randomReplyCount();
      log(`Planning ${repliesCount} reply(s) on this product...`);

      const posted = await processShowZProduct(productTab, product, repliesCount);
      allReplies.push(...posted);

      const summary = posted.map((entry) => entry.reply).join("\n---\n");
      await addToHistory(product.url, {
        title: product.title,
        site: "ShowZ",
        comment: summary || "ShowZ replies posted",
      });
      usedUrls.add(product.url);

      await browser.tabs.remove(productTab.id);
      runState.managedTabIds.delete(productTab.id);
    }

    await browser.tabs.remove(listingTab.id);
    runState.managedTabIds.delete(listingTab.id);

    log(`ShowZ run complete. Posted ${allReplies.length} reply(s) across ${products.length} product(s).`);
    updateStatus("done", "ShowZ replies finished");
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
