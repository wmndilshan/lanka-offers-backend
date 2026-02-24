import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const rootDir = path.join(process.cwd(), '..');

export async function POST(request) {
  try {
    const { operation } = await request.json();

    let result;

    switch (operation) {
      case 'clear-cache':
        result = await clearCache();
        break;
      case 'refresh-data':
        result = await refreshData();
        break;
      case 'cleanup-old':
        result = await cleanupOldData();
        break;
      default:
        return NextResponse.json(
          { error: 'Unknown operation' },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Admin API error:', error);
    return NextResponse.json(
      { error: 'Operation failed', message: error.message },
      { status: 500 }
    );
  }
}

async function clearCache() {
  try {
    const cacheDir = path.join(rootDir, 'cache_geo');

    if (!fs.existsSync(cacheDir)) {
      return {
        message: 'Cache directory does not exist',
        details: 'No cache to clear'
      };
    }

    let filesDeleted = 0;
    const subdirs = ['geocode', 'places'];

    for (const subdir of subdirs) {
      const dirPath = path.join(cacheDir, subdir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          fs.unlinkSync(path.join(dirPath, file));
          filesDeleted++;
        }
      }
    }

    return {
      message: 'Cache cleared successfully',
      details: `Deleted ${filesDeleted} cached files`
    };
  } catch (error) {
    throw new Error('Failed to clear cache: ' + error.message);
  }
}

async function refreshData() {
  try {
    const outputDir = path.join(rootDir, 'output');

    if (!fs.existsSync(outputDir)) {
      return {
        message: 'Output directory not found',
        details: 'No data files to refresh'
      };
    }

    const files = fs.readdirSync(outputDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    // Force reload by clearing Node's require cache
    Object.keys(require.cache).forEach(key => {
      if (key.includes('output')) {
        delete require.cache[key];
      }
    });

    return {
      message: 'Data refreshed successfully',
      details: `Reloaded ${jsonFiles.length} data files`
    };
  } catch (error) {
    throw new Error('Failed to refresh data: ' + error.message);
  }
}

async function cleanupOldData() {
  try {
    const outputDir = path.join(rootDir, 'output');

    if (!fs.existsSync(outputDir)) {
      return {
        message: 'Output directory not found',
        details: 'No data to cleanup'
      };
    }

    let removedCount = 0;
    const files = fs.readdirSync(outputDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.includes('_geo'));

    for (const file of jsonFiles) {
      const filePath = path.join(outputDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      let offers = Array.isArray(data) ? data : data.offers || [];
      const originalCount = offers.length;

      // Remove expired offers (if valid_to date is in the past)
      const now = new Date();
      offers = offers.filter(offer => {
        const validTo = offer.valid_to || offer.validTo;
        if (!validTo) return true; // Keep if no expiry date

        const expiryDate = new Date(validTo);
        return expiryDate >= now;
      });

      if (offers.length < originalCount) {
        // Write back the cleaned data
        if (Array.isArray(data)) {
          fs.writeFileSync(filePath, JSON.stringify(offers, null, 2));
        } else {
          data.offers = offers;
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        }
        removedCount += (originalCount - offers.length);
      }
    }

    return {
      message: 'Cleanup completed successfully',
      details: removedCount > 0
        ? `Removed ${removedCount} expired offers`
        : 'No expired offers found'
    };
  } catch (error) {
    throw new Error('Failed to cleanup old data: ' + error.message);
  }
}
