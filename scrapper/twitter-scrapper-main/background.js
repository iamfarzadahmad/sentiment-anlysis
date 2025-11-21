//--------------------------------------
// CONFIG
//--------------------------------------
const page_delay_min = 3000;
const page_delay_range = 2000;
const image_delay_min = 100;
const image_delay_range = 50;
const TWEET_CACHE_LIMIT = 30;

//--------------------------------------
// STATE
//--------------------------------------
let isPaused = false;
let isRunning = false;
let pageDataResolver = null;
let currentTabId = null;
let totalPages = null;
let finalPage = null;
let startPage = 1;
let maxPages = 1;
const postIdToPage = {};
const scrapeStateKey = 'sa_scraper_state';
const tweetCache = new Map();
const downloadedMedia = new Set();
const logBuffer = [];

//--------------------------------------
// HELPERS
//--------------------------------------
function delayRandom(min, range) {
  const ms = min + Math.floor(Math.random() * range);
  return new Promise(res => setTimeout(res, ms));
}

function waitWithTimeout(executor, timeout = 10000, onTimeout) {
    return new Promise((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            if (onTimeout) onTimeout();
            reject(new Error(`Timeout after ${timeout} ms`));
        }, timeout);

        executor(
            (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

function waitForPageLoad(tabId, timeout = 30000) {
    return waitWithTimeout((resolve) => {
        const listener = function(details) {
            if (details.tabId === tabId && details.frameId === 0) {
                chrome.webNavigation.onCompleted.removeListener(listener);
                log(`[waitForPageLoad] Page load completed for tab ${tabId}.`);
                resolve();
            }
        };
        chrome.webNavigation.onCompleted.addListener(listener);
    }, timeout, () => {
        log(`[waitForPageLoad] Timeout waiting for page load on tab ${tabId}`);
    });
}

async function scrapeInTab(pageUrl, selector_to_await, scriptFile) {
    await new Promise(resolve => chrome.tabs.update(currentTabId, { url: pageUrl }, resolve));
    log(`[scrapeThread] Tab updated, waiting for ${pageUrl} page load...`);
    await waitForPageLoad(currentTabId);
    await new Promise(r => setTimeout(r, 200)); // give JS context time to reset; hoping this helps to not inject script twice.
    log(`[scrapeThread] ${pageUrl} load complete.`);

    const pageDataPromise = waitWithTimeout((resolve) => {
          pageDataResolver = resolve;
      }, 20000, () => {
          isPaused = true;
          chrome.runtime.sendMessage({
              type: 'status',
              text: '🛑 Error: Timeout waiting for page data — paused.'
          });
    });

    // Now inject script
    log(`Will attempt to inject script into ${pageUrl}...`);
    await new Promise((resolve, reject) => {
      chrome.tabs.executeScript(currentTabId, { file: scriptFile, runAt: 'document_idle' }, res => {
        if (chrome.runtime.lastError) {
          log(`❌ Failed to inject ${scriptFile}: ${chrome.runtime.lastError.message}`);
          reject(chrome.runtime.lastError);
          return;
        }
        log(`📥 ${scriptFile} injected`);
        resolve(res);
      });
    });
  return await pageDataPromise;
}

function fetchWithTimeout(url, options = {}, timeout = 5000) {
    const controller = new AbortController();
    return waitWithTimeout((resolve, reject) => {
        const signal = controller.signal;
        fetch(url, { ...options, signal })
            .then(resolve)
            .catch(reject);
    }, timeout, () => controller.abort());
}

async function downloadBlob(blob, folder, filename) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename: `${folder}/${filename}`,
      saveAs: false,
      conflictAction: 'overwrite'
    }, (downloadId) => {
      // Delay revoke to ensure download start
      setTimeout(() => URL.revokeObjectURL(url), 200);
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(downloadId);
    });
  });
}

function log(msg) {
  console.log(`[SA Scraper] ${msg}`);
  logBuffer.push(msg);
  chrome.runtime.sendMessage({ type: 'status', text: msg });
}

async function waitWhilePaused() {
  while (isPaused) {
    log("[waitWhilePaused] Paused; waiting 1s...");
    await new Promise(r => setTimeout(r, 1000));
  }
}

