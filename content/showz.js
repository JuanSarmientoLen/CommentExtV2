const COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000;
const ONEMASTER_PATTERN = /one\s*-?\s*master/i;
const SHOWZ_REPLY_GUARD_KEY = "commentext_showz_reply_guard";
let abortRequested = false;
let replySubmitInFlight = false;

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

function clickOnce(el) {
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.click();
}

function buildReplyTargetKey(author, text) {
  return `${normalizeProductUrl(location.href)}|${normalizeAuthorName(author)}|${normalizeCommentText(text)}`;
}

function getReplyGuardEntry(targetKey) {
  try {
    const data = JSON.parse(sessionStorage.getItem(SHOWZ_REPLY_GUARD_KEY) || "{}");
    return data[targetKey] || null;
  } catch (_) {
    return null;
  }
}

function markReplyGuardSubmitted(targetKey, replyText) {
  try {
    const data = JSON.parse(sessionStorage.getItem(SHOWZ_REPLY_GUARD_KEY) || "{}");
    data[targetKey] = {
      replyText: normalizeCommentText(replyText),
      at: Date.now(),
    };
    sessionStorage.setItem(SHOWZ_REPLY_GUARD_KEY, JSON.stringify(data));
  } catch (_) {
    /* ignore */
  }
}

function getReplyTextsInThread(item) {
  const texts = [];
  const replySection = item.querySelector(".reply, .review_main .reply");
  if (!replySection) return texts;

  for (const block of replySection.querySelectorAll(".review_reply")) {
    const paragraphs = [...block.querySelectorAll("p")];
    const contentP = paragraphs.find((p) => !p.classList.contains("writer"));
    const text = (contentP?.textContent || "").trim();
    if (text) texts.push(text);
  }

  return texts;
}

