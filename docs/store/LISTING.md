# Store listing: copy and paste

Everything the Chrome Web Store and Microsoft Edge Add-ons forms ask for. Each block below is ready to paste.

---

## Name
```
PopGuard: Click Redirect & Pop-up Blocker
```

## Short description / summary (max 132 characters)
```
Stops sites from hijacking your clicks: blocks pop-ups, click-redirects, invisible ad overlays, ads and trackers.
```

## Detailed description
```
Tired of clicking Play and landing on a betting site? PopGuard stops websites from hijacking your clicks.

On many streaming, download and subtitle sites, one click anywhere opens an ad tab, sends you to another site, or lands on an invisible ad layer. PopGuard stops those tricks so your click does what you meant.

WHAT IT STOPS
• Pop-ups and pop-unders: ad windows that open when you click anywhere on the page
• Click-redirects and "tab-unders": the page jumping to an ad site after a click
• Invisible overlays: see-through layers that catch your clicks. PopGuard removes them and passes your click to the real button underneath
• Fake clicks: scripts that secretly "click" hidden ad links
• Ad tabs that slip through: closed automatically
• Ads and trackers: known ad networks, betting/casino ads and trackers such as Google Analytics, Facebook Pixel and Hotjar
• Banner ads: hidden from the page, and you can right-click any ad and choose "Hide this ad"

YOU STAY IN CONTROL
• "Open anyway" button on every blocked pop-up or redirect, in case you wanted it
• Turn protection off for any site with one click
• Dashboard showing what was blocked each day, on which sites, and by type
• Add your own blocked domains and hiding rules, or import filter lists such as EasyPrivacy
• Switch each protection on or off in Settings

PRIVATE BY DESIGN
PopGuard collects nothing. No account, no server, no analytics. Your settings and statistics stay in your browser.

Open source: https://github.com/AsiriHarischandra/popguard
```

## Category
- Chrome Web Store: **Privacy & Security** (under Productivity in the new category list; use **Productivity** if it isn't offered)
- Edge Add-ons: **Productivity**

## Language
English

## Website / support URL
```
https://github.com/AsiriHarischandra/popguard
```

## Privacy policy URL
```
https://github.com/AsiriHarischandra/popguard/blob/main/PRIVACY.md
```

---

## Chrome Web Store: "Privacy practices" tab

### Single purpose
```
PopGuard protects users from unwanted navigation and advertising on web pages: it blocks pop-ups, click-redirects and invisible click-jacking overlays, and blocks ad and tracker requests.
```

### Permission justifications

**declarativeNetRequest**
```
Blocks network requests to known ad, pop-under and tracking servers using the browser's built-in rule engine. Also applies the user's own blocked domains and imported filter lists.
```

**declarativeNetRequestFeedback**
```
Reads which blocking rules matched so the extension's dashboard can show the user how many ads, trackers and pop-ups were blocked. The data never leaves the browser.
```

**scripting**
```
Registers the pop-up and redirect protection script to run on web pages at document start, and excludes the sites the user has marked as trusted.
```

**tabs**
```
Reads the URL of the tab that opened a new tab, to tell a user-opened link from an ad pop-under, and closes ad tabs the user did not ask for. Also shows the current site in the popup.
```

**webNavigation**
```
Detects when a page opens a new tab or window (onCreatedNavigationTarget) so pop-unders can be closed, and resets the per-page block counter on navigation.
```

**contextMenus**
```
Adds a "PopGuard: Hide this ad" item to the right-click menu so users can hide ads the automatic rules missed.
```

**storage**
```
Saves the user's settings, trusted-site list, custom filters and block statistics locally in the browser.
```

**unlimitedStorage**
```
Filter lists the user imports (for example EasyPrivacy) can contain tens of thousands of domains and exceed the default storage quota.
```

**alarms**
```
Updates the block counters once a minute by reading matched blocking rules, which keeps the statistics accurate without running constantly.
```

**Host permission (<all_urls>)**
```
Pop-ups, click-redirects, invisible overlays and ads can appear on any website, so the protection must run on every page the user visits. The extension only inspects page structure to find these tricks; it does not read, store or transmit page content.
```

### Remote code
```
No, I am not using remote code.
```
(Imported filter lists are plain lists of domain names, treated as data, never executed.)

### Data usage
Tick **none** of the data types: PopGuard does not collect any user data.

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Edge Add-ons: "Notes for certification" (helps reviewers)
```
PopGuard blocks pop-ups, click-redirects and invisible ad overlays, and blocks ad/tracker requests with declarativeNetRequest.

How to test quickly:
1. Visit any site; the dashboard opens on install.
2. Click the shield icon to see the popup; "Protect this site" turns protection off for the current site.
3. Dashboard > Filters: built-in lists can be toggled, and a filter list can be imported by URL (e.g. https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext).

No account is needed. No data is collected or transmitted. Source code: https://github.com/AsiriHarischandra/popguard
```

---

## Images (in docs/store/images/)
| File | Size | Where it goes |
|---|---|---|
| `icon-128.png` | 128×128 | Store icon (both stores) |
| `screenshot-1-dashboard.png` … `screenshot-5-dark.png` | 1280×800 | Screenshots (Chrome: up to 5, Edge: up to 10) |
| `promo-small-440x280.png` | 440×280 | Chrome "Small promo tile"; Edge "Small promotional tile" |
| `promo-marquee-1400x560.png` | 1400×560 | Chrome "Marquee promo tile" (optional); Edge "Large promotional tile" |
