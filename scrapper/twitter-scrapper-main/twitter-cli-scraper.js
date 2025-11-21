#!/usr/bin/env node

/**
 * Twitter CLI Scraper
 * Usage: node twitter-cli-scraper.js "Bitcoin" [maxTweets]
 * Example: node twitter-cli-scraper.js "Bitcoin" 50
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const SCROLL_TIMES = 5; // Number of times to scroll down
const SCROLL_DELAY = 2000; // Delay between scrolls (ms)
const OUTPUT_DIR = './twitter_data';
const COOKIES_FILE = './twitter_cookies.json';

/**
 * Save cookies to file for session persistence
 */
async function saveCookies(page) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log('💾 Session cookies saved for future use');
  } catch (error) {
    console.log('⚠️  Warning: Could not save cookies:', error.message);
  }
}

/**
 * Load cookies from file if they exist
 */
async function loadCookies(page) {
  try {
    const cookiesData = await fs.readFile(COOKIES_FILE, 'utf8');
    const cookies = JSON.parse(cookiesData);
    await page.setCookie(...cookies);
    console.log('🍪 Loaded saved session cookies');
    return true;
  } catch (error) {
    console.log('ℹ️  No saved cookies found, will check login status');
    return false;
  }
}

/**
 * Scrape Twitter search results
 */
