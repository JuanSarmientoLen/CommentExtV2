# Firefox Add-ons (AMO) Submission — OneMaster CommentExt v4.7.1

## Before you upload

1. Copy `background/config.example.js` to `background/config.js` and add your Cursor API key for local testing.
2. Build the submission zip (excludes secrets and dev files):

   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\package-amo.ps1
   ```

   **Important:** Do not zip the folder manually or use PowerShell `Compress-Archive` / Windows "Send to Compressed folder". Those tools write backslash paths (`background\file.js`) and AMO will reject the upload with `Invalid file name in archive`. Always use `tools\package-amo.ps1`, which writes forward-slash paths (`background/file.js`).

   Alternative: [web-ext build](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/#packaging-your-extension) also produces AMO-compatible zips.

3. Upload `onemaster-commentext-4.7.1.zip` at:
   https://addons.mozilla.org/developers/addon/submit/

## AMO listing checklist

- **Version:** 4.7.1
- **Extension ID:** `commentext@commentext.local`
- **Min Firefox:** 140.0 (desktop and Android)
- **Privacy policy:** Paste or host `PRIVACY.md` and link it in the AMO developer dashboard
- **Data collection (manifest):** `websiteContent` — product text sent to Cursor API with the user’s API key
- **Icons:** 48×48 and 96×96 PNG included
- **Reviewer notes:** Users configure their Cursor API key in Settings (popup) or `background/config.js`

## Suggested reviewer notes

> This extension helps users post product comments on Gundamit, Chowbrick, and ShowZ Store. On desktop, Gundamit/Chowbrick use a multi-tab auto-run from the popup. ShowZ picks one random product, likes a comment, opens the reply form, and fills generated text (user submits manually). A Cursor cloud agent stays warm until the user clicks Stop Agent. On Firefox for Android, assist mode lets the user open a product page and generate one comment on that tab. Product page text is sent to api.cursor.com using the user’s own API key. No remote code is loaded. Each action is started manually from the popup.

## After changing the extension ID

If you previously installed a dev build with a different extension ID, remove it before installing the AMO-signed build.
