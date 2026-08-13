# Firefox Add-ons (AMO) Submission — OneMaster CommentExt v4.2

## Before you upload

1. Copy `background/config.example.js` to `background/config.js` and add your Cursor API key for local testing.
2. Build the submission zip (excludes secrets and dev files):

   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\package-amo.ps1
   ```

   **Important:** Do not zip the folder manually or use PowerShell `Compress-Archive` / Windows "Send to Compressed folder". Those tools write backslash paths (`background\file.js`) and AMO will reject the upload with `Invalid file name in archive`. Always use `tools\package-amo.ps1`, which writes forward-slash paths (`background/file.js`).

   Alternative: [web-ext build](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/#packaging-your-extension) also produces AMO-compatible zips.

3. Upload `onemaster-commentext-4.2.zip` at:
   https://addons.mozilla.org/developers/addon/submit/

## AMO listing checklist

- **Version:** 4.2
- **Extension ID:** `commentext@commentext.local`
- **Min Firefox:** 140.0 (required for built-in data collection consent)
- **Privacy policy:** Paste or host `PRIVACY.md` and link it in the AMO developer dashboard
- **Data collection (manifest):** `websiteContent` — product text sent to Cursor API with the user’s API key
- **Icons:** 48×48 and 96×96 PNG included
- **Reviewer notes:** Explain that users must configure their own Cursor API key in `background/config.js` after install, or ship a future options page

## Suggested reviewer notes

> This extension automates posting user-generated product comments on Gundamit and Chowbrick. It reads public product page content, sends it to api.cursor.com using the user’s own API key to generate comment text, then fills and submits the store review form. No remote code is loaded. The user starts each run manually from the popup.

## After changing the extension ID

If you previously installed a dev build with a different extension ID, remove it before installing the AMO-signed build.
