let cachedPlatform = null;

async function getPlatformInfoCached() {
  if (!cachedPlatform) {
    cachedPlatform = await browser.runtime.getPlatformInfo();
  }
  return cachedPlatform;
}

async function isAndroid() {
  const platform = await getPlatformInfoCached();
  return platform.os === "android";
}

function isAssistTabUrl(url) {
  return (
    !!url &&
    /gundamit\.com|chowbrick\.com/i.test(url) &&
    !/New-Update\/?$/i.test(url)
  );
}
