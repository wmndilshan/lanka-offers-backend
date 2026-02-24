/**
 * Cache Management Utility for Scrapers
 * Usage: node cache-manager.js [command] [options]
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIRS = [
  './cache_pabc',
  './cache_ndb_bank',
  './cache_peoples_bank'
];

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getCacheStats(cacheDir) {
  if (!fs.existsSync(cacheDir)) {
    return null;
  }

  const files = fs.readdirSync(cacheDir);
  let totalSize = 0;
  let validCount = 0;
  let expiredCount = 0;
  const cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours

  const fileDetails = files.map(file => {
    const filePath = path.join(cacheDir, file);
    const stats = fs.statSync(filePath);
    totalSize += stats.size;

    const age = Date.now() - stats.mtime.getTime();
    const isValid = age < cacheExpiry;
    
    if (isValid) validCount++;
    else expiredCount++;

    let url = 'N/A';
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      url = content.url || content.metadata?.url || 'N/A';
    } catch (e) {
      // Ignore parse errors
    }

    return {
      file,
      size: stats.size,
      modified: stats.mtime,
      age: age,
      isValid,
      url
    };
  });

  return {
    dir: cacheDir,
    totalFiles: files.length,
    validCount,
    expiredCount,
    totalSize,
    files: fileDetails
  };
}

function listCache(detailed = false) {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║           CACHE STATUS REPORT                  ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  let grandTotal = 0;
  let grandTotalFiles = 0;

  CACHE_DIRS.forEach(dir => {
    const stats = getCacheStats(dir);
    
    if (!stats) {
      console.log(`❌ ${dir} - Not found\n`);
      return;
    }

    grandTotal += stats.totalSize;
    grandTotalFiles += stats.totalFiles;

    console.log(`📁 ${stats.dir}`);
    console.log(`   Total Files: ${stats.totalFiles}`);
    console.log(`   Valid: ${stats.validCount} | Expired: ${stats.expiredCount}`);
    console.log(`   Size: ${formatBytes(stats.totalSize)}`);

    if (detailed && stats.files.length > 0) {
      console.log('\n   Files:');
      stats.files.forEach(f => {
        const status = f.isValid ? '✅' : '⏰';
        const ageHours = Math.floor(f.age / (1000 * 60 * 60));
        console.log(`   ${status} ${f.file.substring(0, 12)}... - ${formatBytes(f.size)} - ${ageHours}h ago`);
        if (f.url !== 'N/A') {
          console.log(`      URL: ${f.url.substring(0, 60)}...`);
        }
      });
    }
    console.log('');
  });

  console.log('─'.repeat(52));
  console.log(`Total Cache: ${grandTotalFiles} files, ${formatBytes(grandTotal)}`);
  console.log('─'.repeat(52) + '\n');
}

function clearCache(dirName = null) {
  let cleared = 0;
  let totalSize = 0;
  
  const dirsToClean = dirName ? [dirName] : CACHE_DIRS;

  dirsToClean.forEach(dir => {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
      fs.unlinkSync(filePath);
      cleared++;
    });
    
    console.log(`🗑️  Cleared ${dir}: ${files.length} files`);
  });

  console.log(`\n✅ Total cleared: ${cleared} files (${formatBytes(totalSize)})\n`);
}

function clearExpired() {
  let cleared = 0;
  let totalSize = 0;
  const cacheExpiry = 24 * 60 * 60 * 1000;

  CACHE_DIRS.forEach(dir => {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    let dirCleared = 0;

    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      const age = Date.now() - stats.mtime.getTime();

      if (age >= cacheExpiry) {
        totalSize += stats.size;
        fs.unlinkSync(filePath);
        cleared++;
        dirCleared++;
      }
    });

    if (dirCleared > 0) {
      console.log(`🗑️  ${dir}: Removed ${dirCleared} expired files`);
    }
  });

  if (cleared === 0) {
    console.log('✅ No expired cache files found\n');
  } else {
    console.log(`\n✅ Total expired cleared: ${cleared} files (${formatBytes(totalSize)})\n`);
  }
}

function inspectCache(filename) {
  let found = false;

  CACHE_DIRS.forEach(dir => {
    if (!fs.existsSync(dir)) return;

    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      found = true;
      const stats = fs.statSync(filePath);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      console.log('╔════════════════════════════════════════════════╗');
      console.log('║           CACHE FILE INSPECTOR                 ║');
      console.log('╚════════════════════════════════════════════════╝\n');
      
      console.log(`📄 File: ${filename}`);
      console.log(`📁 Location: ${filePath}`);
      console.log(`📦 Size: ${formatBytes(stats.size)}`);
      console.log(`📅 Created: ${formatDate(stats.mtime)}`);
      console.log(`⏰ Age: ${Math.floor((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60))} hours`);
      
      if (content.url || content.metadata?.url) {
        console.log(`🔗 URL: ${content.url || content.metadata?.url}`);
      }
      
      if (content.cachedAt) {
        console.log(`📅 Cached At: ${content.cachedAt}`);
      }
      
      if (content.expiresAt) {
        console.log(`⏰ Expires At: ${content.expiresAt}`);
      }
      
      if (content.data?.totalOffers !== undefined) {
        console.log(`📊 Total Offers: ${content.data.totalOffers}`);
      }
      
      console.log('\n📋 Content Preview:');
      console.log(JSON.stringify(content, null, 2).substring(0, 500) + '...\n');
    }
  });

  if (!found) {
    console.log(`❌ Cache file not found: ${filename}\n`);
  }
}

function showHelp() {
  console.log(`
╔════════════════════════════════════════════════╗
║         Cache Management Utility               ║
╚════════════════════════════════════════════════╝

USAGE:
  node cache-manager.js [command] [options]

COMMANDS:
  list              Show cache status summary
  list --detailed   Show detailed file information
  clear             Clear all cache files
  clear <dir>       Clear specific cache directory
  expired           Remove only expired cache files
  inspect <file>    View details of a cache file
  help              Show this help message

EXAMPLES:
  node cache-manager.js list
  node cache-manager.js list --detailed
  node cache-manager.js clear
  node cache-manager.js clear ./cache_pabc
  node cache-manager.js expired
  node cache-manager.js inspect a1b2c3d4e5f6.json

CACHE DIRECTORIES:
  ${CACHE_DIRS.join('\n  ')}

NOTES:
  - Cache expires after 24 hours by default
  - Expired cache is automatically ignored during scraping
  - Use 'expired' to free up space without losing valid cache
`);
}

// Main
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'list':
    listCache(args.includes('--detailed'));
    break;
  
  case 'clear':
    if (args[1]) {
      clearCache(args[1]);
    } else {
      clearCache();
    }
    break;
  
  case 'expired':
    clearExpired();
    break;
  
  case 'inspect':
    if (args[1]) {
      inspectCache(args[1]);
    } else {
      console.log('❌ Please provide a filename to inspect\n');
    }
    break;
  
  case 'help':
  default:
    showHelp();
    break;
}

module.exports = {
  getCacheStats,
  listCache,
  clearCache,
  clearExpired,
  inspectCache
};