async function scrapeTwitterSearch(query, maxTweets = 100) {
  console.log(`🔍 Searching Twitter for: "${query}"`);
  console.log(`📊 Target: ${maxTweets} tweets\n`);

  const browser = await puppeteer.launch({
    headless: false, // Set to true for headless mode
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Try to load saved cookies first
    const hadSavedCookies = await loadCookies(page);

    // Navigate to Twitter search
    const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(query)}&f=live`;
    console.log(`📱 Opening: ${searchUrl}`);
    
    await page.goto(searchUrl, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });

    console.log('⏳ Waiting for page to load...');
    await page.waitForTimeout(3000);

    // Check if user is already logged in
    const isLoggedIn = await page.evaluate(() => {
      // Check for common logged-in indicators
      const hasNavMenu = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      const hasUserMenu = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
      const hasHomeTimeline = document.querySelector('[data-testid="primaryColumn"]');
      const hasComposeButton = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
      
      // Also check if we can see user avatar/profile elements
      const hasUserAvatar = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img');
      
      return !!(hasNavMenu || hasUserMenu || hasHomeTimeline || hasComposeButton || hasUserAvatar);
    });

    // Check if login is required (fallback check)
    const needsLogin = !isLoggedIn && await page.evaluate(() => {
      return document.body.innerText.includes('Sign in') || 
             document.body.innerText.includes('Log in') ||
             document.body.innerText.includes('Sign up') ||
             document.querySelector('a[href="/login"]') ||
             document.querySelector('a[href="/i/flow/login"]');
    });

    if (isLoggedIn) {
      console.log('✅ Already logged in to Twitter!');
    } else if (needsLogin) {
      console.log('\n🔐 Login required - logging in automatically...');
      
      // Go to login page
      await page.goto('https://twitter.com/i/flow/login', { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });
      
      await page.waitForTimeout(2000);
      
      // Enter email/username
      console.log('   Entering email...');
      await page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
      await page.type('input[autocomplete="username"]', 'kalalasaman@gmail.com', { delay: 100 });
      
      // Click Next
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      
      // Check if username is required (Twitter sometimes asks for this)
      const usernameRequired = await page.evaluate(() => {
        return document.body.innerText.includes('Enter your phone number or username');
      });
      
      if (usernameRequired) {
        console.log('   Entering username...');
        await page.waitForSelector('input[data-testid="ocfEnterTextTextInput"]', { timeout: 5000 });
        await page.type('input[data-testid="ocfEnterTextTextInput"]', '@KalalaSama13822', { delay: 100 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
      }
      
      // Enter password
      console.log('   Entering password...');
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.type('input[type="password"]', 'Anjana@123', { delay: 100 });
      
      // Click Login
      await page.keyboard.press('Enter');
      console.log('   Logging in...');
      await page.waitForTimeout(5000);
      
      console.log('✅ Login successful!\n');
      
      // Save cookies for future use
      await saveCookies(page);
      
      // Navigate back to search
      await page.goto(searchUrl, { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });
      await page.waitForTimeout(3000);
    } else {
      console.log('ℹ️  No login required - proceeding with search...');
    }

    // Scroll and collect tweets
    const tweets = new Set();
    
    console.log('🔍 Looking for tweets...\n');
    
    // Wait for tweets to load
    try {
      await page.waitForSelector('article', { timeout: 10000 });
      console.log('✓ Found article elements\n');
    } catch (err) {
      console.log('⚠️  No articles found - saving page screenshot for debugging...');
      await page.screenshot({ path: 'twitter_debug.png', fullPage: true });
      console.log('   Screenshot saved as twitter_debug.png');
      
      // Try to get page content for debugging
      const bodyText = await page.evaluate(() => document.body.innerText);
      console.log('\n📄 Page content preview:');
      console.log(bodyText.substring(0, 500) + '...\n');
    }
    
    for (let i = 0; i < SCROLL_TIMES; i++) {
      console.log(`📜 Scrolling... (${i + 1}/${SCROLL_TIMES})`);
      
      // Extract tweet data with multiple selector strategies
      const pageTweets = await page.evaluate(() => {
        const results = [];
        
        // Try multiple selectors for tweets
        let articles = document.querySelectorAll('article[data-testid="tweet"]');
        
        // Fallback: try just 'article' tags
        if (articles.length === 0) {
          articles = document.querySelectorAll('article');
        }
        
        // Fallback: try by role
        if (articles.length === 0) {
          articles = document.querySelectorAll('[role="article"]');
        }
        
        console.log(`Found ${articles.length} article elements`);
        
        articles.forEach((article, index) => {
          try {
            // Get tweet URL - try multiple selectors
            let tweetUrl = null;
            let tweetId = null;
            
            const timeLink = article.querySelector('a[href*="/status/"]');
            if (timeLink) {
              const href = timeLink.getAttribute('href');
              tweetUrl = href.startsWith('http') ? href : `https://twitter.com${href}`;
              tweetId = tweetUrl.match(/status\/(\d+)/)?.[1];
            }
            
            if (!tweetUrl) {
              // Try finding any link with /status/
              const allLinks = article.querySelectorAll('a');
              for (const link of allLinks) {
                const href = link.getAttribute('href') || '';
                if (href.includes('/status/')) {
                  tweetUrl = href.startsWith('http') ? href : `https://twitter.com${href}`;
                  tweetId = tweetUrl.match(/status\/(\d+)/)?.[1];
                  break;
                }
              }
            }
            
            if (!tweetUrl) {
              console.log(`Skipping article ${index} - no status link found`);
              return;
            }
            
            // Get username - try multiple approaches
            let username = 'unknown';
            const userLink = article.querySelector('a[href^="/"][role="link"]');
            if (userLink) {
              const href = userLink.getAttribute('href');
              username = href?.substring(1)?.split('/')[0] || 'unknown';
            }
            
            // Get tweet text - try multiple selectors
            let text = '';
            const tweetTextElement = article.querySelector('div[data-testid="tweetText"]');
            if (tweetTextElement) {
              text = tweetTextElement.innerText;
            } else {
              // Fallback: try to find any text content
              const textDivs = article.querySelectorAll('div[lang]');
              if (textDivs.length > 0) {
                text = textDivs[0].innerText;
              }
            }
            
            // Get timestamp
            const timeElement = article.querySelector('time');
            const timestamp = timeElement?.getAttribute('datetime') || new Date().toISOString();
            
            // Get metrics
            const getMetric = (testId) => {
              const el = article.querySelector(`[data-testid="${testId}"]`);
              const ariaLabel = el?.getAttribute('aria-label') || '';
              const match = ariaLabel.match(/[\d,]+/);
              return match ? match[0].replace(/,/g, '') : '0';
            };
            
            const likes = getMetric('like');
            const retweets = getMetric('retweet');
            const replies = getMetric('reply');
            
            // Get images
            const images = Array.from(article.querySelectorAll('img[src*="twimg.com/media"], img[src*="pbs.twimg.com/media"]'))
              .map(img => img.src)
              .filter(src => !src.includes('profile_images')); // Exclude profile pics
            
            // Get verified badge
            const verified = !!article.querySelector('svg[aria-label*="Verified"]') || 
                           !!article.querySelector('[data-testid="icon-verified"]');
            
            results.push({
              id: tweetId,
              url: tweetUrl.split('?')[0],
              username: username,
              text: text,
              timestamp: timestamp,
              likes: parseInt(likes) || 0,
              retweets: parseInt(retweets) || 0,
              replies: parseInt(replies) || 0,
              images: images,
              verified: verified
            });
          } catch (err) {
            console.error(`Error extracting tweet ${index}:`, err.message);
          }
        });
        
        return results;
      });

      // Add to set (using URL as key to avoid duplicates)
      pageTweets.forEach(tweet => {
        if (tweet.url) {
          tweets.add(JSON.stringify(tweet));
        }
      });

      console.log(`   Found ${tweets.size} unique tweets so far...`);

      if (tweets.size >= maxTweets) {
        console.log(`✅ Reached target of ${maxTweets} tweets!`);
        break;
      }

      // Scroll down
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await page.waitForTimeout(SCROLL_DELAY);
    }

    // Convert Set to Array and parse JSON
    const tweetArray = Array.from(tweets).map(t => JSON.parse(t)).slice(0, maxTweets);

    console.log(`\n✨ Collected ${tweetArray.length} tweets!`);

    // Save to JSON file
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `twitter_${query.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.json`;
    const filepath = path.join(OUTPUT_DIR, filename);

    const output = {
      query: query,
      timestamp: new Date().toISOString(),
      totalTweets: tweetArray.length,
      tweets: tweetArray
    };

    await fs.writeFile(filepath, JSON.stringify(output, null, 2));
    
    console.log(`💾 Saved to: ${filepath}`);
    console.log(`\n📊 Summary:`);
    console.log(`   Total tweets: ${tweetArray.length}`);
    console.log(`   Total likes: ${tweetArray.reduce((sum, t) => sum + t.likes, 0)}`);
    console.log(`   Total retweets: ${tweetArray.reduce((sum, t) => sum + t.retweets, 0)}`);
    console.log(`   With images: ${tweetArray.filter(t => t.images.length > 0).length}`);
    console.log(`   Verified users: ${tweetArray.filter(t => t.verified).length}`);

    return output;

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// CLI Entry Point
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node twitter-cli-scraper.js <search_query> [max_tweets]');
    console.log('Example: node twitter-cli-scraper.js "Bitcoin" 50');
    process.exit(1);
  }

  const query = args[0];
  const maxTweets = parseInt(args[1]) || 100;

  scrapeTwitterSearch(query, maxTweets)
    .then(() => {
      console.log('\n✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Failed:', error);
      process.exit(1);
    });
}

module.exports = { scrapeTwitterSearch };
