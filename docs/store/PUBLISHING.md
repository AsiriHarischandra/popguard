# Publishing PopGuard

Everything you need is in this folder:

- `LISTING.md` has all the text to paste.
- `images/` has the icon, screenshots and promo tiles.
- `../../dist/popguard-<version>-store.zip` is the file you upload. Build it with `npm run build`, or use the zip you were given.

Publish to **Edge first**. It's free, and the review comments help before you pay for Chrome.

---

## Microsoft Edge Add-ons (free)

1. Go to **partner.microsoft.com/dashboard/microsoftedge** and sign in with a Microsoft account.
2. Register as an **Individual** developer. It's free; fill in your name and country.
3. Click **Create new extension** and upload `popguard-<version>-store.zip`.
4. **Availability:** Public, all markets.
5. **Properties:**
   - Category: Productivity
   - Privacy policy URL: from `LISTING.md`
   - Website and support URL: your GitHub link
   - Mature content: No
6. **Store listings → English:**
   - Description: paste from `LISTING.md`
   - Short description: paste the summary
   - Upload the 128px icon, the screenshots and the promotional tiles from `images/`
7. **Submit.** Paste the **Notes for certification** text from `LISTING.md`.
8. Review usually takes a few business days. You'll get an email, and you can follow the status in the dashboard.

## Chrome Web Store (US$5 once)

1. Go to **chrome.google.com/webstore/devconsole** and sign in with a Google account.
2. Pay the one-time **US$5** registration fee and verify your email.
3. Click **New item** and upload `popguard-<version>-store.zip`.
4. **Store listing tab:** paste the description, choose the category and language, and upload the icon, screenshots and promo tiles.
5. **Privacy practices tab:** paste the single purpose and every permission justification from `LISTING.md`. Answer **No** to remote code, tick no data types, and tick the three certifications.
6. **Distribution tab:** Public, all regions.
7. Click **Submit for review**. Reviews for extensions that need access to every site can take from a few days to a few weeks.

## After it's live

- Add the store links to your README and portfolio.
- **To release an update:** raise `"version"` in `extension/manifest.json`, run `npm test`, then `npm run build`, and upload the new zip as a new package in each dashboard. Users get it automatically.

## If a review is rejected

The email names the policy and the reason. The usual causes for blockers are:

- **"Broad host permissions"**: point to the host-permission justification in `LISTING.md`. Protection has to run on every site.
- **"Missing permission justification"**: paste the matching text from `LISTING.md`.
- **"Description doesn't match functionality"**: make sure the screenshots show the real dashboard and popup.

Fix what they mention, raise the version (for example 2.1.0 → 2.1.1), rebuild and resubmit.