function storageLocal(action, keyOrObj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local[action](keyOrObj, result => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

// Remove/block somethingawful images/media from the original network traffic, since we'll need a separate fetch to scrape each one anyway.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Only block if blocking is enabled and tabId matches
    if (currentTabId !== null && details.tabId === currentTabId && details.url.includes('forums.somethingawful.com')) {
      return { cancel: true };
    }
    // Otherwise do not block
  },
  {
    // Filter for all URLs, but you can restrict to SA domains or relevant origins
    urls: ["<all_urls>"],
    types: ["image", "media", "object", "other"] // block images, videos, and possibly other media types
  },
  ["blocking"]
);

function exportLogs(threadID) {
  const blob = new Blob([logBuffer.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url: url,
    filename: 'sa_scraper_log_'+threadID+'.txt',
    conflictAction: 'overwrite',
    saveAs: false,
  }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

//--------------------------------------
// TWEETS
//--------------------------------------
async function fetchTweetFromArchive(tweetUrl) {
  // Step 1: Find the most recent capture timestamp via Wayback CDX API
  const cdxApi = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(tweetUrl)}&output=json&fl=timestamp,original&filter=statuscode:200&limit=1&collapse=digest`;
  const resp = await fetchWithTimeout(cdxApi, {}, 15000);
  const arr = await resp.json();
  if (!Array.isArray(arr) || arr.length < 2) throw new Error("No archive snapshot found for tweet");

  log(`Internet Archive retrieval will be used for ${tweetUrl}`);

  const [header, snap] = arr;
  const [timestamp] = snap;
  const waybackUrl = `https://web.archive.org/web/${timestamp}id_/${tweetUrl}`;

  // Step 2: Fetch the archived tweet HTML
  const wbResp = await fetchWithTimeout(waybackUrl, {}, 20000);
  const html = await wbResp.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Step 3: Extract permalink time and convert to ISO
  let tweetTime = "";
  const timeEl = doc.querySelector('.tweet-timestamp');
  if (timeEl) {
    const timeSpan = timeEl.querySelector('span._timestamp');
    // Prefer numeric 'data-time' attribute to avoid locale issues
    let numericTime = timeSpan?.getAttribute('data-time') || timeSpan?.getAttribute('data-time-ms');
    if (numericTime) {
      tweetTime = new Date(parseInt(numericTime, 10) * 1000).toISOString();
    } else {
      tweetTime = timeEl.getAttribute('title') || "";
    }
  }

  // Step 4: Extract linkback (permalink URL) for the tweet
  const linkEl = timeEl?.closest('a[href*="/status/"]') || doc.querySelector('.tweet-timestamp.js-permalink');
  const linkback = linkEl ? new URL(linkEl.getAttribute('href'), 'https://web.archive.org').href : tweetUrl;

  // Step 5: Extract author info
  const authorName = doc.querySelector('.FullNameGroup .fullname')?.textContent.trim() || "";
  const authorHandle = doc.querySelector('.username.u-dir b')?.textContent.trim() || "";
  const authorAnchor = doc.querySelector('.permalink-header .account-group');
  const authorUrl = authorAnchor ? new URL(authorAnchor.getAttribute('href'), 'https://twitter.com').href : "";

  // Step 6: Extract main tweet HTML content
  const mainTweetEl = doc.querySelector('p.tweet-text, div.tweet-text');
  const mainHTML = mainTweetEl ? mainTweetEl.innerHTML : '';

  // Step 7: Extract quoted tweet info
  let quotedName = "", quotedHandle = "", quotedUrl = "", quoteHTML = "";
  const quoteTweetEl = doc.querySelector('.QuoteTweet');
  if (quoteTweetEl) {
    quotedName = quoteTweetEl.querySelector('.fullname')?.textContent.trim() || '';
    quotedHandle = quoteTweetEl.querySelector('.username b')?.textContent.trim() || '';
    quotedUrl = quotedHandle ? `https://twitter.com/${quotedHandle}` : '';
    quoteHTML = quoteTweetEl.querySelector('.QuoteTweet-text')?.innerHTML || '';
  }

  // Step 8: Extract up to 5 replies' text
  const replyEls = Array.from(doc.querySelectorAll('p.TweetTextSize.js-tweet-text.tweet-text')).slice(1, 6);
  const replies = replyEls.length ? replyEls.map(el => el.innerHTML) : [];

  // Skip images/video media because archive.org links directly to twitter's CDN for deleted tweets...

  return { authorName, authorHandle, authorUrl, tweetTime, linkback, mainHTML, authorMedia:[], quotedName, quotedHandle, quotedUrl, quoteHTML, quotedMedia:[], replies, tweetUrl };
}


// Cache keyed by tweet URL
function cacheTweet(url, data) {
  log(`Caching tweet ${url}`);
  if (tweetCache.size >= TWEET_CACHE_LIMIT) {
    // Remove oldest
    const oldestKey = tweetCache.keys().next().value;
    tweetCache.delete(oldestKey);
  }
  tweetCache.set(url, data);
}

async function tryFetchAndCache(fetchFn, tweetUrl) {
  try {
    const data = await fetchFn(tweetUrl);
    if (data) {
      cacheTweet(tweetUrl, data);
      return data;
    }
  } catch (err) {
    console.warn(`Failed ${fetchFn.name} for ${tweetUrl}: ${err.message}`);
  }
  return null;
}

async function getTweetData(tweetUrl) {
  if (tweetCache.has(tweetUrl)) {
    log(`Cached tweet was able to be reused: ${tweetUrl}`);
    tweetCache.get(tweetUrl).wasCached = true;
    return tweetCache.get(tweetUrl);
  }
  log(`Cache miss for: ${tweetUrl}`);

  // Try live scrape in controlled tab first
  let data = await tryFetchAndCache( url => scrapeInTab(url,'div[data-testid="tweetText"]', 'tweet-scraper.js'), tweetUrl);
  if (data && !data.error )
    return data;

  if( data?.error )
    log(`Live tweet scraping error: ${data.error}`);

  log(`Cache and Live Tweet scrape both failed; falling back to Internet Archive for ${tweetUrl}`);

  // Fallback: archive.org
  data = await tryFetchAndCache(fetchTweetFromArchive, tweetUrl);
  if (data && !data.error )
    return data;
  if( data?.error )
    log(`Internet Archive tweet scraping error: ${data.error}`);

  // Return minimal fallback placeholder
  const fallbackData = {
    author: '',
    tweetTime: '',
    mainHTML: `<a href="${tweetUrl}" target="_blank">${tweetUrl}</a>`,
    replies: []
  };
  cacheTweet(tweetUrl, fallbackData);
  return fallbackData;
}

function generateLocalTweetBox( { authorName, authorHandle, authorUrl, authorMedia=[], authorCards=[], quotedName, quotedHandle, quotedUrl, quotedMedia=[], quotedCards=[], tweetTime, mainHTML="", quoteHTML, replies=[] },
  tweetUrl) {
  function generateMediaHtml(media) {
    return `
    <div class="tweet-media-container">
      <img src="images/${media.filename}" alt="" class="tweet-media" />
    </div>`;
  }
  function generateCardHtml(card) {
    return `
      <div class="tweet-card">
        <a href="${card.url}" target="_blank" class="tweet-card-link">
          ${card.image ? `<img src="images/${card.filename}" alt="" class="tweet-card-image">` : ''}
          <div class="tweet-card-title">${card.title || ''}</div>
          <div class="tweet-card-publisher">${card.publisher || ''}</div>
        </a>
      </div>`;
  }
  const repliesHTML = replies.length
    ? `<div class="tweet-replies">${replies.map(r => `<div class="tweet-reply">${r}</div>`).join('')}</div>`
    : '';

  const quoteBlock = quotedName ? `
    <div class="tweet-quote">
      <a href="${quotedUrl || '#'}" target="_blank" class="tweet-quote-author">${quotedName}</a> <span class="tweet-handle">${quotedHandle}</span>
      <div>${quoteHTML}</div>
      ${quotedMedia.map(generateMediaHtml).join('')}
      ${quotedCards.map(generateCardHtml).join('')}
    </div>` : '';

  const formattedTime = tweetTime
    ? new Date(tweetTime).toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true, month: 'short', day: 'numeric', year: 'numeric' }).replace(',', ' ·')
    : 'Unknown time';

  return `
    <div class="local-tweet">
      <div class="tweet-header">
        <a href="${authorUrl || '#'}" target="_blank" class="tweet-author">${authorName}</a><br>
        <span class="tweet-handle">${authorHandle}</span>
      </div>
      <div class="tweet-main">${mainHTML}</div>
      ${authorMedia.map(generateMediaHtml).join('')}
      ${authorCards.map(generateCardHtml).join('')}
      ${quoteBlock}
      <div class="tweet-time"><a href="${tweetUrl}" target="_blank" title="${tweetTime}">${formattedTime}</a></div>
      ${repliesHTML}
    </div>
  `;
}
//--------------------------------------
// CORS-SAFE IMAGE FETCH FROM BACKGROUND
//--------------------------------------
async function fetchAndDownloadImage(img, folder) {
  try {
    // Background context bypasses content script CORS limits if permission is granted in manifest
    log(`Fetching image: ${img.url}`);
    const response = await fetchWithTimeout(img.url, { credentials: "include" }, 8000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size > 0) { await downloadBlob(blob, folder + '/images', img.filename); }
    else { throw "Zero size blob." }
    log(`Saved image: images/${img.filename}`);
  } catch (error) {
    log(`🛑 Error fetching image ${img.url}: ${error.message}`);
    /*
    isPaused = true;
    chrome.runtime.sendMessage({
      type: 'status',
      text: `🛑 Error fetching image: ${img.url} — ${error.message}. Archiving paused.`
    });
    throw error;
    */
  }
}

