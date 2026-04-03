import { parseStringPromise } from 'xml2js';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { createModuleLogger } from '../utils/logger.js';
import { fetchWithRetry } from '../utils/helpers.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { addSitemapUrl, isUrlKnown } from '../db/database.js';
import config from '../config.js';

const log = createModuleLogger('sitemap-monitor');
const rateLimiter = new RateLimiter(1000);

/**
 * Crawl DropShop's paginated /shop/ pages to discover product URLs
 * beyond the 2,000-entry WordPress sitemap cap.
 * @returns {Promise<string[]>} All discovered product URLs
 */
async function crawlDropShopShopPages() {
  const headers = {
    'User-Agent': config.scraping.userAgent,
  };

  // Get first page to find total page count
  let totalPages = 1;
  try {
    const firstRes = await axios.get('https://dropshop.com.bd/shop/', { headers, timeout: config.scraping.requestTimeout });
    const $first = cheerio.load(firstRes.data);
    const lastPageLink = $first('.woocommerce-pagination .page-numbers:not(.next)').last().text().trim();
    totalPages = parseInt(lastPageLink) || 1;
    log.info(`DropShop shop crawler: detected ${totalPages} total shop pages`);
  } catch (e) {
    log.error('Failed to determine DropShop total pages', { error: e.message });
    return [];
  }

  const allUrls = [];
  let consecutiveEmpty = 0;

  for (let page = 1; page <= totalPages; page++) {
    try {
      await rateLimiter.wait();
      const url = page === 1
        ? 'https://dropshop.com.bd/shop/'
        : `https://dropshop.com.bd/shop/page/${page}/`;

      const res = await axios.get(url, { headers, timeout: config.scraping.requestTimeout });
      const $ = cheerio.load(res.data);
      let pageCount = 0;

      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.match(/\/product\/[^/]+\/$/) && !allUrls.includes(href)) {
          allUrls.push(href);
          pageCount++;
        }
      });

      if (pageCount === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) {
          log.info(`DropShop shop crawler: 3 consecutive empty pages at page ${page}, stopping`);
          break;
        }
      } else {
        consecutiveEmpty = 0;
      }

      if (page % 20 === 0) {
        log.info(`DropShop shop crawler: scanned ${page}/${totalPages} pages, ${allUrls.length} URLs so far`);
      }
    } catch (e) {
      if (e.response?.status === 404) {
        log.info(`DropShop shop crawler: page ${page} returned 404, stopping`);
        break;
      }
      log.warn(`DropShop shop crawler: error on page ${page}`, { error: e.message });
    }
  }

  log.info(`DropShop shop crawler complete: discovered ${allUrls.length} total product URLs`);
  return allUrls;
}

/**
 * Crawl RootGear's paginated /shop/ pages to discover product URLs
 * @returns {Promise<string[]>} All discovered product URLs
 */
async function crawlRootGearShopPages() {
  const headers = {
    'User-Agent': config.scraping.userAgent,
  };

  let totalPages = 1;
  try {
    const firstRes = await axios.get('https://rootgearbd.com/shop/', { headers, timeout: config.scraping.requestTimeout });
    const $first = cheerio.load(firstRes.data);
    const lastPageLink = $first('.woocommerce-pagination .page-numbers:not(.next)').last().text().trim();
    totalPages = parseInt(lastPageLink) || 1;
    log.info(`RootGear shop crawler: detected ${totalPages} total shop pages`);
  } catch (e) {
    log.error('Failed to determine RootGear total pages', { error: e.message });
    return [];
  }

  const allUrls = [];
  let consecutiveEmpty = 0;

  for (let page = 1; page <= totalPages; page++) {
    try {
      await rateLimiter.wait();
      const url = page === 1
        ? 'https://rootgearbd.com/shop/'
        : `https://rootgearbd.com/shop/page/${page}/`;

      const res = await axios.get(url, { headers, timeout: config.scraping.requestTimeout });
      const $ = cheerio.load(res.data);
      let pageCount = 0;

      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.match(/\/product\/[^/]+\/$/) && !href.includes('/product-category/') && !allUrls.includes(href)) {
          allUrls.push(href);
          pageCount++;
        }
      });

      if (pageCount === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) {
          log.info(`RootGear shop crawler: 3 consecutive empty pages at page ${page}, stopping`);
          break;
        }
      } else {
        consecutiveEmpty = 0;
      }

      if (page % 5 === 0 || page === totalPages) {
        log.info(`RootGear shop crawler: scanned ${page}/${totalPages} pages, ${allUrls.length} URLs so far`);
      }
    } catch (e) {
      if (e.response?.status === 404) {
        log.info(`RootGear shop crawler: page ${page} returned 404, stopping`);
        break;
      }
      log.warn(`RootGear shop crawler: error on page ${page}`, { error: e.message });
    }
  }

  log.info(`RootGear shop crawler complete: discovered ${allUrls.length} total product URLs`);
  return allUrls;
}

