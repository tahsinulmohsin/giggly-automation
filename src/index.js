import cron from 'node-cron';
import readline from 'readline/promises';
import { createModuleLogger } from './utils/logger.js';
import { RateLimiter, sleep } from './utils/rate-limiter.js';
import { initDatabase, getUnprocessedUrls, markUrlProcessed, upsertProduct,
  getProductsToUpload, markProductUploaded, markProductError,
  getUploadedProducts, updateStockStatus, getStats, resetOrphanedUrls } from './db/database.js';
import { monitorSitemaps } from './scrapers/sitemap-monitor.js';
import { scrapeGadgetHouseProduct } from './scrapers/gadgethouse-scraper.js';
import { scrapeDropShopProduct } from './scrapers/dropshop-scraper.js';
import { scrapeGadgetTrackProduct } from './scrapers/gadgettrack-scraper.js';
import { scrapeWooCommerceProduct } from './scrapers/woocommerce-scraper.js';
import { processProduct } from './processors/name-replacer.js';
import { uploadProduct, updateProductStock } from './uploaders/woo-uploader.js';
import config from './config.js';

const log = createModuleLogger('main');
const rateLimiter = new RateLimiter(config.scraping.scrapeDelayMs);

// ── CLI Flags ──
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SCRAPE_ONLY = args.includes('--scrape-only');
const SYNC_STOCK = args.includes('--sync-stock');
const TEST_UPLOAD = args.includes('--test-upload');
const LIMIT = (() => {
  const idx = args.indexOf('--limit');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : Infinity;
})();

/**
 * Step 1: Monitor sitemaps for new product URLs.
 */
async function stepMonitor(targetSource = null) {
  log.info('═══ STEP 1: Monitoring sitemaps ═══');

  // Auto-reset orphaned URLs (processed but product was deleted)
  const orphansReset = resetOrphanedUrls(targetSource);
  if (orphansReset > 0) {
    log.info(`♻️ Auto-recovered ${orphansReset} orphaned URLs back into the scrape queue`);
  }

  const result = await monitorSitemaps(targetSource);
  log.info(`Sitemap scan complete`, result);
  return result;
}

/**
 * Step 2: Scrape unprocessed product URLs.
 */
async function stepScrape(limit = 50, targetSource = null) {
  log.info('═══ STEP 2: Scraping products ═══');
  const urls = getUnprocessedUrls(limit, targetSource);
  log.info(`Found ${urls.length} unprocessed URLs for target: ${targetSource || 'all'}`);

  let scraped = 0;
  let failed = 0;

  for (const urlRecord of urls) {
    if (targetSource && targetSource !== 'all' && urlRecord.source_site !== targetSource) {
      continue;
    }

    await rateLimiter.wait();

    let product = null;

    if (urlRecord.source_site === 'gadgetHouse') {
      product = await scrapeGadgetHouseProduct(urlRecord.url);
    } else if (urlRecord.source_site === 'dropShop') {
      product = await scrapeDropShopProduct(urlRecord.url);
    } else if (urlRecord.source_site === 'gadgetTrack') {
      product = await scrapeGadgetTrackProduct(urlRecord.url);
    } else {
      product = await scrapeWooCommerceProduct(urlRecord.url, urlRecord.source_site);
    }

    if (product) {
      // Process: replace source names
      const processed = processProduct(product);
      upsertProduct(processed);
      scraped++;
      log.info(`✓ Scraped & stored: ${processed.title}`);
    } else {
      failed++;
      log.warn(`✗ Failed to scrape: ${urlRecord.url}`);
    }

    markUrlProcessed(urlRecord.url);
  }

  log.info(`Scraping complete`, { scraped, failed, total: urls.length });
  return { scraped, failed };
}

/**
 * Step 3: Upload scraped products to giggly.shop.
 */
async function stepUpload(limit = 20, targetSource = null) {
  log.info('═══ STEP 3: Uploading products ═══');
  const products = getProductsToUpload(limit, targetSource);
  log.info(`Found ${products.length} products to upload for target: ${targetSource || 'all'}`);

  let uploaded = 0;
  let errors = 0;

  for (const product of products) {
    try {
      const wcId = await uploadProduct(product);

      if (wcId) {
        markProductUploaded(product.source_url, wcId);
        uploaded++;
        log.info(`✓ Uploaded: ${product.title} → WC #${wcId}`);
      } else {
        markProductError(product.source_url, 'Upload returned null');
        errors++;
      }

      // Rate limit API calls
      await sleep(3000);
    } catch (error) {
      markProductError(product.source_url, error.message);
      errors++;
      log.error(`✗ Failed to upload: ${product.title}`, { error: error.message });
    }
  }

  log.info(`Upload complete`, { uploaded, errors, total: products.length });
  return { uploaded, errors };
}

/**
 * Step 4: Sync stock status for already-uploaded products.
 */
