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
