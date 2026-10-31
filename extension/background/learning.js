/*
 * Smart Ad Learning - background side (Phase 1: analyse and validate only).
 *
 * When the user picks "PopGuard: Hide this ad", this runs content/learn.js in the clicked frame,
 * finishes the scoring with what only the background knows (PopGuard's ad host lists, which sites
 * belong to the same company) and keeps the result as a DRAFT in chrome.storage.session:
 * the last 20 analyses, cleared when the browser closes. Drafts are never applied as blocking
 * rules in Phase 1 - "Hide this ad" keeps hiding exactly as before.
 */
const PGLearning = (() => {
  const MAX_DRAFTS = 20;
  let chain = Promise.resolve(); // one draft write at a time

  async function analyze(tabId, frameId = 0) {
    let res;
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['shared/learn-core.js', 'content/learn.js'] });
      res = r?.result;
    } catch {
      return { error: 'unsupported-page' }; // browser pages, PDF viewer, frames PopGuard can't reach
    }
    if (!res || res.error) return res || { error: 'no-result' };

    // ---- what only the background knows ----
    const h = res.pattern.hosts;
    const hosts = [...new Set([h.frame, h.link, h.img].filter(Boolean))];
    const adHost = {};
    for (const host of hosts) adHost[host] = await PGFilters.isAdHost(host);
    res.signals.knownAdHost = hosts.some((x) => adHost[x]);

    res.candidates = res.candidates
      .map((c) => ({ ...c, ...PGLearn.score(c, c.validation, res.pattern, res.signals) }))
      .sort((a, b) => b.score - a.score);
    const best = res.candidates.find((c) => c.scope);
    res.best = best ? { type: best.type, selector: best.selector, score: best.score, scope: best.scope } : null;

    // A network rule is judged on its own: a good hiding rule doesn't make the server an ad server.
    res.network = hosts.map((host) => ({
      host,
      ...PGLearn.networkScore({
        host,
        sameOwner: PG.sameOwner('https://' + host, 'https://' + res.site),
        cdn: PGLearn.CDN.test(host),
        knownAdHost: adHost[host],
        adWordsInHost: PGLearn.words(host).some((w) => PGLearn.AD_WORDS.has(w)),
      }),
    })).sort((a, b) => b.score - a.score)[0] || null;
    if (res.network) res.network.eligible = res.network.score >= 80; // Phase 1: reported, never applied

    res.status = res.best ? 'validated' : 'rejected';
    res.id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    res.createdAt = Date.now();
    res.active = false; // drafts don't block anything in Phase 1

    chain = chain.then(async () => {
      const { learnDrafts = [] } = await chrome.storage.session.get('learnDrafts');
      const same = learnDrafts.find((d) => d.fingerprint === res.fingerprint && d.site === res.site);
      if (same) res.duplicateOf = same.id;
      const other = learnDrafts.find((d) => d.fingerprint === res.fingerprint && d.site !== res.site);
      if (other) res.alsoSeenOn = other.site; // the same widget on another site: a hint for global rules later
      await chrome.storage.session.set({ learnDrafts: [res, ...learnDrafts].slice(0, MAX_DRAFTS) });
    }).catch(() => {});
    await chain;
    return res;
  }

  /** Short line for the on-page notice. */
  function summary(res) {
    if (!res || res.error) return null;
    if (!res.best) return 'PopGuard studied this ad but found no pattern safe enough to learn.';
    const where = res.best.scope === 'global' ? 'could work on other sites too' : 'for this site';
    return `PopGuard studied this ad: found a ${res.best.score}% match ${where}.`;
  }

  const drafts = () => chrome.storage.session.get('learnDrafts').then((r) => r.learnDrafts || []);

  return { analyze, summary, drafts };
})();
