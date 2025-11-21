#!/bin/bash

# Twitter Scraper Demo Script
# Shows how easy it is to use the CLI scraper

echo "🎯 Twitter CLI Scraper - Quick Demo"
echo "===================================="
echo ""

# Show usage
echo "📖 Usage Examples:"
echo ""
echo "1. Search for Bitcoin (20 tweets):"
echo "   node twitter-cli-scraper.js \"Bitcoin\" 20"
echo ""
echo "2. Search for Ethereum (50 tweets):"
echo "   node twitter-cli-scraper.js \"Ethereum\" 50"
echo ""
echo "3. Search any keyword:"
echo "   node twitter-cli-scraper.js \"YOUR_KEYWORD\" NUMBER_OF_TWEETS"
echo ""
echo "4. With headless display (for servers):"
echo "   xvfb-run -a node twitter-cli-scraper.js \"Bitcoin\" 20"
echo ""

# Show sample data
echo "📊 Sample Output Structure:"
echo ""
echo "File: twitter_data/twitter_Bitcoin_SAMPLE.json"
echo ""
cat twitter_data/twitter_Bitcoin_SAMPLE.json | head -30
echo "   ... (more tweets) ..."
echo ""

# Show what data is extracted
echo "✨ Data Extracted Per Tweet:"
echo "   ✓ Tweet ID and URL"
echo "   ✓ Username and verified status"
echo "   ✓ Tweet text content"
echo "   ✓ Timestamp"
echo "   ✓ Likes, Retweets, Replies counts"
echo "   ✓ Image URLs (if any)"
echo ""

# Next steps
echo "🚀 To run a real search:"
echo ""
echo "   node twitter-cli-scraper.js \"Bitcoin\" 20"
echo ""
echo "⚠️  Note: Twitter requires login. The script will:"
echo "   1. Open a browser window"
echo "   2. Wait 60 seconds for you to log in"
echo "   3. Continue scraping automatically"
echo ""
echo "📁 Results saved to: ./twitter_data/"
echo ""
