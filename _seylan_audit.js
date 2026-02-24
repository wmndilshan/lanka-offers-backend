const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const cacheDir = './cache_seylan';
const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.html'));
console.log('Cache files:', files.length);

const validities = new Map();

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
  const url = data.url;
  const html = data.html;

  // Skip listing pages (they end with /cards/<slug> without more path segments)
  if (!url || url.match(/\/promotions\/cards\/[a-z-]+$/)) continue;

  const $ = cheerio.load(html);
  const rightCol = $('.offer-detail .col-md-6').last();

  let validity = '';
  rightCol.find('p, h4, div').each((i, el) => {
    const text = $(el).text().trim();
    if (text.match(/valid\s+until|valid\s+from|valid\s+till/i)) {
      validity = text;
      return false;
    }
  });

  const title = rightCol.find('h2.h11').text().trim();

  const key = validity || '[EMPTY]';
  if (!validities.has(key)) validities.set(key, { count: 0, merchants: [] });
  const entry = validities.get(key);
  entry.count++;
  entry.merchants.push(title.substring(0, 45));
}

console.log('\n=== ALL UNIQUE VALIDITY TEXTS ===');
for (const [text, info] of validities) {
  console.log(`\n[${info.count}x] "${text}"`);
  console.log('  Merchants:', info.merchants.join(' | '));
}
console.log('\nTotal unique patterns:', validities.size);
