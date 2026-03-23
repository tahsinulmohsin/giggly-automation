import { parseStringPromise } from 'xml2js';
import { createModuleLogger } from '../utils/logger.js';
import { fetchWithRetry } from '../utils/helpers.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { addSitemapUrl, isUrlKnown } from '../db/database.js';
import config from '../config.js';

const log = createModuleLogger('sitemap-monitor');
const rateLimiter = new RateLimiter(1000);

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
 * @returns {Promise<{total: number, newUrls: number}>}
 */
export async function monitorSitemaps() {
  log.info('Starting sitemap monitoring cycle...');
  let totalUrls = 0;
  let newUrls = 0;

  for (const [sourceKey, sourceConfig] of Object.entries(config.sources)) {
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

  log.info('Sitemap monitoring cycle complete', { totalUrls, newUrls });
  return { totalUrls, newUrls };
}