function threadHasReplyWithText(item, replyText) {
  return getReplyTextsInThread(item).some((text) => commentTextMatches(text, replyText));
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

  const userArea = item.querySelector(
    ".user_name, .review_user, .review_info, .user, .review_name"
  );
  if (userArea) {
    for (const link of userArea.querySelectorAll("a")) {
      const text = (link.textContent || "").trim();
      if (text && !/^(premium member|jointed|comments|location|likes)$/i.test(text)) {
        return text;
      }
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
    item.querySelector(":scope > .reply_list") ||
    item.querySelector(".review_reply") ||
    item.querySelector(".review_reply_list") ||
    item.querySelector(".reply_list");
  if (!replyRoot) return [];
  return [...replyRoot.querySelectorAll(".review_item")];
}

function oneMasterRepliedInThread(item) {
  for (const reply of getNestedReplyItems(item)) {
    if (isOneMasterAuthor(getAuthorName(reply))) return true;
    if (oneMasterRepliedInThread(reply)) return true;
  }

  const replySection = item.querySelector(".reply, .review_main .reply");
  if (replySection && hasOneMasterInReplyMarkup(replySection)) return true;

  return false;
}

function getTopLevelReviewItems(root = document) {
  const list =
    root.querySelector("#review_list") ||
    root.querySelector(".review_list") ||
    root.querySelector(".goods_review_list") ||
    root.querySelector(".review_box");

  if (list) {
    const direct = [...list.querySelectorAll(":scope > .review_item")];
    if (direct.length) return direct;
  }

  const all = [...root.querySelectorAll(".review_item")];
  return all.filter((item) => !item.parentElement?.closest(".review_item"));
}

function hasOneMasterInReplyMarkup(root) {
  if (!root) return false;
  for (const el of root.querySelectorAll(
    ".replier a, cite.replier, .replier, .review_reply cite, .review_reply .writer"
  )) {
    if (isOneMasterAuthor(el.textContent)) return true;
  }
  return false;
}

function hasOneMasterActivityOnFirstPage(root) {
  if (!root) return false;

  for (const item of getTopLevelReviewItems(root)) {
    if (isOneMasterAuthor(getAuthorName(item))) return true;
    if (oneMasterRepliedInThread(item)) return true;
  }

  for (const item of root.querySelectorAll(".review_item")) {
    if (isOneMasterAuthor(getAuthorName(item))) return true;
  }

  return hasOneMasterInReplyMarkup(root);
}

function normalizeUsername(name) {
  return String(name || "").trim().toLowerCase();
}

function isAuthorInLikeList(author, likeUsers) {
  const normalized = normalizeUsername(author);
  if (!normalized) return false;
  return (likeUsers || []).some((user) => normalizeUsername(user) === normalized);
}

function getReplyAuthor(replyEl) {
  const replier = replyEl.querySelector(".replier a, cite.replier");
  return (replier?.textContent || "").trim();
}

function getLikeButtonKey(btn) {
  return btn.getAttribute("data-url") || btn.getAttribute("href") || "";
}

function findMainCommentLikeButton(reviewItem) {
  const mainLikeArea = reviewItem.querySelector(".like.fr, :scope > .like");
  if (mainLikeArea) {
    const btn = mainLikeArea.querySelector("a.like");
    if (btn && isVisible(btn)) return btn;
  }

  for (const btn of reviewItem.querySelectorAll("a.like")) {
    if (btn.closest(".review_reply, .review_reply_wrapper, .reply")) continue;
    if (isVisible(btn)) return btn;
  }

  return null;
}

function findReplyLikeButton(replyEl) {
  const btn = replyEl.querySelector(".likeWrapper a.like, a.like");
  if (btn && isVisible(btn)) return btn;
  return null;
}

function collectAutoLikeTargets(root = document) {
  const targets = [];

  for (const item of root.querySelectorAll(".review_item")) {
    const author = getAuthorName(item);
    if (author) targets.push({ scope: item, author, kind: "comment" });
  }

  for (const reply of root.querySelectorAll(".review_reply")) {
    const author = getReplyAuthor(reply);
    if (author) targets.push({ scope: reply, author, kind: "reply" });
  }

  return targets;
}

async function expandReplyThreads() {
  for (const item of document.querySelectorAll(".review_item")) {
    const replyBtn = item.querySelector("a.reply_btn");
    if (!replyBtn || !isVisible(replyBtn)) continue;
    const match = (replyBtn.textContent || "").match(/\((\d+)\)/);
    if (!match || parseInt(match[1], 10) === 0) continue;

    const visibleReply = item.querySelector(".w_review_replys .review_reply");
    if (visibleReply && isVisible(visibleReply)) continue;

    activateClick(replyBtn);
    await sleep(500);
  }

  for (const reply of document.querySelectorAll(".review_reply")) {
    const nestedBtn = reply.querySelector("a.any_reply_btn");
    if (!nestedBtn || !isVisible(nestedBtn)) continue;

    const nestedReply = reply.querySelector(".any_review_box .review_reply");
    if (nestedReply && isVisible(nestedReply)) continue;

    activateClick(nestedBtn);
    await sleep(400);
  }
}

async function likeCommentsForUsers(likeUsers) {
  const users = (likeUsers || []).map((name) => String(name || "").trim()).filter(Boolean);
  if (!users.length) return 0;

  await expandReplyThreads();

  const clicked = new Set();
  let liked = 0;

  for (const { scope, author } of collectAutoLikeTargets(document)) {
    if (!isAuthorInLikeList(author, users)) continue;

    const likeBtn =
      scope.classList.contains("review_reply")
        ? findReplyLikeButton(scope)
        : findMainCommentLikeButton(scope);

    if (!likeBtn || !isVisible(likeBtn)) continue;

    const key = getLikeButtonKey(likeBtn);
    if (key && clicked.has(key)) continue;
    if (key) clicked.add(key);

    activateClick(likeBtn);
    liked += 1;
    await sleep(600);
  }

  return liked;
}

function isEligibleTopLevelComment(item) {
  const author = getAuthorName(item);
  if (isOneMasterAuthor(author)) return false;
  if (oneMasterRepliedInThread(item)) return false;
  const text = getCommentText(item);
  if (!text) return false;
  return true;
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
  const writeReply = getWriteReplyBox(item);
  if (!writeReply || writeReply.classList.contains("hide") || !isVisible(writeReply)) {
    return null;
  }

  const selectors = [
    "button.textbtn",
    "button.btn.textbtn",
    "input[type='submit']",
    "button[type='submit']",
  ];
  for (const selector of selectors) {
    const el = writeReply.querySelector(selector);
    if (isVisible(el)) return el;
  }

  for (const el of writeReply.querySelectorAll("button, input[type=button], input[type=submit]")) {
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

async function fetchReviewListDoc(proId) {
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
  return new DOMParser().parseFromString(html, "text/html");
}

function extractCommentTexts(root) {
  return [...root.querySelectorAll(".review_item .review_main .content")]
    .map((el) => el.textContent.trim())
    .filter(Boolean);
}

async function fetchComments(proId) {
  const doc = await fetchReviewListDoc(proId);
  return extractCommentTexts(doc);
}

async function getReplyContext() {
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

  let reviewRoot = document;
  let comments = [];

  try {
    reviewRoot = await fetchReviewListDoc(proId);
    comments = extractCommentTexts(reviewRoot);
  } catch (_) {
    comments = extractCommentTexts(document);
  }

  const hasOneMasterComment =
    hasOneMasterActivityOnFirstPage(reviewRoot) ||
    hasOneMasterActivityOnFirstPage(document);
  if (hasOneMasterComment) {
    return {
      proId,
      title,
      description,
      comments,
      eligibleComments: [],
      hasOneMasterComment: true,
    };
  }

  const topLevel = getTopLevelReviewItems(reviewRoot);
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
    hasOneMasterComment: false,
  };
}

async function prepareShowZProductPage(autoLikeUsers) {
  await ensureReviewListReady();
  const likedCount = await likeCommentsForUsers(autoLikeUsers);

  const proId = getProductId();
  let reviewRoot = document;
  if (proId) {
    try {
      reviewRoot = await fetchReviewListDoc(proId);
    } catch (_) {
      /* use live DOM */
    }
  }

  const hasOneMasterComment =
    hasOneMasterActivityOnFirstPage(reviewRoot) ||
    hasOneMasterActivityOnFirstPage(document);
  return { likedCount, hasOneMasterComment };
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
  submitDelayMs = 10000,
  author = "",
  text = "",
  autoLikeUsers = []
) {
  abortRequested = false;
  const targetKey = buildReplyTargetKey(author, text);

  if (getReplyGuardEntry(targetKey) || replySubmitInFlight) {
    return { filled: true, submitted: true, skipped: true };
  }

  await ensureReviewListReady();
  await likeCommentsForUsers(autoLikeUsers);
  const item = resolveCommentTarget(commentIndex, author, text);

  if (threadHasReplyWithText(item, replyText)) {
    markReplyGuardSubmitted(targetKey, replyText);
    return { filled: true, submitted: true, skipped: true };
  }

  replySubmitInFlight = true;

  try {
    const likeBtn = findLikeButton(item);
    if (likeBtn) {
      activateClick(likeBtn);
      await sleep(600);
    }

    await openReplyForm(item);
    const { textarea, submitBtn } = await waitForReplyForm(item, 15000, true);

    textarea.focus();
    textarea.classList.remove("default");
    textarea.value = replyText;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    if (!textarea.value.trim()) {
      throw new Error("Failed to fill reply textarea");
    }

    const waitMs = Math.max(1000, Math.min(120000, Number(submitDelayMs) || 10000));
    await sleep(waitMs);

    if (!submitBtn || !isVisible(submitBtn)) {
      throw new Error("Reply submit button not found");
    }

    if (threadHasReplyWithText(item, replyText)) {
      markReplyGuardSubmitted(targetKey, replyText);
      return { filled: true, submitted: true, skipped: true };
    }

    clickOnce(submitBtn);
    markReplyGuardSubmitted(targetKey, replyText);

    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (abortRequested) throw new Error("Stopped by user");
      if (threadHasReplyWithText(item, replyText)) {
        return { filled: true, submitted: true };
      }
      if (!isReplyFormOpen(item) || !findReplyTextarea(item)) {
        return { filled: true, submitted: true };
      }
      await sleep(300);
    }

    return { filled: true, submitted: true };
  } finally {
    replySubmitInFlight = false;
  }
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

      if (message.type === "PREPARE_SHOWZ_PRODUCT") {
        sendResponse(await prepareShowZProductPage(message.autoLikeUsers || []));
        return;
      }

      if (message.type === "ENSURE_REVIEWS") {
        await ensureReviewListReady();
        const likedCount = await likeCommentsForUsers(message.autoLikeUsers || []);
        sendResponse({
          ok: true,
          count: getTopLevelReviewItems().length,
          likedCount,
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
            message.text,
            message.autoLikeUsers
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
