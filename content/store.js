const COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000;
let abortRequested = false;

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (abortRequested) {
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

function normalizeProductUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${path}`;
  } catch (_) {
    return url;
  }
}

function parseProducts() {
  const products = [];
  const seen = new Set();

  for (const link of document.querySelectorAll("a.review_count")) {
    const href = link.getAttribute("href");
    if (!href) continue;

    const url = normalizeProductUrl(
      new URL(href.split("#")[0], location.origin).href
    );
    if (seen.has(url)) continue;
    seen.add(url);

    const countMatch = link.textContent.match(/\((\d+)\)/);
    const commentCount = countMatch ? parseInt(countMatch[1], 10) : 0;

    const container =
      link.closest(".pro_item") ||
      link.closest("dl") ||
      link.closest(".item") ||
      link.parentElement;

    let title = "";
    if (container) {
      const titleEl = container.querySelector(
        ".prod_name a, .pro_name a, h3 a, .name a"
      );
      if (titleEl) title = titleEl.textContent.trim();
    }

    products.push({ url, title, commentCount });
  }

  return products;
}

function pickProduct(products, history, used) {
  const now = Date.now();
  const usedSet = new Set((used || []).map(normalizeProductUrl));

  const available = products.filter((product) => {
    const url = normalizeProductUrl(product.url);
    if (usedSet.has(url)) return false;
    const entry = history[url] || history[product.url];
    if (entry && now - entry.timestamp < COOLDOWN_MS) return false;
    return true;
  });

  if (!available.length) return null;

  const lowComment = available.filter((p) => p.commentCount <= 2);
  if (lowComment.length) return lowComment[0];

  return available.reduce((best, current) =>
    current.commentCount > best.commentCount ? current : best
  );
}

function getProductId() {
  const input = document.querySelector("#ProId");
  if (input?.value) return input.value;

  const hashMatch = location.hash.match(/^#(\d+)$/);
  if (hashMatch) return hashMatch[1];

  const match = location.pathname.match(/_p(\d+)\.html/);
  if (match) return match[1];

  const matchWrite = location.pathname.match(/review-write\/(\d+)\.html/);
  if (matchWrite) return matchWrite[1];

  return null;
}

function isReviewWritePage() {
  return /review-write/i.test(`${location.pathname}${location.hash}`);
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return el.offsetParent !== null || style.position === "fixed";
}

function findCommentButton() {
  const selectors = [
    ".prod_info_review .track",
    "a.write_review.track",
    ".write_review.track",
    "a.write_review_btn",
    ".write_review_btn",
    "a.write_review[data-url]",
    "[data-url*='review-write']",
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (isVisible(el)) return el;
  }

  for (const el of document.querySelectorAll("a, button, span, div")) {
    const text = (el.textContent || "").trim();
    if (/comment and earn points/i.test(text) && isVisible(el)) return el;
  }

  return null;
}

async function waitForCommentButton(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (abortRequested) throw new Error("Stopped by user");
    const btn = findCommentButton();
    if (btn) return btn;
    await sleep(500);
  }
  return null;
}

function activateClick(el) {
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.click();
}

async function fetchComments(proId) {
  const body = new URLSearchParams({
    page: "0",
    ProId: String(proId),
    Rating: "0",
    Action: "goods",
  });

  const response = await fetch("/ajax/review_list.html", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    credentials: "include",
  });

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll(".review_item .review_main .content")]
    .map((el) => el.textContent.trim())
    .filter(Boolean);
}

async function extractProductData() {
  const proId = getProductId();
  if (!proId) throw new Error("Could not determine product ID");

  const description =
    document.querySelector(".desc_cnt")?.innerText?.trim() ||
    document.querySelector(".pd_content .editor_txt")?.innerText?.trim() ||
    document.querySelector(".prod_description")?.innerText?.trim() ||
    "";

  let comments = [];
  try {
    comments = await fetchComments(proId);
  } catch (_) {
    comments = [...document.querySelectorAll(".review_item .review_main .content")]
      .map((el) => el.textContent.trim())
      .filter(Boolean);
  }

  return { proId, description, comments };
}

function findVisibleAlert() {
  const candidates = document.querySelectorAll(
    ".win_alert, .alert_m, .alert_box, #global_win_alert, .win_alert_custom, .alert_wrap"
  );

  for (const el of candidates) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (el.offsetParent === null && style.position !== "fixed") continue;
    return el;
  }
  return null;
}

function isRateLimitText(text) {
  return /only post|every \d+ day|3\s*day|comment every|already (posted|commented|reviewed)|rate limit|too many comment/i.test(
    text || ""
  );
}

async function waitForAlertToClear(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (abortRequested) throw new Error("Stopped by user");
    if (!findVisibleAlert()) return;
    await sleep(200);
  }
}

async function waitForReviewForm(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (abortRequested) throw new Error("Stopped by user");

    if (!isReviewWritePage()) {
      return { alreadySubmitted: true };
    }

    const textarea =
      document.querySelector("#review_content") ||
      document.querySelector('textarea[name="content"]');
    const submitBtn =
      document.querySelector('#review_form input[type="submit"]') ||
      document.querySelector('#review_form button[type="submit"]');
    if (textarea && submitBtn) return { textarea, submitBtn };
    await sleep(300);
  }
  throw new Error("Review form not ready");
}

function dismissAlert(alertEl) {
  const buttons = alertEl.querySelectorAll(
    "a, button, input[type=button], .btn, .confirm, .ok"
  );
  for (const btn of buttons) {
    const text = (btn.textContent || btn.value || "").trim().toLowerCase();
    if (
      text === "ok" ||
      text === "confirm" ||
      text.includes("close") ||
      btn.classList.contains("btn_ok")
    ) {
      btn.click();
      return;
    }
  }
  if (buttons.length) buttons[buttons.length - 1].click();
}

async function clickCommentButton() {
  if (isReviewWritePage()) {
    return { blocked: false, navigated: true, alreadyOpen: true };
  }

  const startUrl = location.href;
  const btn = await waitForCommentButton();

  if (!btn) {
    if (isReviewWritePage()) {
      return { blocked: false, navigated: true, alreadyOpen: true };
    }
    return { error: "Comment button not found" };
  }

  activateClick(btn);

  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (abortRequested) throw new Error("Stopped by user");

    const alertEl = findVisibleAlert();
    if (alertEl) {
      const blocked = isRateLimitText(alertEl.textContent || "");
      dismissAlert(alertEl);
      await waitForAlertToClear();
      return { blocked, navigated: false };
    }

    if (isReviewWritePage() || location.href !== startUrl) {
      return { blocked: false, navigated: true };
    }

    await sleep(250);
  }

  if (isReviewWritePage()) {
    return { blocked: false, navigated: true };
  }

  const lateAlert = findVisibleAlert();
  if (lateAlert) {
    const blocked = isRateLimitText(lateAlert.textContent || "");
    dismissAlert(lateAlert);
    await waitForAlertToClear();
    return { blocked, navigated: false };
  }

  return { blocked: false, navigated: false, timeout: true };
}

async function submitComment(comment, delayMs = 15000) {
  const form = await waitForReviewForm();
  if (form.alreadySubmitted) {
    return { submitted: true };
  }

  const { textarea, submitBtn } = form;

  textarea.focus();
  textarea.value = comment;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));

  if (!textarea.value.trim()) {
    throw new Error("Failed to fill comment textarea");
  }

  const waitMs = Math.max(1000, Math.min(120000, Number(delayMs) || 15000));
  await sleep(waitMs);

  submitBtn.click();

  const start = Date.now();
  while (Date.now() - start < 12000) {
    if (abortRequested) throw new Error("Stopped by user");

    if (!isReviewWritePage() || !document.querySelector("#review_content")) {
      return { submitted: true };
    }

    const alertEl = findVisibleAlert();
    if (alertEl) {
      const text = alertEl.textContent || "";
      if (isRateLimitText(text)) {
        dismissAlert(alertEl);
        await waitForAlertToClear();
        return { submitted: false, blocked: true };
      }
    }

    await sleep(300);
  }

  return { submitted: true };
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ABORT_RUN") {
    abortRequested = true;
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "PING") {
    sendResponse({ ok: true });
    return true;
  }

  (async () => {
    try {
      if (message.type === "PICK_PRODUCT") {
        const products = parseProducts();
        const normalizedHistory = {};
        for (const [url, entry] of Object.entries(message.history || {})) {
          normalizedHistory[normalizeProductUrl(url)] = entry;
        }
        const product = pickProduct(
          products,
          normalizedHistory,
          message.used || []
        );
        if (product) {
          product.url = normalizeProductUrl(product.url);
        }
        sendResponse({ product, totalProducts: products.length });
        return;
      }

      if (message.type === "EXTRACT_DATA") {
        sendResponse(await extractProductData());
        return;
      }

      if (message.type === "CLICK_COMMENT") {
        abortRequested = false;
        sendResponse(await clickCommentButton());
        return;
      }

      if (message.type === "SUBMIT_COMMENT") {
        abortRequested = false;
        sendResponse(await submitComment(message.comment, message.delayMs));
        return;
      }

      sendResponse({ error: "Unknown message type" });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true;
});
