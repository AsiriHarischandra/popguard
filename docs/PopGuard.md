# PopGuard: Click Redirect & Pop-up Blocker

**Author:** Asiri Harischandra
**Current version:** 2.1.4
**Store:** [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/pbiabfkcfocjnfljhpkipnelboohpbca)
**Source code:** [github.com/AsiriHarischandra/popguard](https://github.com/AsiriHarischandra/popguard)
**License:** MIT

---

## 1. What PopGuard is

PopGuard is a browser extension for Microsoft Edge and Google Chrome. It stops websites from **hijacking your clicks**.

On many streaming, download and subtitle sites, clicking anywhere (the Play button, the background, a menu) opens an ad tab or sends the page to a betting site. It can take several clicks before the click does what you wanted. PopGuard stops these tricks, blocks ads and trackers, and shows on a dashboard exactly what it stopped.

## 2. The problem it solves

Ordinary ad blockers are good at blocking ad *requests*. Click-hijacking sites use *behaviour* tricks instead, and these change all the time:

| Trick | What the user sees | How PopGuard stops it |
|---|---|---|
| **Pop-up / pop-under** | Clicking anywhere opens an ad window or tab | Allows `window.open` only when the user clicked a real link to that address |
| **Invisible overlay** | A see-through layer covers the page, so every click lands on an ad | Finds large, transparent, high z-index layers, removes them, and passes the click to the real button underneath |
| **Click-redirect / tab-under** | The current tab jumps to an ad site after a click | Cancels cross-site navigations that happen right after a click and don't match the clicked link |
| **Timed redirect** | The page jumps to another site minutes later, with no click | Cancels script timers and delayed refreshes; undoes redirects started by ad boxes |
| **Fake clicks** | A script secretly "clicks" a hidden ad link | Intercepts programmatic clicks on links to other sites |
| **Clean `window.open` trick** | A script takes an unprotected `window.open` from a new iframe | Protects `window.open` in every frame |
| **Ad tabs that slip through** | A new ad tab opens anyway | The background script closes it, returns you to your page, and offers **Open anyway** |

## 3. Features

### Click protection
- Blocks pop-ups, pop-unders, tab-unders and click-redirects
- Blocks **timed redirects** that fire minutes after a page loads (2.1.2)
- Removes invisible click-catching overlays
- Shows a small notice for every block, with an **Open anyway** / **Go anyway** button in case it was wanted, including for tabs the background closed (2.1.4)

### Ad and tracker blocking
- Three built-in lists, each can be switched on or off:
  - **Ad networks** (59 domains): pop-under networks, Google ads, Taboola, Outbrain and others
  - **Trackers** (63 rules): Google Analytics, Facebook Pixel, Hotjar, Microsoft Clarity, Mixpanel and others
  - **Betting & casino ads** (15 rules): 1xBet, Melbet, Mostbet and affiliate redirect domains
- A company's own trackers are allowed on that company's own sites (for example LinkedIn's on linkedin.com) and blocked everywhere else (2.1.3)
- **Banner hiding:** known ad boxes, plus banner-shaped images and iframes that link to other sites
- **Right-click → "PopGuard: Hide this ad"** for anything the automatic rules miss

### Control and insight
- **Popup:** blocks on this page, today and all time, plus a **Protect this site** switch
- **Dashboard:** blocks per day (stacked chart with tooltips and a table view), top sites, most-blocked domains, breakdown by type, light and dark mode
- **Filters:** import filter lists by URL (EasyList-style `||domain^`, hosts files, plain domain lists), your own blocked domains, and element-hiding rules (`site.com##.selector`)
- **Whitelist:** trusted sites get no blocking at all
- **Settings:** turn each protection on or off, export/import settings, reset statistics

### Never interferes with
- The Edge New Tab page and its shortcuts
- Sign-in pages and sign-in pop-ups (Microsoft, Google, Apple, GitHub, Facebook, LinkedIn, PayPal and others)
- **Sites of the same company opening each other** (Google Classroom → YouTube, Outlook → Teams, Instagram → Facebook) (2.1.4)
- **Embedded players opening their own site** (the YouTube button in a YouTube video on Google Classroom) (2.1.4)
- Redirects while a page is still loading, and anything right after the user clicks or types

## 4. How to install and use

### Install
- **From the store (recommended):** open the [Edge Add-ons page](https://microsoftedge.microsoft.com/addons/detail/pbiabfkcfocjnfljhpkipnelboohpbca) and click **Get**. Updates install automatically.
- **Developer mode:** download the repository, open `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension` folder.

### Everyday use
| I want to… | Do this |
|---|---|
| See what was blocked on this page | Click the shield icon |
| Turn PopGuard off for one site | Shield icon → switch off **Protect this site** |
| Hide an ad PopGuard missed | Right-click the ad → **PopGuard: Hide this ad** |
| Get back ads I hid by mistake | Shield icon → **Unhide ads here** |
| Allow a blocked pop-up, tab or redirect | Click **Open anyway** / **Go anyway** on the notice |
| See statistics, filters and settings | Shield icon → **Dashboard** |
| Block more domains | Dashboard → **Filters** → import a list or add your own domains |

## 5. How it works

```
Web page (every frame)
  inject.js     runs inside the page itself, before site scripts:
                guards window.open, link clicks and navigations
  content.js    removes overlays, reports real user clicks,
                shows the "closed a new tab - Open anyway" notice
  cosmetic.js   hides banner ads and your right-click picks
        │ messages
        ▼
Service worker (background)
  guard.js      registers inject.js, closes ad tabs, undoes timed redirects
  filters.js    built-in lists, whitelist, custom and imported rules
  stats.js      batched statistics
  netstats.js   counts network blocks
  families.js   which sites belong to the same company (shared with inject.js)
        │
        ▼
Browser rule engine (declarativeNetRequest)      chrome.storage.local
blocks ad and tracker requests                    settings, filters, statistics
        │
        ▼
Dashboard and popup
```

### Key design decisions
- **Two script worlds.** The page guard must run in the page's own JavaScript world at `document_start`, before any site script, so it can protect `window.open`. It talks to the extension side through a `CustomEvent`.
- **Settings without waiting.** Page-world scripts can't read extension storage, so switched-off features are passed in by registering small flag files before `inject.js`.
- **Whitelist at the network level.** High-priority `allowAllRequests` and initiator-based `allow` rules beat every block rule, so trusted sites load untouched.
- **Same-company sites.** A short list of companies and their sites (`shared/families.js`) lets pages of one company open each other. Ad domains are deliberately not on it, and network blocking doesn't use it.
- **Safe "Open anyway" for closed tabs.** The notice is drawn by the extension in a closed shadow root that the page can't reach, and the background only reopens the exact address it just closed in that tab, so a page can't use it to open its own tabs.
- **Two statistics modes.** Developer installs use `onRuleMatchedDebug`. Store installs poll `getMatchedRules()` once a minute and keep a short history of which page each tab showed, so blocks are credited to the right site.
- **Batched statistics.** Writes happen at most once per second through a promise chain, so bursts of blocks never collide.
- **No libraries.** Extension pages can't load scripts from the internet under Manifest V3, so the chart is a small hand-written SVG renderer with a colour-blind-safe palette.

## 6. Privacy

PopGuard **collects nothing**: no account, no server, no analytics. Settings, filters and statistics stay in the browser. The only network request PopGuard makes for itself is downloading a filter list when the user asks for one. Full policy: [PRIVACY.md](../PRIVACY.md).

### Permissions and why they're needed
| Permission | Why |
|---|---|
| Access to all websites | Pop-ups, redirects and ads can appear on any site |
| `declarativeNetRequest` | Blocks ad and tracker requests with the browser's own rule engine |
| `declarativeNetRequestFeedback` | Counts blocked requests for the dashboard |
| `scripting` | Adds the page guard, skipping trusted sites |
| `tabs`, `webNavigation` | Spots and closes ad tabs; undoes timed redirects |
| `contextMenus` | Right-click "Hide this ad" |
| `storage`, `unlimitedStorage` | Saves settings, filters and statistics locally |
| `alarms` | Updates block counters once a minute |

## 7. Testing

The extension is tested end to end with **Playwright**: the real extension runs in Chromium against test pages that copy each trick. `localhost` and `127.0.0.1` act as two different websites; `www.youtube.com` and `classroom.google.com` are mapped to a local HTTPS server with a test-only certificate.

**28 automated tests** cover:
- pop-ups blocked, while real links still open (including links inside web components)
- embedded players opening their own site (YouTube in Google Classroom), while unknown iframes still can't
- same-company sites opening each other, while other sites can't
- the "Open anyway" notice for closed tabs, which reopens only the tab that was closed
- overlays removed, with the click passed through
- click-redirects, tab-unders, fake clicks and the iframe `window.open` trick
- timed redirects (script timer, meta refresh, ad iframe), while normal loading redirects and links clicked after reading still work
- Edge New Tab shortcuts and sign-in redirects never blocked
- banner hiding without hiding normal content
- tracker, custom-domain and imported-list blocking
- a company's own trackers allowed on its own site only
- whitelist, settings switches, statistics in both modes, and the dashboard

```bash
npm install
npm test               # run all tests
npm run build          # store upload: dist/popguard-<version>-store.zip
npm run screenshots    # README screenshots (demo data)
npm run store-images   # store screenshots and promo tiles
npm run icons          # render icons from docs/store/icon.svg
```

## 8. Project structure

```
extension/
  manifest.json
  background/   service-worker.js · guard.js · filters.js · stats.js · netstats.js
  content/      inject.js · content.js · cosmetic.js · flags/
  rules/        ads.json · trackers.json · betting.json
  shared/       defaults.js · families.js
  ui/           dashboard.* · chart.js · popup.* · theme.css
tests/          e2e.test.mjs · fixtures/ · certs/ (test-only certificate)
scripts/        build.mjs · store-images.mjs · render-icons.mjs
docs/           PopGuard.md · screenshots/ · store/ (listing text, images, publishing guide)
PRIVACY.md · CHANGELOG.md · README.md · LICENSE
```

## 9. Version history

| Version | Highlights |
|---|---|
| 1.0 | First personal version: pop-up, pop-under, tab-under, fake-click and overlay blocking |
| 1.1 | Banner hiding and right-click "Hide this ad" |
| 1.1.1–1.1.2 | Edge New Tab shortcuts fixed |
| 2.0.0 | Portfolio rebuild: tracker blocking, statistics dashboard, custom filter lists, whitelist, settings, tests |
| 2.0.1–2.0.3 | New Tab and shadow-DOM link fixes; trusted pages never blocked |
| 2.1.0 | Store-ready: store statistics mode, new icon, privacy policy, store listing and images, build script |
| 2.1.1 | Sign-in redirects never blocked. **Published on Microsoft Edge Add-ons** |
| 2.1.2 | Blocks timed redirects |
| 2.1.3 | A company's own trackers allowed on its own sites (fixes LinkedIn account switching) |
| 2.1.4 | Embedded players can open their own site (fixes the YouTube button on Google Classroom videos); same-company sites can open each other; "Open anyway" for closed tabs |

## 10. Development workflow

- Changes are made on a **branch** and merged into `main` through a **pull request**. `main` is protected by a GitHub ruleset: pull request required, no force pushes, no deletion.
- Every change comes with a test, and all tests must pass before release.
- A release means: raise the version in `manifest.json`, run `npm test` and `npm run build`, then upload the zip in **Partner Center → Update**.

## 11. Known limitations and next steps

- Built-in lists are small and hand-picked. For full coverage, import EasyPrivacy or Peter Lowe's list from the Filters page.
- The same-company list covers the big platforms (Google, Microsoft, Meta, X, Amazon, Apple, Zoom). Other sites that open each other may still need **Open anyway** or a whitelist entry.
- Store installs can't show *which* domain a network block hit (a browser limitation), only the type and the site.
- Redirects started by cross-origin frames are undone after the fact rather than prevented.
- The registrable-domain check is a heuristic, not the full Public Suffix List.
- Planned: Chrome Web Store release, cosmetic rules from imported lists, a short demo video for the store page.
