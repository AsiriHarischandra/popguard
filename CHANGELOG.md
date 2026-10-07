# Changelog

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
