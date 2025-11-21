# Twitter Search Scraper - Setup & Usage

## What Was Added

This project now includes Twitter search scraping functionality! The following files were created/modified:

### New Files:
- **twitter-search-scraper.js** - Scrapes tweet URLs from Twitter search results pages

### Modified Files:
- **background.js** - Added `start-twitter-search` command handler
- **manifest.json** - Added twitter-search-scraper.js to web_accessible_resources
- **popup.html** - Added Twitter search UI section
- **popup.js** - Added Twitter search button handler

## How to Load the Extension

Since this is a dev container without a GUI browser, you'll need to:

1. **Open the extension in your host browser** (Chrome/Chromium/Edge):
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Navigate to this workspace folder: `/workspaces/SA_forum_scraper`
   - Select the folder and click "Select Folder"

2. **Alternative - Package the extension**:
   ```bash
   cd /workspaces/SA_forum_scraper
   zip -r twitter-scraper-extension.zip . -x "*.git*" -x "*.md" -x "*.zip"
   ```
   Then download the zip file and load it in your browser.

## How to Use

1. **Load the extension** in Chrome/Edge as described above

2. **Navigate to Twitter** (https://twitter.com or https://x.com)

3. **Click the extension icon** in your browser toolbar

4. **In the popup window**:
   - You'll see a "Twitter Search" section
   - Enter your search term (default is "Bitcoin")
   - Click "Scrape Twitter Search"

5. **What happens**:
   - The extension will navigate to Twitter search with your query
   - It will scroll 4 times to load more tweets
   - It will collect all unique tweet URLs
   - It will fetch each tweet's data using the existing `getTweetData()` function
   - Progress will be logged in the extension console

## View Logs

To see what's happening:
1. Go to `chrome://extensions/`
2. Find "SomethingAwful Thread Scraper"
3. Click "background page" or "service worker"
4. This opens the console where you can see logs

## Customize Search Behavior

Edit `twitter-search-scraper.js` to change:
- **scrollTimes** (line 19): Number of times to scroll (currently 4)
- Scroll delay timing (line 21): Currently 1200ms between scrolls

## Notes & Warnings

⚠️ **Twitter Terms of Service**: Scraping Twitter may violate their terms of service. Use responsibly and at your own risk.

⚠️ **Rate Limiting**: Twitter may rate-limit or block requests if you scrape too aggressively.

⚠️ **Selector Changes**: Twitter frequently updates their UI. If scraping stops working, the CSS selectors in `twitter-search-scraper.js` may need updating.

⚠️ **Login Required**: Some Twitter content requires login. The scraper works with publicly visible tweets.

## Example Queries

- "Bitcoin"
- "from:elonmusk crypto"
- "#AI (min_faves:100)"
- "lang:en climate change"

For advanced search syntax, see: https://developer.twitter.com/en/docs/twitter-api/v1/rules-and-filtering/search-operators

## Next Steps

The current implementation logs tweet data but doesn't save it. You could extend it to:
- Save tweets to files (like the SA forum scraper does)
- Download tweet images/videos
- Store data in a database
- Export to JSON/CSV