// Fallback-aware downloader for grouped media sources (e.g., multiple video formats)
async function fetchMediaGroupWithFallback(sources, folder) {
  for (const src of sources) {
    try {
      await fetchAndDownloadImage(src, folder);
      // If fetch succeeded, no need to try others
      return;
    } catch (err) {
      // Log error but continue trying others
      log(`⚠️ Attempt failed for ${src.url}: ${err.message}`);
    }
  }
  // If none succeeded, pause and throw
  log(`🛑 All media sources failed for ${sources[0].filename}. Pausing scrape.`);
  /*
  isPaused = true;
  chrome.runtime.sendMessage({
    type: 'status',
    text: `🛑 All media sources failed for ${sources[0].filename}. Archiving paused.`
  });
  throw new Error(`All media sources failed for ${sources[0].filename}`);
  */
}

async function fetchImagesWithPoolWithFallback(images, folder, concurrency = 4) {
  // Group images by base filename without extension to group multiple formats
  const groups = {};

  function getBaseName(filename) {
    return filename.toLowerCase().replace(/\.(mp4|webm|jpg|jpeg|png|gif)$/i, '');
  }

  images.forEach(img => {
    const base = getBaseName(img.filename);
    if (!groups[base]) groups[base] = [];
    groups[base].push(img);
  });

  const groupKeys = Object.keys(groups);
  let index = 0;

  async function worker() {
    while (index < groupKeys.length && !isPaused) {
      const currentGroupKey = groupKeys[index++];
      if (downloadedMedia.has(currentGroupKey)) {
        log(`Skipping duplicate media: ${currentGroupKey}`);
        continue;
      }
      await fetchMediaGroupWithFallback(groups[currentGroupKey], folder);
      downloadedMedia.add(currentGroupKey);
      await delayRandom(image_delay_min, image_delay_range);
    }
  }
  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
}

