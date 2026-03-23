import cron from 'node-cron';
import { createModuleLogger } from './utils/logger.js';
import { RateLimiter, sleep } from './utils/rate-limiter.js';
import { initDatabase, getUnprocessedUrls, markUrlProcessed, upsertProduct,
  getProductsToUpload, markProductUploaded, markProductError,
  getUploadedProducts, updateStockStatus, getStats } from './db/database.js';
import { monitorSitemaps } from './scrapers/sitemap-monitor.js';
import { scrapeGadgetHouseProduct } from './scrapers/gadgethouse-scraper.js';
import { scrapeDropShopProduct } from './scrapers/dropshop-scraper.js';
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
async function stepMonitor() {
  log.info('═══ STEP 1: Monitoring sitemaps ═══');
  const result = await monitorSitemaps();
  log.info(`Sitemap scan complete`, result);
  return result;
}

/**
 * Step 2: Scrape unprocessed product URLs.
 */
async function stepScrape(limit = 50) {
  log.info('═══ STEP 2: Scraping products ═══');
  const urls = getUnprocessedUrls(limit);
  log.info(`Found ${urls.length} unprocessed URLs`);

  let scraped = 0;
  let failed = 0;

  for (const urlRecord of urls) {
    await rateLimiter.wait();

    let product = null;

    if (urlRecord.source_site === 'gadgetHouse') {
      product = await scrapeGadgetHouseProduct(urlRecord.url);
    } else if (urlRecord.source_site === 'dropShop') {
      product = await scrapeDropShopProduct(urlRecord.url);
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
async function stepUpload(limit = 20) {
  log.info('═══ STEP 3: Uploading products ═══');
  const products = getProductsToUpload(limit);
  log.info(`Found ${products.length} products to upload`);

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
async function stepSyncStock() {
  log.info('═══ STEP 4: Syncing stock status ═══');
  const uploadedProducts = getUploadedProducts();
  log.info(`Checking stock for ${uploadedProducts.length} uploaded products`);

  let updated = 0;

  for (const product of uploadedProducts) {
    await rateLimiter.wait();

    let currentProduct = null;
    if (product.source_site === 'gadgetHouse') {
      currentProduct = await scrapeGadgetHouseProduct(product.source_url);
    } else if (product.source_site === 'dropShop') {
      currentProduct = await scrapeDropShopProduct(product.source_url);
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
async function runPipeline() {
  const startTime = Date.now();
  log.info('╔══════════════════════════════════════╗');
  log.info('║  Giggly Automation Pipeline Started  ║');
  log.info('╚══════════════════════════════════════╝');

  if (DRY_RUN) log.info('🏳️ DRY RUN MODE — no uploads will be performed');

  try {
    // Step 1: Monitor sitemaps
    await stepMonitor();

    // Step 2: Scrape products
    await stepScrape(LIMIT < Infinity ? LIMIT : 50);

    // Step 3: Upload (unless scrape-only or dry-run)
    if (!SCRAPE_ONLY && !DRY_RUN) {
      await stepUpload(LIMIT < Infinity ? LIMIT : 20);
    } else if (DRY_RUN) {
      const toUpload = getProductsToUpload(LIMIT < Infinity ? LIMIT : 20);
      log.info(`[DRY RUN] Would upload ${toUpload.length} products`);
      for (const p of toUpload) {
        log.info(`  → ${p.title} | ৳${p.final_price} | ${p.source_site}`);
      }
    }

    // Step 4: Sync stock (if requested)
    if (SYNC_STOCK) {
      await stepSyncStock();
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

  // If a specific mode is requested, run once and exit
  if (TEST_UPLOAD || DRY_RUN || SCRAPE_ONLY || SYNC_STOCK || LIMIT < Infinity) {
    await runPipeline();
    process.exit(0);
  }

  // Otherwise, run immediately + schedule periodic runs
  await runPipeline();

  const cronInterval = `*/${config.scraping.monitorIntervalMinutes} * * * *`;
  log.info(`Scheduling next runs every ${config.scraping.monitorIntervalMinutes} minutes (${cronInterval})`);

  cron.schedule(cronInterval, async () => {
    log.info('⏰ Scheduled run triggered');
    await runPipeline();
  });

  log.info('Automation is running. Press Ctrl+C to stop.');
}

main().catch(error => {
  log.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
