// twitter-search-scraper.js
// Collect tweet URLs on a Twitter search page; optionally scroll a few times.
(async () => {
  try {
    const collect = () => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/status/"]'));
      const urls = anchors.map(a => {
        const href = a.getAttribute('href') || '';
        if (!href) return null;
        const u = href.startsWith('http') ? href : `${location.origin}${href}`;
        const m = u.match(/status\/\d+/);
        return m ? u.split('?')[0] : null;
      }).filter(Boolean);
      return Array.from(new Set(urls));
    };

    // Optional: scroll to load more results (adjust iterations/delay as needed)
    const scrollTimes = 4;
    for (let i = 0; i < scrollTimes; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1200));
    }

    const tweets = collect();
    chrome.runtime.sendMessage({ type: 'page-data', tweets });
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'page-data', tweets: [], error: err.message });
  }
})();