//--------------------------------------
// MESSAGE HANDLER
//--------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'page-data' && pageDataResolver) {
    log(`[onMessage] Resolving pageDataResolver with page-data (${msg ? 'OK' : 'null'})`);
    if (msg.lastPageNumber && !isNaN(msg.lastPageNumber)) {
      totalPages = msg.lastPageNumber;
    }
    pageDataResolver(msg);
    pageDataResolver = null;
  }
  if (msg.command === 'start-scrape') {
    if (!isNaN(msg?.startPage))
      startPage = msg.startPage;
    if (!isNaN(msg?.maxPages))
      maxPages = msg.maxPages;
    if (isPaused) isPaused = false;
    log("[onMessage] Starting scrapeThread.");
    scrapeThread();
  }
  if (msg.command === 'start-twitter-search') {
    // msg.query (string), msg.max (optional)
    const query = msg.query || 'Bitcoin';
    const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(query)}&f=live`;
    log(`[onMessage] Starting Twitter search scrape for query: ${query}`);
    (async () => {
      try {
        const pageData = await scrapeInTab(searchUrl, 'article', 'twitter-search-scraper.js');
        const tweetUrls = pageData?.tweets || [];
        log(`Found ${tweetUrls.length} tweet URLs for "${query}"`);
        // Optionally fetch each tweet via existing getTweetData()
        for (const turl of tweetUrls) {
          await waitWhilePaused();
          const data = await getTweetData(turl);
          log(`Fetched tweet ${turl} → author=${data.authorName || data.author || ''}`);
          // You can then save data / images similar to how forum tweets are handled.
        }
        chrome.runtime.sendMessage({ type: 'status', text: `✅ Completed scraping ${tweetUrls.length} tweets for "${query}"` });
      } catch (err) {
        log(`Twitter search scrape error: ${err.message}`);
        chrome.runtime.sendMessage({ type: 'status', text: `❌ Twitter search error: ${err.message}` });
      }
    })();
  }
  if (msg.type === 'scraping-error') {
    isPaused = true;
    log(`🛑 Error reported from content script: ${msg.message} — paused.`);
    chrome.runtime.sendMessage({ type: 'status', text: '🛑 Error: ' + msg.message + ' (paused)' });
  }
  if (msg.command === 'getStatusAndResume') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabArr) => {
      const tab = tabArr[0];
      const threadId = tab?.url.includes('threadid=')
        ? (tab.url.match(/threadid=(\d+)/) || [])[1]
        : null;

      if (!threadId) {
        sendResponse({ isRunning, isPaused, resumePage: null });
        return;
      }
      const key = `${scrapeStateKey}_${threadId}`;
      storageLocal('get', key).then(val => {
        const resumePage = val[key] ?? null;
        sendResponse({ isRunning, resumePage });
      });
    });
    return true; // async sendResponse
  }

  if (msg.command === 'pause') isPaused = true;

  if (msg.command === 'resume') {
      isPaused = false;
      log("[onMessage] Resume requested.");

      // If not currently running, start scrapeThread() in resume mode
      if (!isRunning) {
          log("[onMessage] Starting scrapeThread() in resume mode.");
          scrapeThread();
      }
  }
  return false;  // close the channel; no async sendResponse()
});

//--------------------------------------
// MAIN SCRAPE FUNCTION
//--------------------------------------
async function scrapeThread() {
  if (isRunning) {
    log("Scrape already in progress.");
    return;
  }
  isRunning = true;
  log("Scraper thread started.");

  const [tab] = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
  log(`Found active tab: id=${tab?.id}, url=${tab?.url}`);
  if (!tab || !tab.url.includes('showthread.php?threadid=')) {
    log('❌ Not on a Something Awful thread page.');
    isRunning = false;
    return;
  }
  currentTabId = tab.id;

  const threadIdMatch = tab.url.match(/threadid=(\d+)/);
  const threadId = threadIdMatch ? threadIdMatch[1] : 'unknown';
  log(`Thread ID: ${threadId}`);
  const threadDir = `SA_Thread_${threadId}`;
  const baseUrl = tab.url.split('&pagenumber=')[0] + '&pagenumber=';

  const key = `${scrapeStateKey}_${threadId}`;
  const resumeStateRaw = await storageLocal('get', key);
  const resumePage = (resumeStateRaw || {})[key] || 0;
  log(`Loaded resume page: ${JSON.stringify(resumePage)}`);

  let pageNum = startPage;
  if (resumePage > 0 && resumePage < totalPages) {
    pageNum = resumePage;
    finalPage = Math.min( pageNum + maxPages - 1, totalPages);
    log(`🔄 Resuming thread ${threadId} from page ${pageNum}, will scrape ${maxPages} more pages, stopping at ${finalPage}`);
  } else {
    finalPage = pageNum + maxPages - 1;
    log(`Starting fresh scrape, will scrape ${maxPages} pages total.`);
  }

  chrome.runtime.sendMessage({
    type: 'progressUpdate',
    page: pageNum,
    max: finalPage
  });

  for (; pageNum <= finalPage; pageNum++) {
    log(`[scrapeThread] Starting page ${pageNum}`);
    await waitWhilePaused();

    const pageUrl = baseUrl + pageNum;
    log(`➡️ Navigating to page ${pageNum}: ${pageUrl}`);

    const pageData = await scrapeInTab(pageUrl, 'table.post',  'scraper.js');
    log(`[scrapeThread] pageData posts count: ${pageData?.posts?.length ?? 'no posts property'}`);

    if (!pageData || !pageData.posts || !pageData.posts.length) {
      log(`🛑 ERROR: No posts found on page ${pageNum}. Archiving paused.`);
      isPaused = true;
      chrome.runtime.sendMessage({ type: 'status', text: '🛑 Error: No posts found – paused.' });
      break;
    }
    if (isPaused) {
      log("⏸ Scraping paused, restarting this loop iteration.");
      pageNum--;
      continue;
    }
    // Create a mapping to find page numbers containing a post by ID.
    for (const post of pageData.posts) {
      postIdToPage[post.postId] = pageNum;
    }

    const firstPostTimestampISO = pageData.posts.length > 0
      ? new Date(pageData.posts[0].timestamp).toISOString()
      : null;
    const dateMetaTag = firstPostTimestampISO
      ? `<meta name="first-post-date" content="${firstPostTimestampISO}">`
      : '';

    // Save HTML for the page
    const htmlParts = pageData.posts.map(p => p.html).join('\n');
    // Wrap in a DOMParser so we can safely find quote links:
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlParts, 'text/html');

    doc.querySelectorAll('a.quote_link').forEach(a => {
      const m = a.getAttribute('href').match(/postid=(\d+)/);
      if (m) {
        const pid = m[1];
        const pageForPost = postIdToPage[pid];
        if (pageForPost) {
          a.href = `page${String(pageForPost).padStart(4, '0')}.html#post${pid}`;
        } else {
          // Use the original HTML href, not the resolved a.href
          const origHref = a.getAttribute('href'); // e.g., "/showthread.php?goto=post&postid=503753878#post503753878"
          a.href = "https://forums.somethingawful.com" + origHref;
        }
      }
    });

    log(`Beginning Tweet replacement.`);

    let allImages = [];

    // Tweet replacement
    for (const target of [
      ...doc.querySelectorAll('a[data-archive-later="tweet"]')
    ]) {
      let tweetUrl = null;
      let replaceNode = target;

      if (target.matches('a[data-archive-later="tweet"]')) {
        tweetUrl = target.href;
        log(`Replacing Tweet OP URL: ${tweetUrl}`);
      } else {
        const link = target.querySelector('a[href*="twitter.com/"][href*="/status/"]');
        if (!link) continue;
        tweetUrl = link.href;
        log(`Replacing Tweet Reply URL: ${tweetUrl}`);
        replaceNode = target.parentElement; // Replace whole preview container
      }
      if (!tweetUrl || !/twitter\.com\/[^/]+\/status\/\d+/.test(tweetUrl)) {
          log(`Skipping non-status Twitter URL: ${tweetUrl}`);
          continue;
      }

      const tweetData = await getTweetData(tweetUrl);

      if( tweetData.error ) {
        log(`Tweet parsing error: ${tweetData.error}`);
        isPaused = true;
        isRunning = false;
        return;
      }

      if( ! tweetData.wasCached ) {
        let newImages = [];

        if( Array.isArray( tweetData.authorMedia ))
          newImages.push( ...tweetData.authorMedia );
        if( Array.isArray( tweetData.quotedMedia ))
          newImages.push( ...tweetData.quotedMedia );
        if( Array.isArray( tweetData.authorCards ))
          newImages.push( ...tweetData.authorCards.map( c => { return { filename: c.filename, url: c.image };} ) );
        if( Array.isArray( tweetData.quotedCards ))
          newImages.push( ...tweetData.quotedCards.map( c => { return { filename: c.filename, url: c.image };} ) );

        newImages = newImages.filter( i => i.filename && i.url );
        newImages.forEach( i => log( tweetUrl + " has Tweet image: " + i.url ));
        allImages.push(...newImages);
      }

      const tweetBoxHTML = generateLocalTweetBox(tweetData, tweetUrl);

      const wrapper = doc.createElement('div');

      const originalContainer = target.closest('div.tweet') || replaceNode; // Find the SA outer tweet container
      const originalLink = `<a href="${tweetUrl}" target="_blank">${tweetUrl}</a><br>`;

      wrapper.innerHTML = originalLink + tweetBoxHTML;

      originalContainer.replaceWith(...wrapper.childNodes);
    }

    const prevPage = pageNum > 1 ? `page${String(pageNum - 1).padStart(4, '0')}.html` : null;
    const nextPage = pageNum < totalPages ? `page${String(pageNum + 1).padStart(4, '0')}.html` : null;

    const pageNavHTML = `
    <div style="text-align:center; margin:30px 0; font-size:18px;">
      ${prevPage ? `<a href="${prevPage}" style="text-decoration:none; color:#58a6ff;">&lt;</a>` : `<span style="color:#555;">&lt;</span>`}
      <span style="margin:0 12px;">Page ${pageNum}</span>
      ${nextPage ? `<a href="${nextPage}" style="text-decoration:none; color:#58a6ff;">&gt;</a>` : `<span style="color:#555;">&gt;</span>`}
    </div>
    `;

    const htmlPartsFixed = doc.body.innerHTML;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Thread ${threadId} — Page ${pageNum}</title>
  ${dateMetaTag}
  <style>
    body { font-family: sans-serif; max-width: 85%; margin: auto; padding: 40px; line-height: 1.4; }
    .postbox { margin-left: 12px; border-bottom: 1px solid #888 }
    .postbox .body {
      font-family: "Roboto", sans-serif;
      font-weight: 400;
      font-size: 15px;
      line-height: 20px;
      color: rgb(204, 204, 204);
      overflow-wrap: break-word;
      padding: 10px 9px 26px 20px;
      background-color: transparent;
      text-rendering: optimizeLegibility;
    }
    .meta { font-size: 0.9em; color: #666; margin-bottom: 0.5em; padding-left: 20px; padding-right: 8px; box-sizing: border-box;}
    img { max-width: 100%; }
    .postbox .body {
      padding: 12px 20px;
      margin: 0;
    }
    /* --- Dark mode quote box & spoiler styling --- */
    body {
      background-color: #090a0d;
      color: #AAA;
    }
    a { color: rgb(101, 161, 238); }
    .bbc-block {
      border-radius: 10px;
      border: 1px solid #343434;
      background-color: #1b202b;
      margin: 12px 22px; padding: 2px 18px;
      box-shadow: none;
    }
    .bbc-block h4, .bbc-block h5 { color: #999; }
    .bbc-block h5 { border-color: #343434; }
    .bbc-block blockquote {
      color: rgb(165, 183, 207);
      padding: 0px;
      margin: 8px 0px 18px 0px; !important;
    }
    .quoteInner { overflow-y: hidden; text-wrap: wrap; font-size: 13px; }
    .quoteInner h4 { margin-top: 0; font-style: italic; }
    .bbc-spoiler:hover, .bbc-spoiler.reveal, .bbc-spoiler.stay {
      background-color: #1c212a;
      color: #CCC;
    }
    .bbc-spoiler blockquote, blockquote .bbc-spoiler,
    blockquote .bbc-spoiler li, .bbc-spoiler blockquote li {
      background-color: #304867;
      color: rgba(48, 72, 103, 0);
    }
    .postbox.seen1 {
      background-color: #151a2b !important;
    }
    .postbox.seen2 {
      background-color: #0d111e !important;
}

    /* --- Minimal timg thumbnail support --- */
    .timg_container {
      position: relative;
      display: inline-block;
      cursor: pointer;
      overflow: hidden;
      max-width: 300px; /* Thumbnail size; adjust as desired */
      max-height: 300px;
      transition: max-width .2s, max-height .2s;
      background: #eee;
    }
    .timg_container.expanded {
      max-width: none;
      max-height: none;
      background: transparent;
      z-index: 10;
    }
    .timg_container img.timg {
      display: block;
      width: 100%;
      height: auto;
      transition: box-shadow .2s;
      box-shadow: 0 1px 5px rgba(0,0,0,0.1);
    }
    .timg_container.expanded img.timg {
      box-shadow: 0 2px 12px rgba(50,50,90,.2);
    }

    .timg_container .note {
      position: absolute;
      top: 4px; left: 4px;
      font-size: 11px;
      background: rgba(28,56,120,.75);
      color: #fff;
      padding: 3px 14px 3px 24px;
      border-radius: 8px;
      opacity: 0.9;
      z-index: 20;
      user-select: none;
      display: none;
      cursor: pointer;
      /* icon using an SVG background as replacement for SA's PNG */
      background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><polygon points="4,2 12,8 4,14" style="fill:white;"/></svg>');
      background-repeat: no-repeat;
      background-position: 4px center;
    }
    .timg_container.expanded .note {
      /* reverse arrow icon for expanded */
      background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><polygon points="12,2 4,8 12,14" style="fill:white;"/></svg>');
    }
    .timg_container:hover .note,
    .timg_container:focus .note {
      display: block;
    }
    /* Local tweet embed */
    .local-tweet {
      font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 12px 16px;
      margin: 12px 0;
      background-color: #0d1117;
      color: #c9d1d9;
      max-width: 590px; /* 40px wider */
      min-width: 300px;
    }
    .local-tweet .tweet-header {
      display: flex;
      flex-direction: column;
      margin-bottom: 6px;
      font-size: 14px;
      color: #8b949e;
      gap: 2px;
    }
    .local-tweet .tweet-author {
      font-weight: 700;
      color: #58a6ff;
      text-decoration: none;
    }
    .local-tweet .tweet-author:hover {
      text-decoration: underline;
    }
    .local-tweet .tweet-handle {
      color: #8b949e;
      font-weight: 400;
      font-size: 13px;
    }
    .local-tweet .tweet-main {
      font-size: 15px;
      line-height: 1.4;
      white-space: pre-wrap;
      margin-bottom: 12px;
      color: #c9d1d9;
    }
    .local-tweet .tweet-quote {
      margin: 12px 0;
      padding-left: 12px;
      background-color: #161b22;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 400;
      color: #c9d1d9;
    }
    .local-tweet .tweet-quote-author {
      font-weight: 700;
      color: #58a6ff;
      text-decoration: none;
      margin-bottom: 2px;
      display: inline-block;
    }
    .local-tweet .tweet-quote-author:hover {
      text-decoration: underline;
    }
    .local-tweet .tweet-time {
      font-size: 16px;
      margin-top: 8px;
      color: #8b949e;
    }
    .local-tweet .tweet-time a {
      color: inherit;
      text-decoration: none;
    }
    .local-tweet .tweet-time a:hover {
      text-decoration: underline;
    }
    .local-tweet .tweet-replies {
      border-top: 1px solid #30363d;
      margin-top: 12px;
      padding-top: 12px;
    }
    .local-tweet .tweet-reply {
      padding: 6px 0;
      font-size: 14px;
      color: #c9d1d9;
      border-bottom: 1px solid #21262d;
    }
    .local-tweet .tweet-reply:last-child {
      border-bottom: none;
    }
    .tweet-media-container {
      margin: 8px 0;
      max-width: 520px; /* Matches quoted tweet width */
    }
    .tweet-media {
      width: 100%;
      height: auto;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: block;
    }
  </style>
</head>
<body>
${pageNavHTML}
${htmlPartsFixed}
${pageNavHTML}
<script>
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.timg_container .note').forEach(function(note) {
    note.addEventListener('click', function(e) {
      e.preventDefault();
      var container = note.closest('.timg_container');
      if (!container) return;
      if (container.classList.contains('expanded')) {
        // Collapse
        container.classList.remove('expanded');
        note.classList.remove('expanded');
      } else {
        // Expand
        container.classList.add('expanded');
        note.classList.add('expanded');
        // Auto-scroll into view if needed
        var img = container.querySelector('img.timg');
        if (img) {
          var rect = img.getBoundingClientRect();
          if (rect.bottom > window.innerHeight || rect.top < 0) {
            img.scrollIntoView({behavior: 'smooth', block: 'center'});
          }
        }
      }
    });
  });
});
</script>
</body>
</html>`.trim();

    log(`[scrapeThread] Saving HTML for page ${pageNum}`);
    await downloadBlob(new Blob([htmlContent], { type: 'text/html' }), threadDir, `page${String(pageNum).padStart(4, '0')}.html`);
    log(`💾 Saved HTML page${String(pageNum).padStart(4, '0')}.html`);

    // *** CORS-SAFE IMAGE DOWNLOAD IN BACKGROUND ***
    allImages.push( ...pageData.posts.flatMap(p => p.images || []) );
    log(`[scrapeThread] Starting image downloads for ${allImages.length} images.`);
    await fetchImagesWithPoolWithFallback(allImages, threadDir, 4);
    log(`[scrapeThread] Image downloads complete for page ${pageNum}`);

    log(`✅ Archived page ${pageNum}`);
    await storageLocal('set', { [`${scrapeStateKey}_${threadId}`]: pageNum+1 });

    if (pageNum < finalPage) {
      chrome.runtime.sendMessage({ type: 'progressUpdate', page: pageNum+1, max: finalPage });
      log(`[scrapeThread] Waiting before next page...`);
      await delayRandom(page_delay_min, page_delay_range);
    }
  }

  log('🎉 Finished scraping thread.');
  currentTabId = null;
  pageDataResolver = null;
  await storageLocal('remove', [`${scrapeStateKey}_${threadId}`]);
  isRunning = false;
  exportLogs(threadID);
}

