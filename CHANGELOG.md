# Changelog

## 2.3.1
- Fix: right-click "Hide this ad" on a streaming site could leave a black page. Hiding climbed through
  "wrapper" boxes around the ad, and on sites that nest everything in single-child boxes it reached the box
  around the whole site; right-clicking the video player hid the player. Now:
  - wrappers are only hidden when they are about the same size as the ad
  - the video player, the article, forms, or anything covering more than half the screen is never hidden;
    PopGuard shows "That looks like part of the page..." instead
  - an invisible click-catching layer over the page is still removed (just that layer)
- Fix: a saved rule that hides the page itself is dropped automatically the next time the site is opened
- Tests: 44

## 2.3.0
- New: **Smart Ad Learning, Phase 1** (analyse and validate). When you use right-click "Hide this ad", PopGuard
  first studies the ad locally: finds the ad box, ignores generated class names / ids, builds a fingerprint,
  generates candidate selectors, validates each on the page (rejects ones that would hide normal content or
  too much) and scores them 0-100 with a scope (this site / could work on other sites). Whether its server is an
  ad server is scored separately. Results are drafts in session storage only - nothing new is blocked yet.
  Design and roadmap: `docs/smart-learning.md`
- The analysis code is injected only when you use the menu item; no new permissions; nothing leaves the browser
- Tests: 41

## 2.2.1
- Fix: right-click "Hide this ad" on a normal link hid every link to that site (it saved `a[href*="site"]`).
  That broad rule is now only used when the site is an ad network (on PopGuard's ad / betting lists, your custom
  domains or imported lists, or with ad words in its name); otherwise only the clicked element is hidden
- Fix: "Hide this ad" inside an embedded frame hid every frame from that site (e.g. every embedded video).
  Now only the clicked frame, unless the frame is from an ad network
- Fix: rules are no longer built on generated IDs (like `promo-a8f3k2b7`) that change on every visit
- Tests: 34 (first tests for "Hide this ad")

## 2.2.0
- New: **Pause for 1 hour** in the popup ("Something not working here?"). The site is treated like a
  whitelisted one until the pause runs out, then protection turns back on by itself (an alarm ends it).
  The popup shows "Paused here until 3:45 PM - Resume now" while it lasts
- New: the popup lists the **last few things blocked on this page**, so it's easy to see which block broke a site
- Tests run on GitHub Actions for every pull request and push to `main`; the store zip is uploaded as a build artifact
- Tests: 30

## 2.1.4
- Fix: buttons inside embedded players couldn't open their own site - e.g. the YouTube logo or
  "Watch on YouTube" in a YouTube video on Google Classroom. The player opens the link itself
  (with extras like `&t=42s`), so the new tab didn't match the clicked link exactly and was closed.
  A click inside an embedded frame may now open that frame's own site, and a click inside a known
  company's player may open that company's site. Unknown iframes and plain page clicks are checked as before
- New: sites owned by the same company can open and redirect to each other (Google Classroom -> YouTube,
  Outlook -> Teams, Instagram -> Facebook). The list is in `shared/families.js`; ad domains are not on it
  and network blocking doesn't use it
- New: when PopGuard closes a new tab, the page shows "Closed a new tab to ... - Open anyway". The notice
  is drawn in a closed shadow root the page can't reach, and only the tab that was just closed can be reopened
- Tests: 28 (YouTube player on a Classroom-like page, unknown iframe, same-company pop-up, reopen notice);
  `www.youtube.com` and `classroom.google.com` are served locally over HTTPS with a test-only certificate
- Docs: project overview in `docs/PopGuard.md`

## 2.1.3
- Fix: a company's own trackers are no longer blocked on that company's own sites
  (e.g. LinkedIn's ads.linkedin.com / snap.licdn.com on linkedin.com). Blocking them there doesn't
  stop cross-site tracking, and it broke LinkedIn account switching. They stay blocked on every other site.
  Covers LinkedIn, Google, Microsoft, Facebook, X, TikTok, Pinterest, Snapchat, Yandex, Baidu, Mail.ru and HubSpot.

## 2.1.2
- New: blocks timed redirects - pages that jump to another site minutes after loading, with no click
  (script timers and delayed meta-refresh are cancelled in the page with a "Go anyway" notice;
  redirects started by ad iframes are undone by the background script)
- Redirects while a page is still loading, and redirects right after the user did something, are left alone

## 2.1.1
- Published on Microsoft Edge Add-ons: https://microsoftedge.microsoft.com/addons/detail/pbiabfkcfocjnfljhpkipnelboohpbca
- Fix: sign-in flows were blocked as redirects (e.g. Microsoft's account picker moving to login.live.com).
  Redirects and pop-ups to known sign-in/payment hosts are always allowed, and sign-in pages are trusted

## 2.1.0 (store-ready)
- Statistics work in store installs: `getMatchedRules()` is polled once a minute (and when the popup or dashboard opens),
  with a per-tab URL history so blocks are credited to the right site
- New icon (shield + pointer) rendered from SVG at every size; store icon follows the 96-in-128 guideline
- Store name and description; `homepage_url`
- Privacy policy (PRIVACY.md); store listing text and permission justifications (docs/store/LISTING.md); publishing guide
- Store screenshots (1280x800) and promo tiles generated by `npm run store-images`
- `npm run build` makes the upload zip with no extra tools (works on Windows)
- Fix: "blocked" notice no longer breaks domain names mid-word

## 2.0.3
- Fix: New Tab shortcuts that open in a new tab were closed as pop-ups. Edge reports their opener as
  `edge://newtab/`; tabs opened by browser pages (`edge://`, `chrome://`, extension pages) are never judged now
- Fix: concurrent dynamic-rule rebuilds could collide ("Rule with id N does not have a unique ID"); rebuilds are serialized

## 2.0.2
- Fix: Edge New Tab shortcuts. Trusted pages now get an initiator-based `allow` rule, so their own requests
  (e.g. Microsoft telemetry the tiles wait on) are never blocked, even when the browser prerenders the page

## 2.0.1
- Fix: browser start pages (Edge New Tab, `ntp.msn.com`) are always trusted, so shortcut tiles work
- Fix: link detection now looks inside shadow DOM (`composedPath()`), so links in web components count as real clicks

## 2.0.0
- Tracker blocking ruleset (Google Analytics, Facebook Pixel, Hotjar, Clarity and more)
- Statistics dashboard: per-day stacked chart, totals, top sites, top blocked domains, breakdown by type
- Custom filters: import lists by URL, custom blocked domains, element-hiding filters
- Whitelist management page; whitelist now also bypasses network rules
- Settings page with per-feature toggles, export/import, reset stats
- Restructured into background/content/ui modules; Playwright end-to-end tests

## 1.1.0
- Banner ad hiding and right-click "Hide this ad"

## 1.0.0
- Pop-up, pop-under, tab-under, fake-click and invisible-overlay blocking
