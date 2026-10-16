/*
 * Sites owned by the same company. A page on one of them opening or moving to another
 * (Google Classroom -> YouTube, Outlook -> Teams, Instagram -> Facebook) is never an ad trick,
 * so PopGuard treats them as one site for pop-up and redirect checks. Network blocking is not
 * affected, and ad domains (doubleclick.net, googlesyndication.com, ...) are deliberately left out.
 *
 * Loaded in two places: the service worker, and - registered just before inject.js - the page's
 * MAIN world, where inject.js reads it once and removes the global. Don't also list it in the
 * manifest's content_scripts: Chrome injects a file only once per page, so the MAIN-world copy
 * would silently be skipped.
 */
(() => {
  const FAMILIES = {
    google: ['google.com', 'youtube.com', 'youtube-nocookie.com', 'youtu.be', 'gmail.com', 'withgoogle.com', 'android.com', 'chromium.org'],
    microsoft: ['microsoft.com', 'live.com', 'office.com', 'office365.com', 'microsoft365.com', 'outlook.com', 'bing.com', 'msn.com', 'sharepoint.com', 'onedrive.com', 'skype.com', 'xbox.com', 'windows.com', 'azure.com', 'microsoftonline.com', 'linkedin.com', 'licdn.com', 'github.com'],
    meta: ['facebook.com', 'fb.com', 'fb.watch', 'instagram.com', 'messenger.com', 'whatsapp.com', 'threads.net'],
    x: ['x.com', 'twitter.com'],
    amazon: ['amazon.com', 'primevideo.com', 'twitch.tv', 'imdb.com', 'audible.com'],
    apple: ['apple.com', 'icloud.com'],
    zoom: ['zoom.us', 'zoom.com'],
  };
  const OWNER = new Map();
  for (const [owner, sites] of Object.entries(FAMILIES)) for (const s of sites) OWNER.set(s, owner);

  /** site ("youtube.com") -> owner ("google"), or null for a site no family lists. */
  const ownerOf = (site) => {
    if (!site) return null;
    if (OWNER.has(site)) return OWNER.get(site);
    // country versions: google.lk, google.co.uk, amazon.co.uk, bing.co.uk ...
    const m = /^(google|amazon|youtube)\.(com?\.)?[a-z]{2,3}$/.exec(site);
    return m ? OWNER.get(m[1] + '.com') : null;
  };

  Object.defineProperty(globalThis, '__popguardFamilies', {
    value: Object.freeze({ FAMILIES, ownerOf }), configurable: true, writable: false, enumerable: false,
  });
})();
