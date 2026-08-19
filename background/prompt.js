async function buildPrompt(description, comments) {
  const settings = await getSettings();
  const otherComments =
    comments.length > 0
      ? comments.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "(none yet)";

  return `${settings.commentRules}

PRODUCT DESCRIPTION:
${description}

OTHER_COMMENTS:
${otherComments}`;
}

async function buildReplyPrompt(description, targetComment, otherComments, commentAuthor) {
  const settings = await getSettings();
  const other =
    otherComments.length > 0
      ? otherComments.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "(none)";

  return `${settings.showzReplyRules}

PRODUCT DESCRIPTION:
${description}

COMMENT TO REPLY TO (by ${commentAuthor || "user"}):
${targetComment}

OTHER COMMENTS ON PAGE:
${other}`;
}
