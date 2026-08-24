const COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000;
const ONEMASTER_PATTERN = /one\s*-?\s*master/i;
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

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return el.offsetParent !== null || style.position === "fixed";
}

function activateClick(el) {
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  el.click();
}

function isOneMasterAuthor(name) {
  return ONEMASTER_PATTERN.test(String(name || "").trim());
}

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function parseProducts() {
  const products = [];
  const seen = new Set();

  for (const link of document.querySelectorAll("a.review_count")) {
    const href = link.getAttribute("href");
    if (!href) continue;

    const url = normalizeProductUrl(new URL(href.split("#")[0], location.origin).href);
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

function pickRandomProducts(products, history, used, count = 2) {
  const now = Date.now();
  const usedSet = new Set((used || []).map(normalizeProductUrl));

  const available = products.filter((product) => {
    const url = normalizeProductUrl(product.url);
    if (usedSet.has(url)) return false;
    const entry = history[url] || history[product.url];
    if (entry && now - entry.timestamp < COOLDOWN_MS) return false;
    return true;
  });

  return shuffleArray(available).slice(0, count);
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

function getAuthorName(item) {
  const selectors = [
    ".user_nickName",
    ".user_name .user_nickName",
    ".review_user a",
    ".review_user",
    ".review_name",
    ".user_name",
    ".member_name",
    ".name a",
    ".name",
    ".review_main .user",
    ".review_info .name",
  ];
  for (const selector of selectors) {
    const el = item.querySelector(selector);
    if (el) {
      const text = (el.textContent || "").trim();
      if (text) return text;
    }
  }
  return "";
}

function getCommentText(item) {
  const el =
    item.querySelector(".review_main .content") ||
    item.querySelector(".review_content") ||
    item.querySelector(".content");
  return (el?.textContent || "").trim();
}

function getNestedReplyItems(item) {
  const replyRoot =
    item.querySelector(":scope > .review_reply") ||
    item.querySelector(":scope > .review_reply_list") ||
    item.querySelector(":scope > .reply_list");
  if (!replyRoot) return [];
  return [...replyRoot.querySelectorAll(".review_item")];
}

function oneMasterRepliedInThread(item) {
  for (const reply of getNestedReplyItems(item)) {
    if (isOneMasterAuthor(getAuthorName(reply))) return true;
    if (oneMasterRepliedInThread(reply)) return true;
  }
  return false;
}

function getTopLevelReviewItems() {
  const list =
    document.querySelector("#review_list") ||
    document.querySelector(".review_list") ||
    document.querySelector(".goods_review_list") ||
    document.querySelector(".review_box");

  if (list) {
    const direct = [...list.querySelectorAll(":scope > .review_item")];
    if (direct.length) return direct;
  }

  const all = [...document.querySelectorAll(".review_item")];
  return all.filter((item) => !item.parentElement?.closest(".review_item"));
}

function isEligibleTopLevelComment(item) {
  const author = getAuthorName(item);
  if (isOneMasterAuthor(author)) return false;
  if (oneMasterRepliedInThread(item)) return false;
  const text = getCommentText(item);
  if (!text) return false;
  return true;
}

function isKengAuthor(name) {
  return /^keng$/i.test(String(name || "").trim());
}

async function likeKengComments() {
  for (const item of document.querySelectorAll(".review_item")) {
    if (!isKengAuthor(getAuthorName(item))) continue;
    const likeBtn = findLikeButton(item);
    if (!likeBtn || !isVisible(likeBtn)) continue;
    activateClick(likeBtn);
    await sleep(600);
  }
}

function findLikeButton(item) {
  const selectors = [
    "a.like",
    ".likeWrapper a.like",
    ".like a.like",
    "a.good",
    ".review_like a",
    ".review_like",
    ".like_btn",
    ".operate_like",
    ".thumb_up",
    ".review_operate a.good",
    "[class*='like'] a",
    "a[title*='like' i]",
    "a[title*='thumb' i]",
  ];
  for (const selector of selectors) {
    const el = item.querySelector(selector);
    if (isVisible(el)) return el;
  }

  for (const el of item.querySelectorAll("a, button, span")) {
    const text = (el.textContent || "").trim().toLowerCase();
    if (text === "like" || text.includes("thumb")) return el;
  }
  return null;
}

function findReplyButton(item) {
  const selectors = [
    "a.reply_btn",
    ".reply .edit a.reply_btn",
    ".reply .edit a",
    ".review_reply_btn",
    ".btn_reply",
    ".review_operate a.reply",
  ];
  for (const selector of selectors) {
    const el = item.querySelector(selector);
    if (isVisible(el) && !el.closest(".write_reply")) return el;
  }

  for (const el of item.querySelectorAll(".reply .edit a, a.reply_btn")) {
    if (isVisible(el) && !el.closest(".write_reply")) return el;
  }
  return null;
}

function getWriteReplyBox(item) {
  return item.querySelector(".write_reply");
}

function isReplyFormOpen(item) {
  const writeReply = getWriteReplyBox(item);
  if (!writeReply) return false;
  if (writeReply.classList.contains("hide")) return false;
  return isVisible(writeReply);
}

function findReplyTextarea(item) {
  const writeReply = getWriteReplyBox(item);
  if (writeReply && !writeReply.classList.contains("hide")) {
    const scoped = writeReply.querySelector(
      "textarea[name='ReviewComment'], textarea.review_content, textarea"
    );
    if (scoped && !scoped.disabled && isVisible(scoped)) return scoped;
  }

  const selectors = [
    ".write_reply:not(.hide) textarea[name='ReviewComment']",
    "textarea.review_content",
    ".reply_box textarea",
    ".review_reply_box textarea",
    ".reply_text textarea",
    "textarea[name='ReviewComment']",
    "textarea[name='content']",
  ];
  for (const selector of selectors) {
    const el = item.querySelector(selector);
    if (el && !el.disabled && isVisible(el)) return el;
  }
  return null;
}

function findReplySubmitButton(item) {
  const writeReply =
    item.querySelector(".write_reply:not(.hide)") || getWriteReplyBox(item);
  const scope = writeReply || item;

  const selectors = [
    "button.textbtn",
    "button.btn.textbtn",
    ".write_reply button.btn",
    "input[type='submit']",
    "button[type='submit']",
    ".btn_submit",
    ".reply_submit",
    ".submit_btn",
    "a.submit",
  ];
  for (const selector of selectors) {
    const el = scope.querySelector(selector);
    if (isVisible(el) && !el.closest(".edit")) return el;
  }

  for (const el of scope.querySelectorAll("button, input[type=button], input[type=submit]")) {
    if (el.closest(".edit")) continue;
    const text = (el.textContent || el.value || "").trim().toLowerCase();
    if (text === "submit" || text === "reply" || text === "post") return el;
  }
  return null;
}

async function openReplyForm(item) {
  const replyBtn = findReplyButton(item);
  if (!replyBtn) throw new Error("Reply button not found");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    activateClick(replyBtn);
    await sleep(700);
    if (isReplyFormOpen(item)) break;

    const writeReply = getWriteReplyBox(item);
    if (writeReply?.classList.contains("hide")) {
      writeReply.classList.remove("hide");
      await sleep(300);
    }
  }

  await waitForReplyForm(item, 15000, false);
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

async function getReplyContext() {
  await ensureReviewListReady();

  const proId = getProductId();
  if (!proId) throw new Error("Could not determine product ID");

  const title =
    document.querySelector(".prod_title, .pro_name, h1.name, .pd_name")?.textContent?.trim() ||
    document.title?.trim() ||
    "";

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

  const topLevel = getTopLevelReviewItems();
  const eligibleComments = [];

  topLevel.forEach((item, index) => {
    if (!isEligibleTopLevelComment(item)) return;
    eligibleComments.push({
      index,
      author: getAuthorName(item),
      text: getCommentText(item),
    });
  });

  return {
    proId,
    title,
    description,
    comments,
    eligibleComments,
  };
}

function getTopLevelItemByIndex(index) {
  const items = getTopLevelReviewItems();
  const item = items[index];
  if (!item) throw new Error(`Comment index ${index} not found on page`);
  if (!isEligibleTopLevelComment(item)) {
    throw new Error(`Comment index ${index} is no longer eligible`);
  }
  return item;
}

function normalizeCommentText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthorName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function commentTextMatches(left, right) {
  const a = normalizeCommentText(left);
  const b = normalizeCommentText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 24 && b.includes(a.slice(0, 24))) return true;
  if (b.length >= 24 && a.includes(b.slice(0, 24))) return true;
  return a.includes(b) || b.includes(a);
}

async function ensureReviewListReady(timeoutMs = 25000) {
  const anchors = [
    "#review_list",
    ".review_list",
    ".goods_review_list",
    ".goods_review",
    ".review_box",
    "#CustomerReviews",
  ];
  for (const selector of anchors) {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "instant" });
      break;
    }
  }

  for (const el of document.querySelectorAll("a, button, span, li, div")) {
    const label = (el.textContent || "").trim();
    if (!/^(customer )?reviews?(\s*\(\d+\))?$/i.test(label)) continue;
    if (!isVisible(el)) continue;
    activateClick(el);
    await sleep(1000);
    break;
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (abortRequested) throw new Error("Stopped by user");
    if (getTopLevelReviewItems().length) return;
    await sleep(400);
  }

  throw new Error("Review list not loaded on page");
}

