const sleep = ms => new Promise(r => setTimeout(r, ms));

function safeFilename(url) {
  // Extract last path segment and remove query/hash parts
  let name = url.split("/").pop().split(/[?#]/)[0] || "";

  // Sanitize: replace any character not alphanumeric, dash, underscore, or dot with underscore
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Prevent multiple consecutive underscores
  name = name.replace(/_+/g, '_');

  // Truncate length to 150 characters max
  if (name.length > 150) {
    const extMatch = name.match(/(\.[a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1] : '';
    const base = name.substring(0, 150 - ext.length);
    name = base + ext;
  }

  // If empty or too short after sanitizing, generate random name (keep extension if original exists)
  if (!name || name.length < 3) {
    const randomStr = Math.random().toString(36).slice(2, 10);
    const extMatch = url.match(/\.[a-z0-9]+$/i);
    const ext = extMatch ? extMatch[0] : '.bin';
    name = 'file_' + randomStr + ext;
  }

  return name.toLowerCase();
}

function filterImageSrc(src) {
  // Ignore UI/decorative images, keep only meaningful post images
  const blocked = [
    "avatars/", "safs/titles", "gangtags", "newbie.gif", "title-banned.gif"
  ];
  return !blocked.some(substr => src.includes(substr));
}

function extractPosts() {
  const posts = [];
  const postEls = document.querySelectorAll('table.post');

  postEls.forEach(postEl => {
    try {
      const postId = (postEl.id || "").replace("post", "") || "unknown";
      const author = postEl.querySelector('dl.userinfo dt.author')?.innerText.trim() || "Unknown";
      let timestamp = postEl.querySelector('td.postdate')?.innerText.trim() || "Unknown";
      timestamp = timestamp.replace(/^[#?\s]+/, '').trim();

      const bodyEl = postEl.querySelector('td.postbody');
      if (!bodyEl) return;

      // Clone postbody to safely manipulate DOM without altering live page
      const clone = bodyEl.cloneNode(true);

      // Gather image URLs, replace src in HTML with relative image filename
      const images = [];
      clone.querySelectorAll('img').forEach(img => {
        const src = img.src;
        if (filterImageSrc(src)) {
          const filename = safeFilename(src);
          img.src = `images/${filename}`;
          images.push({ url: src, filename });
        } else {
          img.remove();
        }
      });

      const videos = [];
      clone.querySelectorAll('video').forEach(videoEl => {
        videoEl.querySelectorAll('source').forEach(sourceEl => {
          const src = sourceEl.src;
          if (!src) return;
          const filename = safeFilename(src);
          sourceEl.src = `images/${filename}`;
          videos.push({ url: src, filename });
        });
        // Also replace the video thumbnail (poster attribute image) with local filename.
        const poster = videoEl.getAttribute('poster');
        if (poster) {
          const posterFilename = safeFilename(poster);
          videoEl.setAttribute('poster', `images/${posterFilename}`);
          // Add poster image to videos or images array for download
          videos.push({ url: poster, filename: posterFilename });
        }
      });

      // Merge video sources into image list for unified download
      images.push(...videos);

      // Optionally tag links for further archiving later (tweets, externals)
      clone.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';

        if (!/^https?:/i.test(href)) {
          // Keep in-thread quote links (will be rewritten later)
          if (/showthread\.php/i.test(href) && /postid=\d+/i.test(href)) {
            // leave intact
          }
          // Remove any other relative links except in-page anchors
          else if (!href.startsWith('#')) {
            const txt = document.createTextNode(a.textContent);
            a.replaceWith(txt);
            return;
          }
        }

        if (href.includes("twitter.com")) {
          a.setAttribute('data-archive-later', 'tweet');
        } else if (!href.startsWith('#')) {
          a.setAttribute('data-archive-later', 'external');
        }
      });

      const rowClass = bodyEl.parentElement?.className || '';
      const html = `<div class="postbox ${rowClass}" id="post${postId}">
        <div class="meta"><strong>${author}</strong> — ${timestamp} [#${postId}]</div>
        <div class="body">${clone.innerHTML}</div>
      </div>`;

      posts.push({ postId, html, images, timestamp });
    } catch(e) {
      chrome.runtime.sendMessage({
        type: "scraping-error",
        message: "Failed to extract a post: " + e.message
      });
      throw e;
    }
  });

  return posts;
}

function getLastPageNumber() {
  // Try to find the 'Last page' link
  const lastPageLink = document.querySelector('a[title="Last page"]');
  if (lastPageLink) {
    const text = lastPageLink.textContent.trim();
    // Remove the » symbol and parse the number
    const num = parseInt(text.replace('»', '').trim(), 10);
    if (!isNaN(num)) {
      return num;
    }
  }
  return null;
}

// Wait for posts to appear (up to ~5s), polling every 250ms
async function waitForPosts() {
  let tries = 20;
  while (tries > 0) {
    if (document.querySelectorAll('table.post').length) {
      console.log(`[scraper.js] Found ${document.querySelectorAll('table.post').length} posts.`);
      return true;
    }
    await sleep(250);
    tries--;
  }
  return false;
}

async function main() {
  const url = location.href;
  const threadId = (url.match(/threadid=(\d+)/) || [])[1] || 'unknown';
  const pageNumber = (url.match(/pagenumber=(\d+)/) || [])[1] || '1';

  await waitForPosts();

  const posts = extractPosts();
  const lastPageNumber = getLastPageNumber();

  console.log("[scraper.js] Sending page-data message with posts count:", posts.length);

  // *** SEND ONLY METADATA TO BACKGROUND (CORS-safe fetching done there) ***
  chrome.runtime.sendMessage({
    type: 'page-data',
    threadId,
    pageNumber,
    lastPageNumber,
    posts
  });
}

main().catch(e => {
  chrome.runtime.sendMessage({
    type: 'scraping-error',
    message: 'Uncaught error in scraper: ' + e.message,
  });
});

