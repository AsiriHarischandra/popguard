# Smart Ad Learning

PopGuard learns to recognise ads its filter lists miss, from the ads users right-click with
**PopGuard: Hide this ad**. Everything runs locally in the extension, using DOM inspection, pattern
extraction, fingerprinting, selector generation and rule-based scoring. There is no server, no AI
service, no API key, and nothing is sent anywhere.

**Status:** Phase 1 (analyse and validate) is done. Learned rules are **drafts only**: they are
never applied, and "Hide this ad" hides exactly what it did before.

## How it fits into PopGuard

```
right-click → "PopGuard: Hide this ad"          (existing menu item, service-worker.js)
   │
   ├─ 1. analyse  background/learning.js
   │      runs shared/learn-core.js + content/learn.js in the clicked frame (only now, never on page load)
   │      ├─ find the ad box around the clicked element
   │      ├─ inspect it: tag, classes, id, ad attributes, size, child tags, resource HOSTS
   │      ├─ normalise: drop generated names, keep stable + ad markers → pattern + fingerprint
   │      ├─ candidate selectors, most reliable kind first
   │      └─ validate each one on the page
   │    then, in the background: ad-host lookup (PopGuard's lists), confidence, scope, network score
   │    → draft in chrome.storage.session (last 20, cleared when the browser closes)
   │
   ├─ 2. hide     cosmetic.js (unchanged behaviour): saves site##selector to cosmeticFilters
   └─ 3. notice   "PopGuard studied this ad: found a 97% match …"
```

The analysis runs **before** hiding, while the ad is still visible and has a size. It reuses
PopGuard's existing parts: the menu item, the right-clicked element that `cosmetic.js` already
remembers, the ad and betting host lists, `families.js` (same-company sites), and the notice in
`content.js`. It adds no listeners or observers to normal pages.

## The engine (`shared/learn-core.js`)

| Step | What it does |
|---|---|
| **Token classes** | Every class and id is sorted into one of four kinds. **dynamic** is generated and changes per visit (`css-1x2y3z`, `sc-bdVaJa`, `title__3xK9a`, `a8f3k2b7`, UUIDs, long numbers). **generic** is layout shared by normal content (`row`, `card`, `mb-4`, `col-12`). **ad** contains an ad word (`sidebar-ad`, `adContainer`, `sponsored`, `ad-300x250`). **stable** is everything else. Ad words are matched as whole words, so `header`, `shadow` and `add-to-cart` are not ads. |
| **Id prefixes** | Generated ids keep their stable start: `div-gpt-ad-1700000000123-0` gives `div-gpt-ad-`. |
| **Pattern** | Tag, stable id or id prefix, ad classes, stable classes, ad attributes (`data-ad-slot`), attribute names, a rounded size, child tags, and the hosts of linked / image / frame resources. Generated names are counted but never used. |
| **Fingerprint** | FNV-1a hash of the pattern, with size in 50 px buckets. The same widget gives the same fingerprint on any page or visit, which is what duplicate detection uses (and later, global rules). |
| **Candidates** | In order: ad attribute, id prefix, stable id, ad class, ad resource (`iframe[src*="adhost"]`), stable class, class anchored on a stable parent id, structural fallbacks. |
| **Safety** | `safeSelectorText` only allows short (≤ 200 chars) plain selectors: no braces, semicolons, comments, at-rules or newlines. |

## Validation (`content/learn.js`, on the page)

A candidate is rejected when it:

- doesn't match the ad itself
- is invalid or unsafe text
- matches more than 6 elements, or more than 2% of the page
- would hide `html`, `body`, `main`, `article`, `nav`, `header`, `footer` or `[role=main]`, anything containing a heading, form or input, more than half the screen, or more than 400 characters of text
- also matches normal, text-heavy content next to the ad (`div.card` when real cards use `card` too)

## Confidence and scope

Each kind of candidate starts at a base score: ad attribute 75, id prefix 65, ad class 60, ad resource 55, id 45, class 35, anchored rules 15–40. Then:

- **+8** standard ad size; **+6** labelled "Ad" / "Sponsored"; **+15** loads from a known ad network (or **+4** links to another site); **+8** ad words in its classes / attributes; **+5** marked as an ad for screen readers
- **−6** for each extra element it matches (up to −30)

**Scope:**

- **site**: 60 or more.
- **global**: 85 or more, **and** a portable kind (ad attribute, id prefix, ad class, ad resource), **and** a strong ad marker (a known ad host, an ad attribute, or a strong ad word). A site's own ids and layout classes are never global.
- Below 60: rejected.

**Network rules are scored separately.** A confident hiding rule says nothing about whether a
server only serves ads. A host must be on PopGuard's ad / betting / custom / imported lists
(+80, with +15 for ad words in the name). It scores 0 if it belongs to the same site or company as
the page (`families.js`) or is a shared CDN. A host is "eligible" at 80 or more. In Phase 1 that
is reported, never applied.

## Privacy

- Analysis happens inside the browser, only when the user asks for it.
- Stored: host names, tags, stable class / id names, attribute names (values only for ad
  attributes), rounded sizes, scores. **Not stored:** page URLs, paths, query strings, page text,
  form data, cookies or storage. "Ad" labels and text length are checked, never kept.
- Drafts live in `chrome.storage.session`, which the browser clears when it closes.

## Limits

- Browser pages, the PDF viewer and frames PopGuard can't script return `unsupported-page`. If nothing is right-clicked, the result is `no-element`.
- Inside a cross-origin ad frame, the analysis covers the frame's own content. The frame element itself is still hidden from the top page, as before.
- Elements inside closed shadow DOM can't be reached. The right-click lands on the shadow host.

## Roadmap

| Phase | Scope |
|---|---|
| **1. Foundation** ✅ | Analyse, fingerprint, candidates, validation, confidence, scope, network score, drafts, tests |
| **2. Knowledge base** | Store validated patterns in `chrome.storage.local` (`learnedRules`): id, type, pattern, selector, source site, scope, confidence, created, enabled, validation status. Duplicate / near-duplicate merging by fingerprint. |
| **3. Blocking** | Apply site rules through the existing cosmetic engine. Global rules only after the same fingerprint is confirmed on 2+ sites. Network rules only for eligible hosts, as their own dynamic rule id range. Disable / delete / undo without touching other filters. |
| **4. Dashboard** | List learned rules, source site, scope, confidence, match counts; enable / disable / delete / undo. |
| **5. Algorithm work** | Better box detection, near-duplicate matching, dynamic ads, performance. Always local, no AI services. |
