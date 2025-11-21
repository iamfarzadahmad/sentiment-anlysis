#!/usr/bin/env node

/**
 * Test script to verify login detection improvements
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

const COOKIES_FILE = './twitter_cookies.json';

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
    console.log('ℹ️  No saved cookies found');
    return false;
  }
}

/**
 * Test login detection
 */
async function testLoginDetection() {
  console.log('🧪 Testing Twitter login detection...\n');

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Try to load saved cookies
    const hadSavedCookies = await loadCookies(page);

    // Navigate to Twitter
    console.log('📱 Opening Twitter...');
    await page.goto('https://twitter.com', { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });

    await page.waitForTimeout(3000);

    // Check login status
    const loginStatus = await page.evaluate(() => {
      // Check for logged-in indicators
      const hasNavMenu = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      const hasUserMenu = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
      const hasHomeTimeline = document.querySelector('[data-testid="primaryColumn"]');
      const hasComposeButton = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
      const hasUserAvatar = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img');
      
      // Check for login prompts
      const hasSignIn = document.body.innerText.includes('Sign in');
      const hasLogIn = document.body.innerText.includes('Log in');
      const hasSignUp = document.body.innerText.includes('Sign up');
      const hasLoginLink = document.querySelector('a[href="/login"]');
      const hasLoginFlowLink = document.querySelector('a[href="/i/flow/login"]');

      return {
        loggedInIndicators: {
          hasNavMenu: !!hasNavMenu,
          hasUserMenu: !!hasUserMenu,
          hasHomeTimeline: !!hasHomeTimeline,
          hasComposeButton: !!hasComposeButton,
          hasUserAvatar: !!hasUserAvatar
        },
        loginPrompts: {
          hasSignIn,
          hasLogIn,
          hasSignUp,
          hasLoginLink: !!hasLoginLink,
          hasLoginFlowLink: !!hasLoginFlowLink
        },
        isLoggedIn: !!(hasNavMenu || hasUserMenu || hasHomeTimeline || hasComposeButton || hasUserAvatar),
        needsLogin: hasSignIn || hasLogIn || hasSignUp || !!hasLoginLink || !!hasLoginFlowLink
      };
    });

    console.log('📊 Login Detection Results:');
    console.log('─'.repeat(40));
    console.log('Had saved cookies:', hadSavedCookies);
    console.log('Is logged in:', loginStatus.isLoggedIn);
    console.log('Needs login:', loginStatus.needsLogin);
    console.log('\nLogged-in indicators found:');
    Object.entries(loginStatus.loggedInIndicators).forEach(([key, value]) => {
      console.log(`  ${key}: ${value ? '✅' : '❌'}`);
    });
    console.log('\nLogin prompts found:');
    Object.entries(loginStatus.loginPrompts).forEach(([key, value]) => {
      console.log(`  ${key}: ${value ? '⚠️' : '✅'}`);
    });

    // Decision logic
    console.log('\n🎯 Decision:');
    if (loginStatus.isLoggedIn) {
      console.log('✅ User is already logged in - can proceed with scraping');
    } else if (loginStatus.needsLogin) {
      console.log('🔐 Login is required - would initiate login process');
    } else {
      console.log('❓ Login status unclear - would proceed with caution');
    }

    console.log('\n⏳ Keeping browser open for 10 seconds for manual inspection...');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
testLoginDetection()
  .then(() => {
    console.log('\n✅ Test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });