#!/usr/bin/env node

/**
 * Create sample Twitter data to demonstrate the JSON format
 */

const fs = require('fs').promises;
const path = require('path');

async function createSampleData() {
  const sampleData = {
    "query": "Bitcoin",
    "timestamp": new Date().toISOString(),
    "totalTweets": 5,
    "tweets": [
      {
        "id": "1847234567890123456",
        "url": "https://twitter.com/elonmusk/status/1847234567890123456",
        "username": "elonmusk",
        "text": "Bitcoin is the future of digital currency 🚀💰 #BTC #cryptocurrency",
        "timestamp": "2025-10-17T10:30:00.000Z",
        "likes": 15420,
        "retweets": 3240,
        "replies": 856,
        "images": [],
        "verified": true
      },
      {
        "id": "1847234567890123457",
        "url": "https://twitter.com/crypto_analyst/status/1847234567890123457",
        "username": "crypto_analyst",
        "text": "Bitcoin just broke $65,000! This is huge! 📈\n\n#Bitcoin #crypto #trading",
        "timestamp": "2025-10-17T11:15:22.000Z",
        "likes": 8934,
        "retweets": 2156,
        "replies": 445,
        "images": ["https://pbs.twimg.com/media/sample_chart.jpg"],
        "verified": false
      },
      {
        "id": "1847234567890123458",
        "url": "https://twitter.com/BitcoinMagazine/status/1847234567890123458",
        "username": "BitcoinMagazine",
        "text": "BREAKING: Major institution announces $1B Bitcoin purchase\n\nRead more: https://t.co/example",
        "timestamp": "2025-10-17T12:45:10.000Z",
        "likes": 22456,
        "retweets": 8934,
        "replies": 1234,
        "images": [],
        "verified": true
      },
      {
        "id": "1847234567890123459",
        "url": "https://twitter.com/trader_joe/status/1847234567890123459",
        "username": "trader_joe",
        "text": "My Bitcoin price prediction for end of year: $75,000\n\nWhat's yours? 🤔",
        "timestamp": "2025-10-17T13:20:45.000Z",
        "likes": 3456,
        "retweets": 789,
        "replies": 567,
        "images": [],
        "verified": false
      },
      {
        "id": "1847234567890123460",
        "url": "https://twitter.com/satoshi_student/status/1847234567890123460",
        "username": "satoshi_student",
        "text": "Just bought my first 0.01 BTC! Small steps towards financial freedom 💪\n\n#Bitcoin #hodl #stackingsats",
        "timestamp": "2025-10-17T14:05:33.000Z",
        "likes": 1234,
        "retweets": 234,
        "replies": 89,
        "images": ["https://pbs.twimg.com/media/sample_wallet.png"],
        "verified": false
      }
    ]
  };

  const outputDir = './twitter_data';
  await fs.mkdir(outputDir, { recursive: true });
  
  const filename = 'twitter_Bitcoin_SAMPLE.json';
  const filepath = path.join(outputDir, filename);
  
  await fs.writeFile(filepath, JSON.stringify(sampleData, null, 2));
  
  console.log('✅ Created sample data file!');
  console.log(`📄 File: ${filepath}`);
  console.log('\n📊 Sample data includes:');
  console.log(`   - ${sampleData.totalTweets} sample tweets`);
  console.log(`   - Various metrics (likes, retweets, replies)`);
  console.log(`   - Tweet URLs, usernames, and timestamps`);
  console.log(`   - Image URLs where available`);
  console.log(`   - Verified status for users`);
  console.log('\n💡 This demonstrates the JSON structure the real scraper will produce');
  console.log('   when Twitter login is available.');
}

createSampleData().catch(console.error);