function findTopLevelItemByAuthorAndText(author, text) {
  const normalizedAuthor = normalizeAuthorName(author);
  const items = getTopLevelReviewItems().filter(isEligibleTopLevelComment);

  for (const item of items) {
    if (
      normalizeAuthorName(getAuthorName(item)) === normalizedAuthor &&
      commentTextMatches(getCommentText(item), text)
    ) {
      return item;
    }
  }

  for (const item of items) {
    if (commentTextMatches(getCommentText(item), text)) return item;
  }

  if (normalizedAuthor) {
    for (const item of items) {
      if (normalizeAuthorName(getAuthorName(item)) === normalizedAuthor) return item;
    }
  }

  return null;
}

function resolveCommentTarget(commentIndex, author, text) {
  const byAuthorText = findTopLevelItemByAuthorAndText(author, text);
  if (byAuthorText) return byAuthorText;

  try {
    return getTopLevelItemByIndex(commentIndex);
  } catch (_) {
    /* try eligible pool below */
  }

  const eligible = getTopLevelReviewItems().filter(isEligibleTopLevelComment);
  if (eligible.length === 1) return eligible[0];

  throw new Error(
    `Comment not found on page (${author || "unknown author"}, index ${commentIndex})`
  );
}

async function waitForReplyForm(item, timeoutMs = 15000, requireSubmit = true) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (abortRequested) throw new Error("Stopped by user");
    const textarea = findReplyTextarea(item);
    const submitBtn = findReplySubmitButton(item);
    if (textarea && isReplyFormOpen(item) && (!requireSubmit || submitBtn)) {
      return { textarea, submitBtn };
    }
    await sleep(300);
  }
  throw new Error("Reply form not ready");
}

async function executeReply(
  commentIndex,
  replyText,
  _submitDelayMs = 15000,
  author = "",
  text = ""
) {
  abortRequested = false;
  await ensureReviewListReady();
  await likeKengComments();
  const item = resolveCommentTarget(commentIndex, author, text);

  const likeBtn = findLikeButton(item);
  if (likeBtn) {
    activateClick(likeBtn);
    await sleep(600);
  }

  await openReplyForm(item);
  const { textarea } = await waitForReplyForm(item, 15000, false);

  textarea.focus();
  textarea.classList.remove("default");
  textarea.value = replyText;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));

  if (!textarea.value.trim()) {
    throw new Error("Failed to fill reply textarea");
  }

  return { filled: true };
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
      if (message.type === "PICK_RANDOM_PRODUCTS") {
        const products = parseProducts();
        const normalizedHistory = {};
        for (const [url, entry] of Object.entries(message.history || {})) {
          normalizedHistory[normalizeProductUrl(url)] = entry;
        }
        const picked = pickRandomProducts(
          products,
          normalizedHistory,
          message.used || [],
          message.count || 2
        );
        for (const product of picked) {
          product.url = normalizeProductUrl(product.url);
        }
        sendResponse({ products: picked, totalProducts: products.length });
        return;
      }

      if (message.type === "ENSURE_REVIEWS") {
        await ensureReviewListReady();
        await likeKengComments();
        sendResponse({
          ok: true,
          count: getTopLevelReviewItems().length,
        });
        return;
      }

      if (message.type === "GET_REPLY_CONTEXT") {
        sendResponse(await getReplyContext());
        return;
      }

      if (message.type === "EXECUTE_REPLY") {
        abortRequested = false;
        sendResponse(
          await executeReply(
            message.commentIndex,
            message.replyText,
            message.submitDelayMs,
            message.author,
            message.text
          )
        );
        return;
      }

      sendResponse({ error: "Unknown message type" });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true;
});
