# PopGuard Privacy Policy

_Last updated: 7 October 2026_

PopGuard is a browser extension that stops pop-ups, click-redirects and invisible ad overlays, and blocks ads and trackers. This policy explains what PopGuard does with your data. The short version: **PopGuard does not collect, send, sell or share any of your data.**

## What PopGuard stores, and where

Everything stays in your own browser, using the browser's extension storage (`chrome.storage.local` / `chrome.storage.session`). It never leaves your device.

| Stored item | Why |
|---|---|
| Settings (which protections are on) | So your choices are remembered |
| Your trusted-site list (whitelist) | So PopGuard leaves those sites alone |
| Your custom blocked domains and element-hiding filters | So your own rules keep working |
| Filter lists you choose to import | So imported rules keep working |
| Block statistics: counts per day and per type, the website where a block happened, and the domain that was blocked | To show you the dashboard |

You can delete the statistics at any time from **Dashboard → Settings → Reset statistics**. Removing the extension deletes everything PopGuard stored.

## What PopGuard does not do

- It does not collect personal information, browsing history, page content, passwords, form data or anything you type.
- It has no account, no server and no analytics.
- It does not send any data to the developer or to anyone else.
- It does not sell or share data, and it does not use data for advertising or credit decisions.

## Network requests PopGuard makes

PopGuard makes only one kind of network request: when **you** paste a filter-list address into **Filters → Import a filter list** (or click Update on one), it downloads that list from the address you gave. Nothing about you is sent with that request beyond what any browser download sends.

## Why PopGuard needs its permissions

| Permission | Why |
|---|---|
| Access to all websites | Pop-ups, redirects and ads can appear on any site, so PopGuard has to run on every page to stop them. It reads page structure only to find ads and click-hijacking tricks, and never reads or sends page content anywhere. |
| `declarativeNetRequest` | Blocks requests to known ad and tracking servers, done by the browser itself. |
| `declarativeNetRequestFeedback` | Counts how many requests were blocked, for your dashboard. |
| `scripting` | Adds the pop-up and redirect protection to pages, skipping your trusted sites. |
| `webNavigation`, `tabs` | Spots new tabs that a page opens without your click (pop-unders) and closes them. |
| `contextMenus` | Adds "PopGuard: Hide this ad" to the right-click menu. |
| `storage`, `unlimitedStorage` | Saves your settings, filters and statistics locally. Imported filter lists can be large. |
| `alarms` | Updates the block counters once a minute. |

## Children

PopGuard does not knowingly collect data from anyone, including children.

## Changes

If this policy changes, the new version will be published here with a new date.

## Contact

Questions: open an issue at https://github.com/AsiriHarischandra/popguard/issues.
