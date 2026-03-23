import axios from 'axios';
import config from '../config.js';

/**
 * Create an Axios instance with default headers and timeout for scraping.
 */
export function createHttpClient(extraHeaders = {}) {
  return axios.create({
    timeout: config.scraping.requestTimeout,
    headers: {
      'User-Agent': config.scraping.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      ...extraHeaders,
    },
    maxRedirects: 5,
  });
}

/**
 * Fetch a URL with retries.
 * @param {string} url
 * @param {object|number} options - Options object `{ headers, retries }` or just retries number (for backwards compatibility)
 * @returns {Promise<string>} HTML content
 */
export async function fetchWithRetry(url, options = {}) {
  const retries = typeof options === 'number' ? options : (options.retries || config.scraping.maxRetries);
  const extraHeaders = options.headers || {};
  
  const client = createHttpClient(extraHeaders);
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.get(url);
      return response.data;
    } catch (error) {
      if (attempt === retries) throw error;
      const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
}

/**
 * Clean a price string like "4,250.00৳" into a number.
 * @param {string} priceStr
 * @returns {number|null}
 */
export function parsePrice(priceStr) {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[৳,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Generate a URL-safe slug from a title.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}
