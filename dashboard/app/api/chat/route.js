import { NextResponse } from 'next/server';
import { loadAllOffers, getStats, loadGeoData } from '@/lib/data';

export async function POST(request) {
  try {
    const { message } = await request.json();

    // Load data for analysis
    const offers = loadAllOffers();
    const stats = getStats();
    const geoData = loadGeoData();

    // Simple keyword-based responses
    const response = analyzeQuery(message, { offers, stats, geoData });

    return NextResponse.json({ response });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process message' },
      { status: 500 }
    );
  }
}

function analyzeQuery(message, { offers, stats, geoData }) {
  const msg = message.toLowerCase();

  // Stats queries
  if (msg.includes('how many') || msg.includes('total') || msg.includes('count')) {
    if (msg.includes('offer')) {
      return `There are currently ${stats.totalOffers} active offers across all banks.`;
    }
    if (msg.includes('location')) {
      return `We have ${stats.totalLocations} geocoded locations mapped.`;
    }
    if (msg.includes('bank')) {
      return `Data is available from ${stats.banksCovered} banks.`;
    }
    return `Current stats: ${stats.totalOffers} offers, ${stats.totalLocations} locations, ${stats.banksCovered} banks.`;
  }

  // Bank-specific queries
  const banks = ['hnb', 'boc', 'ndb', 'sampath', 'seylan', 'peoples', 'dfcc'];
  for (const bank of banks) {
    if (msg.includes(bank)) {
      const bankOffers = offers.filter(o => o.bank.toLowerCase() === bank);
      return `${bank.toUpperCase()} has ${bankOffers.length} active offers. Recent merchants include: ${
        bankOffers.slice(0, 3).map(o => o.merchant).join(', ')
      }.`;
    }
  }

  // Category queries
  if (msg.includes('restaurant') || msg.includes('dining') || msg.includes('food')) {
    const foodOffers = offers.filter(o =>
      o.category?.toLowerCase().includes('restaurant') ||
      o.category?.toLowerCase().includes('dining') ||
      o.category?.toLowerCase().includes('food')
    );
    return `There are ${foodOffers.length} dining and food-related offers available.`;
  }

  // Location queries
  if (msg.includes('map') || msg.includes('location') || msg.includes('where')) {
    return `We have ${geoData.length} geocoded locations. You can view them all on the Map View page.`;
  }

  // API usage queries
  if (msg.includes('api') || msg.includes('usage') || msg.includes('quota')) {
    return `API usage this month: ${stats.apiUsageThisMonth} requests. Monitor usage on the dashboard to stay within limits.`;
  }

  // Recent activity
  if (msg.includes('recent') || msg.includes('latest') || msg.includes('new')) {
    const recent = offers.slice(0, 5);
    return `Latest offers:\n${recent.map(o => `• ${o.merchant} (${o.bank}): ${o.discount}`).join('\n')}`;
  }

  // Best deals
  if (msg.includes('best') || msg.includes('top') || msg.includes('highest')) {
    const withPercentage = offers.filter(o => o.discount?.includes('%'));
    const sorted = withPercentage.sort((a, b) => {
      const aNum = parseInt(a.discount) || 0;
      const bNum = parseInt(b.discount) || 0;
      return bNum - aNum;
    });
    const top = sorted.slice(0, 5);
    return `Top deals by discount:\n${top.map(o => `• ${o.merchant}: ${o.discount} (${o.bank})`).join('\n')}`;
  }

  // Default response with helpful suggestions
  return `I can help you with:
• Statistics ("how many offers?")
• Bank-specific info ("show me HNB offers")
• Category searches ("food offers")
• Recent activity ("latest offers")
• Best deals ("top discounts")
• Location data ("geocoded locations")

What would you like to know?`;
}
