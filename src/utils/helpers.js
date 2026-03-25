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

import * as cheerio from 'cheerio';

/**
 * Reverses WordPress lazy-loading obfuscation by moving real URLs from data attributes back into the native `src` tag.
 * Resolves all relative URLs into absolute URLs linking to the original source.
 * @param {string} html The raw HTML description
 * @param {string} baseUrl The base URL of the source website (e.g. 'https://gadgetbreeze.com.bd')
 * @returns {string} Sanitized HTML
 */
export function cleanDescriptionHtml(html, baseUrl) {
  if (!html) return html;
  
  const $ = cheerio.load(html, null, false);
  
  // Remove all <noscript> tags entirely because they hide raw HTML from Cheerio 
  // and frequently duplicate lazy-loaded images, causing regex leakage.
  $('noscript').remove();

  // Clean images
  $('img').each(function() {
    const $img = $(this);
    
    // Look for lazy-load data attributes
    const realSrc = $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('data-woodmart-src');
    if (realSrc) {
      $img.attr('src', realSrc);
    }
    
    const realSrcset = $img.attr('data-srcset') || $img.attr('data-lazy-srcset');
    if (realSrcset) {
      $img.attr('srcset', realSrcset);
    }
    
    // Clean up to prevent conflicts
    $img.removeAttr('data-src');
    $img.removeAttr('data-lazy-src');
    $img.removeAttr('data-woodmart-src');
    $img.removeAttr('data-srcset');
    $img.removeAttr('data-lazy-srcset');
    
    // Some lazy-loaders inject their own placeholder classes
    $img.removeClass('lazyload lazyloaded wp-image-lazy');

    // Make src absolute
    const src = $img.attr('src');
    if (src && baseUrl) {
      try {
        $img.attr('src', new URL(src, baseUrl).href);
      } catch (e) {}
    }
  });

  // Make all links absolute to prevent 404s on the target site
  if (baseUrl) {
    $('a').each(function() {
      const href = $(this).attr('href');
      if (href) {
        try {
          $(this).attr('href', new URL(href, baseUrl).href);
        } catch (e) {}
      }
    });
  }
  
  return $.html();
}