async function stepSyncStock(targetSource = null) {
  log.info('═══ STEP 4: Syncing stock status ═══');
  const uploadedProducts = getUploadedProducts();
  log.info(`Checking stock for ${uploadedProducts.length} uploaded products`);

  let updated = 0;

  for (const product of uploadedProducts) {
    if (targetSource && targetSource !== 'all' && product.source_site !== targetSource) {
      continue;
    }

    await rateLimiter.wait();

    let currentProduct = null;
    if (product.source_site === 'gadgetHouse') {
      currentProduct = await scrapeGadgetHouseProduct(product.source_url);
    } else if (product.source_site === 'dropShop') {
      currentProduct = await scrapeDropShopProduct(product.source_url);
    } else if (product.source_site === 'gadgetTrack') {
      currentProduct = await scrapeGadgetTrackProduct(product.source_url);
    } else {
      currentProduct = await scrapeWooCommerceProduct(product.source_url, product.source_site);
    }

    if (currentProduct && currentProduct.stock_status !== product.stock_status) {
      updateStockStatus(product.source_url, currentProduct.stock_status);
      if (product.wc_product_id) {
        await updateProductStock(product.wc_product_id, currentProduct.stock_status);
      }
      updated++;
      log.info(`Stock updated: ${product.title} → ${currentProduct.stock_status}`);
    }
  }

  log.info(`Stock sync complete`, { checked: uploadedProducts.length, updated });
  return { checked: uploadedProducts.length, updated };
}

/**
 * Run the full pipeline.
 */
async function runPipeline(targetSource = null) {
  const startTime = Date.now();
  log.info('╔══════════════════════════════════════╗');
  log.info('║  Giggly Automation Pipeline Started  ║');
  log.info('╚══════════════════════════════════════╝');

  if (DRY_RUN) log.info('🏳️ DRY RUN MODE — no uploads will be performed');

  try {
    // Step 1: Monitor sitemaps
    await stepMonitor(targetSource);

    // Step 2: Scrape products
    await stepScrape(LIMIT < Infinity ? LIMIT : 50, targetSource);

    // Step 3: Upload (unless scrape-only or dry-run)
    if (!SCRAPE_ONLY && !DRY_RUN) {
      await stepUpload(LIMIT < Infinity ? LIMIT : 20, targetSource);
    } else if (DRY_RUN) {
      const toUpload = getProductsToUpload(LIMIT < Infinity ? LIMIT : 20, targetSource);
      log.info(`[DRY RUN] Would upload ${toUpload.length} products for target: ${targetSource || 'all'}`);
      for (const p of toUpload) {
        log.info(`  → ${p.title} | ৳${p.final_price} | ${p.source_site}`);
      }
    }

    // Step 4: Sync stock (if requested)
    if (SYNC_STOCK) {
      await stepSyncStock(targetSource);
    }

    // Print stats
    const stats = getStats();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.info('╔══════════════════════════════════════╗');
    log.info('║  Pipeline Complete                   ║');
    log.info('╚══════════════════════════════════════╝');
    log.info(`Stats:`, stats);
    log.info(`Time elapsed: ${elapsed}s`);
  } catch (error) {
    log.error('Pipeline error', { error: error.message, stack: error.stack });
  }
}

// ── Entry Point ──
async function main() {
  log.info('Initializing Giggly Product Automation System...');

  // Validate config
  if (!config.wc.consumerKey || !config.wc.consumerSecret) {
    log.warn('⚠️ WooCommerce API credentials not set. Upload will fail.');
    log.warn('  Set WC_CONSUMER_KEY and WC_CONSUMER_SECRET in .env');
  }

  // Initialize database
  initDatabase();

  let targetSource = 'all';

  // Ask for target source if running interactively
  if (!TEST_UPLOAD && !DRY_RUN && !SCRAPE_ONLY && !SYNC_STOCK && LIMIT === Infinity) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│  Giggly Gadgets Product Automation       │');
    console.log('├──────────────────────────────────────────┤');
    console.log('│  Select target website to process:       │');
    console.log('│                                          │');
    console.log('│  [1] Gadget House BD                     │');
    console.log('│  [2] DropShop                            │');
    console.log('│  [3] Gadget Track BD                     │');
    console.log('│  [4] Executive Ample                     │');
    console.log('│  [5] Gadget Breeze                       │');
    console.log('│  [6] Accessories Vandar                  │');
    console.log('│  [7] GadgetZ                             │');
    console.log('│  [8] Famous Gadget                       │');
    console.log('│  [9] All Websites (Default)              │');
    console.log('└──────────────────────────────────────────┘\n');
    
    const answer = await rl.question('Select an option (1-9) [9]: ');
    rl.close();
    
    switch(answer.trim()) {
      case '1': targetSource = 'gadgetHouse'; break;
      case '2': targetSource = 'dropShop'; break;
      case '3': targetSource = 'gadgetTrack'; break;
      case '4': targetSource = 'executiveAmple'; break;
      case '5': targetSource = 'gadgetBreeze'; break;
      case '6': targetSource = 'accessoriesVandar'; break;
      case '7': targetSource = 'gadgetZ'; break;
      case '8': targetSource = 'famousGadget'; break;
      default: targetSource = 'all';
    }
    
    log.info(`Target source selected: ${targetSource === 'all' ? 'All Websites' : targetSource}`);
  }

  // If a specific mode is requested, run once and exit
  if (TEST_UPLOAD || DRY_RUN || SCRAPE_ONLY || SYNC_STOCK || LIMIT < Infinity) {
    await runPipeline(targetSource);
    process.exit(0);
  }

  // Otherwise, run immediately + schedule periodic runs
  await runPipeline(targetSource);

  const cronInterval = `*/${config.scraping.monitorIntervalMinutes} * * * *`;
  log.info(`Scheduling next runs every ${config.scraping.monitorIntervalMinutes} minutes (${cronInterval})`);

  cron.schedule(cronInterval, async () => {
    log.info('⏰ Scheduled run triggered');
    await runPipeline(targetSource);
  });

  log.info('Automation is running. Press Ctrl+C to stop.');
}

main().catch(error => {
  log.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