/**
 * Parse a sitemap XML (sitemap index or urlset) and return all product URLs.
 * @param {string} sitemapUrl
 * @returns {Promise<string[]>}
 */
async function parseSitemap(sitemapUrl) {
  try {
    await rateLimiter.wait();
    const xml = await fetchWithRetry(sitemapUrl);
    const result = await parseStringPromise(xml, { explicitArray: false });

    // If it's a sitemap index, recursively parse child sitemaps
    if (result.sitemapindex) {
      const sitemaps = Array.isArray(result.sitemapindex.sitemap)
        ? result.sitemapindex.sitemap
        : [result.sitemapindex.sitemap];
      const allUrls = [];
      for (const s of sitemaps) {
        const childUrl = s.loc;
        if (childUrl && childUrl.includes('product')) {
          const urls = await parseSitemap(childUrl);
          allUrls.push(...urls);
        }
      }
      return allUrls;
    }

    // It's a URL set — extract all <loc> entries
    if (result.urlset && result.urlset.url) {
      const urls = Array.isArray(result.urlset.url)
        ? result.urlset.url
        : [result.urlset.url];
      return urls.map(u => u.loc).filter(Boolean);
    }

    return [];
  } catch (error) {
    log.error(`Failed to parse sitemap: ${sitemapUrl}`, { error: error.message });
    return [];
  }
}

/**
 * Check all source sitemaps for new product URLs and add them to the queue.
 * @param {string|null} targetSource - Specific source site to monitor, or null for all
 * @returns {Promise<{total: number, newUrls: number}>}
 */
export async function monitorSitemaps(targetSource = null) {
  log.info('Starting sitemap monitoring cycle...');
  let totalUrls = 0;
  let newUrls = 0;

  for (const [sourceKey, sourceConfig] of Object.entries(config.sources)) {
    if (targetSource && targetSource !== 'all' && sourceKey !== targetSource) {
      continue;
    }
    
    // Skip normal sitemap scan if sitemaps array is empty (like for RootGear)
    if (!sourceConfig.sitemaps || sourceConfig.sitemaps.length === 0) {
      continue;
    }

    log.info(`Checking sitemaps for ${sourceConfig.name}...`, {
      sitemapCount: sourceConfig.sitemaps.length,
    });

    for (const sitemapUrl of sourceConfig.sitemaps) {
      try {
        const urls = await parseSitemap(sitemapUrl);
        totalUrls += urls.length;

        for (const url of urls) {
          if (!isUrlKnown(url)) {
            addSitemapUrl(url, sourceKey);
            newUrls++;
          }
        }

        log.info(`Parsed sitemap: ${sitemapUrl}`, { urlCount: urls.length });
      } catch (error) {
        log.error(`Error processing sitemap: ${sitemapUrl}`, { error: error.message });
      }
    }
  }

  // DropShop special: crawl paginated shop pages to discover URLs beyond the 2,000 sitemap cap
  const shouldCrawlDropShop = !targetSource || targetSource === 'all' || targetSource === 'dropShop';
  if (shouldCrawlDropShop && config.sources.dropShop) {
    log.info('Running DropShop shop page crawler (sitemap only exposes 2,000 of ~3,800+ products)...');
    try {
      const crawledUrls = await crawlDropShopShopPages();
      let crawlNew = 0;
      for (const url of crawledUrls) {
        if (!isUrlKnown(url)) {
          addSitemapUrl(url, 'dropShop');
          crawlNew++;
          newUrls++;
        }
      }
      totalUrls += crawledUrls.length;
      log.info(`DropShop shop crawler: added ${crawlNew} new URLs beyond sitemap cap`);
    } catch (e) {
      log.error('DropShop shop crawler failed', { error: e.message });
    }
  }

  // RootGear special: crawl paginated shop pages
  const shouldCrawlRootGear = !targetSource || targetSource === 'all' || targetSource === 'rootGear';
  if (shouldCrawlRootGear && config.sources.rootGear) {
    log.info('Running RootGear shop page crawler...');
    try {
      const crawledUrls = await crawlRootGearShopPages();
      let crawlNew = 0;
      for (const url of crawledUrls) {
        if (!isUrlKnown(url)) {
          addSitemapUrl(url, 'rootGear');
          crawlNew++;
          newUrls++;
        }
      }
      totalUrls += crawledUrls.length;
      log.info(`RootGear shop crawler: added ${crawlNew} new URLs`);
    } catch (e) {
      log.error('RootGear shop crawler failed', { error: e.message });
    }
  }

  log.info('Sitemap monitoring cycle complete', { totalUrls, newUrls });
  return { totalUrls, newUrls };
}
