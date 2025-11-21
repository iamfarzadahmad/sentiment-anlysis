function waitForSelector(container, selector, { timeout = 10000, interval = 200, all = false } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      let found = all
        ? container.querySelectorAll(selector)
        : container.querySelector(selector);

      if (all ? found.length > 0 : found) {
        resolve(found);
      } else if (Date.now() - start > timeout) {
        reject(new Error(`Timeout waiting for ${selector}`));
      } else {
        setTimeout(check, interval);
      }
    }
    check();
  });
}

function parseAuthorInfo(innerText) {
  const parts = innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const [name, handle] = parts;
  const profileUrl = handle ? `https://twitter.com/${handle.replace(/^@/, '')}` : null;
  return { name, handle, profileUrl };
}

function findTweetContainer(innerDiv) {
    let container = innerDiv?.parentElement;
    while (container && !container.querySelector('time')) {
      container = container.parentElement;
    }
  return container;
}

let imageCounter = 0;
function extract_media( container, tweetId ) {
  if (!container)
    return [];
  const mediaUrls = Array.from(container.querySelectorAll('div[data-testid="tweetPhoto"] img')).map(img =>
      ( { url: img.src, filename: `${tweetId}_img${imageCounter++}.jpg` } )
    );

  // Similarly for video URLs (use <video> sources or poster attribute)
  const videoEls = container.querySelectorAll('video');
  videoEls.forEach(video => {
    const source = video.querySelector('source');
    if (source?.src && !source.src.startsWith('blob:')) {
      mediaUrls.push({ url: source.src, filename: `${tweetId}_img${imageCounter++}.jpg` });
    } else if (video.poster) {
      mediaUrls.push({ url: video.poster, filename: `${tweetId}_img${imageCounter++}.jpg` });
    }
  });
  return mediaUrls;
}

function extract_card_previews(container, tweetId, { timeout = 6000, interval = 400 } = {}) {
  // First quick check for spinner or card wrapper
  const spinner = container.querySelector('div[role="progressbar"]');
  const initialCard = container.querySelector('div[data-testid="card.wrapper"]');

  if (!spinner && !initialCard) {
    // No sign of card loading or card present, skip polling
    return [];
  }
  return new Promise((resolve) => {
    const start = Date.now();

    function check() {
      const cardEls = container.querySelectorAll('div[data-testid="card.wrapper"]');

      if (cardEls.length > 0 || Date.now() - start > timeout) {
        const cards = Array.from(cardEls).map((card, i) => {
          const cardLink = card.querySelector('a[role="link"]')?.href || '';
          const cardTitle = card.querySelector('span, .css-1jxf684')?.textContent || '';
          const publisher = card.querySelector('[style*="color: rgb(113, 118, 123)"]')?.textContent || '';

          // Image from <img> or background-image style div
          let imgEl = card.querySelector('img');
          let imgUrl = imgEl ? imgEl.src : null;
          if (!imgUrl) {
            const bgDiv = card.querySelector('div[style*="background-image"]');
            if (bgDiv) {
              const match = bgDiv.style.backgroundImage.match(/url\("(.*?)"\)/);
              if (match) imgUrl = match[1];
            }
          }

          return {
            url: cardLink,
            image: imgUrl,
            title: cardTitle,
            publisher,
            filename: imgUrl ? `${tweetId}_card${i}.jpg` : null,
          };
        });
        resolve(cards);
      } else {
        setTimeout(check, interval);
      }
    }
    check();
  });
}

(async () => {
  try {
    // First check if we need to login
    const needsLogin = document.body.innerText.includes('Sign in') || 
                      document.body.innerText.includes('Log in') ||
                      document.body.innerText.includes('Sign up') ||
                      document.querySelector('a[href="/login"]') ||
                      document.querySelector('a[href="/i/flow/login"]');
    
    if (needsLogin) {
      chrome.runtime.sendMessage({ 
        type: 'page-data', 
        error: 'Login required - please log in to Twitter first' 
      });
      return;
    }

    let mainHTML = '', quoteHTML = '', authorMedia, quotedMedia;
    let preEmbeddedLinks_Quote = [];
    const usernames = await waitForSelector(document, 'div[data-testid="User-Name"]', {all: true});
    const mainTweet = findTweetContainer(usernames[0]);
    const quotedTweet = findTweetContainer(usernames[1]);

    const tweetTextEls = document.querySelectorAll('div[data-testid="tweetText"]');
    mainHTML = tweetTextEls[0]?.innerHTML;
    const preEmbeddedLinks_Main = tweetTextEls[0]?.querySelectorAll('a[data-pre-embedded="true"]');
    quoteHTML = tweetTextEls[1]?.innerHTML;
    preEmbeddedLinks_Quote = tweetTextEls[1]?.querySelectorAll('a[data-pre-embedded="true"]');

    const timeEls = Array.from( await waitForSelector(mainTweet, 'time', {all: true}) );
    const timeEl = timeEls.find( e => e.parentElement?.tagName.toLowerCase() === 'a' );  // Main tweet's time, not quote tweet's
    const tweetTime = timeEl.getAttribute('datetime') || timeEl.textContent.trim() || '';
    const href = timeEl.parentElement.getAttribute('href');
    const tweetUrl = href.startsWith('/') ? `https://twitter.com${href}` : href;
    const tweetId = tweetUrl.match(/status\/(\d+)/)?.[1] || 'unknown';

    const authorInfo = parseAuthorInfo(usernames[0].innerText);
    let quotedData = null;
    if (usernames.length > 1) {
      quotedData = parseAuthorInfo(usernames[1].innerText);
    }
    const quotedName = quotedData?.name || '';
    const quotedHandle = quotedData?.handle || '';
    const quotedUrl = quotedData?.profileUrl || '';

    if( quotedTweet ) {
      const mediaPlaceholder = quotedTweet.querySelector('a[href*="/photo/"], a[href*="/video/"]');
      if( mediaPlaceholder || preEmbeddedLinks_Quote?.length ) {
        const img = await waitForSelector( quotedTweet, 'img', {timeout: 4000});
        if (img?.src)
          quotedMedia = extract_media ( quotedTweet, tweetId );
      }
      quotedTweet.remove();
    }
    const mediaPlaceholder = mainTweet.querySelector('a[href*="/photo/"], a[href*="/video/"]');
    if( mediaPlaceholder || preEmbeddedLinks_Main?.length ) {
      const img = await waitForSelector( mainTweet, 'img', {timeout: 10000});
      if (img?.src)
        authorMedia = extract_media ( mainTweet, tweetId );
    }

    // Article/link preview cards:
    const authorCards = await extract_card_previews(mainTweet, tweetId);
    const quotedCards = quotedTweet ? await extract_card_previews(quotedTweet, tweetId+'_q') : [];

    chrome.runtime.sendMessage({
      type: 'page-data',
      authorName: authorInfo.name, authorHandle: authorInfo.handle, authorUrl: authorInfo.profileUrl, authorMedia, authorCards, quotedName, quotedHandle, quotedUrl, quotedMedia, quotedCards, tweetTime, mainHTML, quoteHTML, repliesHTML: [], tweetUrl
    });
  } catch (error) {
    chrome.runtime.sendMessage({ type: 'page-data', error: error.message });
  }
})();

