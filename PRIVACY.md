# Privacy Policy — OneMaster CommentExt

**Last updated:** August 13, 2026

## Overview

OneMaster CommentExt is a browser extension that helps users post product comments on Gundamit and Chowbrick. This policy describes what data the extension accesses, stores, and transmits.

## Data accessed locally

- **Product page content:** Product descriptions and existing public comments on supported store pages.
- **Browsing activity (local only):** Product URLs you have recently commented on are stored in `browser.storage.local` for up to 4 days to avoid duplicate posts. This data stays on your device and is not sent to us.

## Data transmitted to third parties

- **Cursor API (`api.cursor.com`):** When you start a run, product descriptions and existing comments are sent to the Cursor API using **your own API key** to generate comment text. Cursor’s privacy policy applies to that service: https://cursor.com/privacy
- No data is sent to OneMaster or any other third-party server operated by the extension author.

## Data not collected

The extension does not collect:

- Names, email addresses, or account passwords
- Payment or financial information
- Precise location data
- Bookmarks or general browsing history outside the supported product pages during an active run

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Save product cooldown history and run logs on your device |
| `tabs` | Open and manage product pages during automation |
| `scripting` | Inject content scripts on Gundamit and Chowbrick |
| `gundamit.com` / `chowbrick.com` | Read product pages and submit comments when you start a run |
| `api.cursor.com` | Generate comments via your Cursor API key |

## Your choices

- You must supply your own Cursor API key in `background/config.js`.
- You can clear product history from the extension popup at any time.
- You can uninstall the extension to remove all locally stored data.

## Contact

For privacy questions about this extension, contact the developer through the Firefox Add-ons listing support channel.
