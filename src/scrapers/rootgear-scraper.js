import * as cheerio from 'cheerio';
import { createModuleLogger } from '../utils/logger.js';
import { fetchWithRetry } from '../utils/helpers.js';
import { processProduct } from '../processors/name-replacer.js';

const log = createModuleLogger('rootgear-scraper');

/**
 * Scrape a RootGear product page.
 * @param {string} url
 * @returns {Promise<object>} Extracted product payload
 */
export async function scrapeRootGearProduct(url) {
  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    // Title
    const title = $('.product_title').text().trim();
    if (!title) {
      throw new Error('Title not found on page');
    }

    // Price
    let priceText = $('p.price ins .woocommerce-Price-amount').text().trim();
    if (!priceText) {
      priceText = $('p.price > .woocommerce-Price-amount').text().trim() || $('p.price').text().trim();
    }
    // We need to properly extract before decimals. Since it might format as "8,000.00", we split by dot first
    let rawPriceStr = priceText.split('.')[0] || priceText;
    const regularPrice = parseInt(rawPriceStr.replace(/[^\d]/g, ''), 10) || 0;

    // Stock Status
    // RootGear: `.in-stock` or `.stock:not(.out-of-stock)` for in-stock, `.out-of-stock` for out-of-stock
    const outOfStock = $('.out-of-stock').length > 0;
    const stockStatus = outOfStock ? 'outofstock' : 'instock';

    // Categories
    // User requested ALL RootGear products to be placed in 'Peripherals'
    const categories = ['Peripherals'];
    $('.posted_in a').each((i, el) => {
      const cat = $(el).text().trim();
      if (cat && !categories.includes(cat)) categories.push(cat);
    });

    // Tags
    const tags = [];
    $('.tagged_as a').each((i, el) => {
      const tag = $(el).text().trim();
      if (tag) tags.push(tag);
    });

    // Description (Main & Short)
    // Removed <noscript> logic inside getHtml since helpers/cleanDescriptionHtml now does it if used, 
    // but we can just do raw HTML and processProduct handles text node scrubbing.
    let descriptionHtml = $('#tab-description').html() || '';
    if (!descriptionHtml) {
        descriptionHtml = $('.woocommerce-product-details__short-description').html() || '';
    }
    const shortDescriptionHtml = $('.woocommerce-product-details__short-description').html() || '';

    // Clean out <noscript> tags right away to prevent junk duplicates in description
    if (descriptionHtml) {
      const $desc = cheerio.load(descriptionHtml, null, false);
      $desc('noscript').remove();
      descriptionHtml = $desc.html();
    }

    // Images
    const images = [];
    $('.woocommerce-product-gallery__image a, .product-images a').each((i, el) => {
      const href = $(el).attr('href');
      // Look for standard image formats
      if (href && (href.endsWith('.jpg') || href.endsWith('.jpeg') || href.endsWith('.png') || href.endsWith('.webp')) && !images.includes(href)) {
        images.push(href);
      }
    });

    // SEO Meta
    const metaTitle = $('meta[property="og:title"]').attr('content') || title;
    const metaDescription = $('meta[property="og:description"]').attr('content') || '';

    // Build initial payload
    const productData = {
      source_site: 'rootGear',
      source_url: url,
      title,
      slug: url.split('/').filter(Boolean).pop(),
      description: descriptionHtml.trim(),
      short_description: shortDescriptionHtml.trim(),
      regular_price: regularPrice,
      sale_price: regularPrice,
      stock_status: stockStatus,
      categories,
      tags,
      images,
      meta_title: metaTitle,
      meta_description: metaDescription,
    };

    // Run through the global name replacer/scrubber
    const processedProduct = processProduct(productData);
    
    log.info(`Scraped rootGear product: ${processedProduct.title}`);
    return processedProduct;
  } catch (error) {
    log.error(`Failed to scrape rootGear product: ${url}`, { error: error.message });
    throw error;
  }
}
