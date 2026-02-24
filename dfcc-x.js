/**
 * DFCC Diagnostic Script - Inspect actual page structure
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function inspectDFCCPage() {
    console.log('🔍 Inspecting DFCC website structure...\n');

    const url = 'https://www.dfcc.lk/dining-promotion';

    const browser = await puppeteer.launch({
        headless: false, // Show browser for visual inspection
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`📥 Loading: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('⏳ Waiting 5 seconds for content to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Take screenshot
    await page.screenshot({ path: 'dfcc_screenshot.png', fullPage: true });
    console.log('📸 Screenshot saved: dfcc_screenshot.png');

    // Get page HTML
    const html = await page.content();
    fs.writeFileSync('dfcc_page.html', html);
    console.log('💾 HTML saved: dfcc_page.html');

    // Inspect structure
    const inspection = await page.evaluate(() => {
        const result = {
            selectors: {},
            sampleCards: []
        };

        // Check for various possible selectors
        const selectorsToCheck = [
            'a.cardd',
            '.cardd',
            'a[href*="cards-promotions"]',
            'a[href*="promotion"]',
            '[class*="card"]',
            '.promotion',
            '.offer',
            'article',
            '.grid > *',
            '[class*="promo"]'
        ];

        selectorsToCheck.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            result.selectors[selector] = {
                count: elements.length,
                exists: elements.length > 0
            };
        });

        // Try to find promotion links
        const allLinks = document.querySelectorAll('a[href*="promotion"], a[href*="cards"]');
        result.totalLinks = allLinks.length;

        // Get sample of first few links with promotion in URL
        const promoLinks = Array.from(allLinks).slice(0, 5).map(link => ({
            href: link.href,
            classes: link.className,
            text: link.textContent.substring(0, 100).trim()
        }));

        result.sampleLinks = promoLinks;

        // Check for common container patterns
        const containerSelectors = [
            'main',
            '[class*="container"]',
            '[class*="grid"]',
            '[class*="list"]',
            '[class*="cards"]'
        ];

        result.containers = {};
        containerSelectors.forEach(sel => {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                result.containers[sel] = {
                    count: els.length,
                    firstClasses: els[0].className
                };
            }
        });

        return result;
    });

    console.log('\n📊 INSPECTION RESULTS:\n');
    console.log('='.repeat(60));

    console.log('\n🎯 Selector Check:');
    Object.entries(inspection.selectors).forEach(([selector, info]) => {
        const status = info.exists ? '✅' : '❌';
        console.log(`${status} ${selector.padEnd(35)} : ${info.count} elements`);
    });

    console.log(`\n🔗 Total promotion links found: ${inspection.totalLinks}`);

    if (inspection.sampleLinks.length > 0) {
        console.log('\n📝 Sample Links:');
        inspection.sampleLinks.forEach((link, i) => {
            console.log(`\n${i + 1}. ${link.href}`);
            console.log(`   Classes: ${link.classes || '(none)'}`);
            console.log(`   Text: ${link.text}`);
        });
    }

    console.log('\n📦 Containers:');
    Object.entries(inspection.containers).forEach(([selector, info]) => {
        console.log(`✅ ${selector.padEnd(30)} : ${info.count} (classes: ${info.firstClasses})`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('\n✨ Inspection complete!');
    console.log('📁 Files saved:');
    console.log('   - dfcc_screenshot.png (visual)');
    console.log('   - dfcc_page.html (full HTML)');
    console.log('\n💡 Check these files to see the actual page structure');
    console.log('   Browser window left open for manual inspection');
    console.log('   Press Ctrl+C when done\n');

    // Keep browser open for manual inspection
    await new Promise(() => { }); // Never resolves - keeps browser open
}

inspectDFCCPage().catch(console.error);