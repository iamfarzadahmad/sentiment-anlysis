# Twitter CLI Scraper

A standalone Node.js command-line tool to scrape Twitter search results and save them to JSON files.

## Features

✅ Search Twitter by keyword  
✅ Auto-scroll to load more tweets  
✅ Extract tweet text, author, metrics (likes, retweets, replies)  
✅ Download tweet metadata and image URLs  
✅ Save results to formatted JSON files  
✅ No browser extension needed - runs from terminal  

## Installation

1. Install dependencies:
```bash
npm install
```

This will install Puppeteer (headless Chrome browser).

## Usage

### Basic Usage

```bash
node twitter-cli-scraper.js "Bitcoin"
```

### With Max Tweets Limit

```bash
node twitter-cli-scraper.js "Bitcoin" 50
```

### Using NPM Scripts

```bash
npm run search "Bitcoin" 50
npm test  # Runs a test search for "Bitcoin" (20 tweets)
```

## Output

Results are saved to `./twitter_data/` directory with the format:

```
twitter_Bitcoin_2025-10-17T12-30-45.json
```

### JSON Structure

```json
{
  "query": "Bitcoin",
  "timestamp": "2025-10-17T12:30:45.123Z",
  "totalTweets": 50,
  "tweets": [
    {
      "id": "1234567890",
      "url": "https://twitter.com/user/status/1234567890",
      "username": "elonmusk",
      "text": "Bitcoin to the moon! 🚀",
      "timestamp": "2025-10-17T10:30:00.000Z",
      "likes": 15420,
      "retweets": 3240,
      "replies": 856,
      "images": ["https://pbs.twimg.com/media/..."],
      "verified": true
    }
  ]
}
```

## Configuration

Edit these constants in `twitter-cli-scraper.js`:

```javascript
const SCROLL_TIMES = 5;      // Number of scrolls (more = more tweets)
const SCROLL_DELAY = 2000;   // Delay between scrolls (ms)
const OUTPUT_DIR = './twitter_data';  // Output directory
```

## Login Requirement

Twitter may require login to view search results. If prompted:

1. The script will pause for 60 seconds
2. Manually log in to Twitter in the browser window that opens
3. The script will continue automatically

## Headless Mode

To run without visible browser (faster):

Edit `twitter-cli-scraper.js`:
```javascript
headless: true  // Change from false to true
```

## Examples

### Search for multiple topics

```bash
node twitter-cli-scraper.js "Bitcoin" 100
node twitter-cli-scraper.js "Ethereum" 100
node twitter-cli-scraper.js "cryptocurrency market" 50
```

### Process results with jq

```bash
# Get all usernames
cat twitter_data/twitter_Bitcoin_*.json | jq '.tweets[].username'

# Get top 5 most liked tweets
cat twitter_data/twitter_Bitcoin_*.json | jq '.tweets | sort_by(.likes) | reverse | .[0:5]'

# Count verified users
cat twitter_data/twitter_Bitcoin_*.json | jq '[.tweets[].verified] | map(select(. == true)) | length'
```

## Limitations

⚠️ **Important Notes:**

- Twitter's rate limiting may block excessive scraping
- Scraping Twitter may violate their Terms of Service
- This tool is for educational/research purposes only
- Use responsibly and consider Twitter's API for production use
- Results depend on what's visible in the browser (login state, location, etc.)

## Troubleshooting

### "Cannot find module 'puppeteer'"
```bash
npm install
```

### "No tweets found"
- Twitter may require login
- Try with `headless: false` to see what's happening
- Check if search query returns results on Twitter.com

### Browser crashes
- Increase memory: `NODE_OPTIONS=--max_old_space_size=4096 node twitter-cli-scraper.js "Bitcoin"`

## License

MIT


node twitter-cli-scraper.js "`$goldcoin" 50