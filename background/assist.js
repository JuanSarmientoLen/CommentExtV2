async function getActiveAssistTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  if (!isAssistTabUrl(tab.url)) {
    throw new Error(
      "Open a Gundamit or Chowbrick product page first (not the New-Update listing)."
    );
  }
  return tab;
}

async function runAssistComment() {
  if (runState.status === "running") return;

  runState.stopRequested = false;
  runState.managedTabIds = new Set();
  startKeepalive();
  updateStatus("running", "Assist mode...");

  try {
    await archiveCursorAgent();
    await clearExpiredHistory();
    log("--- Assist mode started ---");
    checkStop();

    const tab = await getActiveAssistTab();
    const pageInfo = await sendTabMessage(tab.id, { type: "GET_PAGE_INFO" });

    if (!pageInfo?.isSupportedSite) {
      throw new Error("This page is not supported.");
    }
    if (!pageInfo.isProductPage && !pageInfo.isReviewWritePage) {
      throw new Error("Navigate to a product or review-write page first.");
    }

    log(`Assist: ${pageInfo.site} — ${pageInfo.title || pageInfo.productUrl}`);

    log("Checking Cursor API access...");
    await verifyCursorConnection();
    log("Cursor API connected.");
    log("Warming up Cursor agent...");
    await warmupCursorAgent((message) => log(message));

    const data = await sendTabMessage(tab.id, { type: "EXTRACT_DATA" });
    const prompt = await buildPrompt(data.description, data.comments);
    const comment = await generateComment(prompt);

    const productUrl = pageInfo.productUrl;
    const productTitle = data.title || pageInfo.title || productUrl;
    const siteName = pageInfo.site;

    if (!pageInfo.isReviewWritePage) {
      log("Opening review form...");
      const clickResult = await sendTabMessage(tab.id, { type: "CLICK_COMMENT" });

      if (clickResult?.blocked) {
        await addToHistory(productUrl, { title: productTitle, site: siteName });
        throw new Error("3-day comment limit — product added to history.");
      }

      if (clickResult?.error) {
        const currentTab = await browser.tabs.get(tab.id);
        if (!currentTab.url || !/review-write/i.test(currentTab.url)) {
          throw new Error(clickResult.error);
        }
        log("Review form already open, continuing...");
      }

      await waitForTabComplete(tab.id);
      await sleep(1200);
    }

    const settings = await getSettings();
    const delaySec = Math.round(settings.submitDelayMs / 1000);
    log(`Submitting comment (${delaySec}s delay before submit)...`);

    let submitResult;
    try {
      submitResult = await sendTabMessage(tab.id, {
        type: "SUBMIT_COMMENT",
        comment,
        delayMs: settings.submitDelayMs,
      });
    } catch (err) {
      if (await submitLikelySucceeded(tab.id)) {
        log("Comment posted (page left review form after submit).");
        submitResult = { submitted: true };
      } else {
        throw err;
      }
    }

    if (submitResult?.blocked) {
      await addToHistory(productUrl, { title: productTitle, site: siteName });
      throw new Error("3-day comment limit on submit — product added to history.");
    }

    if (!submitResult?.submitted) {
      throw new Error("Comment submission failed");
    }

    await addToHistory(productUrl, {
      title: productTitle,
      site: siteName,
      comment,
    });

    log(`Posted comment (assist mode):\n${comment}`);
    updateStatus("done", "Comment posted");
    log("Assist complete. You can close this overlay.");
  } catch (err) {
    await broadcastAbort();

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
