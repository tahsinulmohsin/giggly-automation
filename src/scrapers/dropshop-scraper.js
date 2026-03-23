import * as cheerio from 'cheerio';
import { createModuleLogger } from '../utils/logger.js';
import { fetchWithRetry, parsePrice, slugify } from '../utils/helpers.js';
import config from '../config.js';
import { getDropShopAuthCookie } from '../utils/dropshop-auth.js';

const log = createModuleLogger('dropshop-scraper');
const PRICE_MARKUP = config.sources.dropShop.priceMarkup; // +100 BDT

/**
 * Scrape a single product page from dropshop.com.bd
 * @param {string} url
 * @returns {Promise<object|null>}
 */
export async function scrapeDropShopProduct(url) {
  try {
    log.info(`Scraping: ${url}`);
    
    const cookie = await getDropShopAuthCookie();
    const headers = cookie ? { 'Cookie': cookie } : {};
    
    // fetchWithRetry doesn't natively support headers array directly, we need to ensure it's passed through
    // but looking at helpers.js implementation, we can just pass the whole request config
    const html = await fetchWithRetry(url, { headers });
    const $ = cheerio.load(html);

    // Title
    const title = $('h1.product_title, h1.entry-title').first().text().trim()
      || $('h1').first().text().trim();

    if (!title) {
      log.warn(`No title found for ${url}`);
      return null;
    }

    let regularPrice = null;
    let salePrice = null;
    let suggestedPrice = null;

    // DropShop shows "Suggested Price" in .cog-price
    $('.cog-price').each((_, el) => {
      const text = $(el).text();
      // Look for Bengali keyword "সাজেসটেড" or English "suggested"
      if (text.includes('সাজেসটেড') || text.includes('suggested')) {
        const priceText = $(el).find('.woocommerce-Price-amount bdi').text() || text;
        const match = priceText.match(/[\d,]+(?:\.\d+)?/);
        if (match) {
          suggestedPrice = parseFloat(match[0].replace(/,/g, ''));
        }
      }
    });

    // Fallback: DropShop also shows pricing in a table or custom fields sometimes
    if (!suggestedPrice) {
      $('tr, .price-row, .product-price-row').each((_, row) => {
        const text = $(row).text().toLowerCase();
        if (text.includes('suggested') || text.includes('retail') || text.includes('reseller')) {
          const priceMatch = $(row).text().match(/[\d,]+(?:\.\d+)?/);
          if (priceMatch) {
            suggestedPrice = parseFloat(priceMatch[0].replace(/,/g, ''));
          }
        }
      });
    }

    // Standard WooCommerce price extraction
    const priceContainer = $('p.price, .summary .price, .product-page-price').first();
    const delPrice = priceContainer.find('del .woocommerce-Price-amount, del .amount').first().text();
    const insPrice = priceContainer.find('ins .woocommerce-Price-amount, ins .amount').first().text();

    if (delPrice && insPrice) {
      regularPrice = parsePrice(delPrice);
      salePrice = parsePrice(insPrice);
    } else {
      const singlePrice = priceContainer.find('.woocommerce-Price-amount, .amount').first().text();
      regularPrice = parsePrice(singlePrice);
    }

    // Use suggested price if found, otherwise use the WooCommerce sale/regular price
    const basePrice = suggestedPrice || salePrice || regularPrice;
    const finalPrice = basePrice ? basePrice + PRICE_MARKUP : null;

    // Images
    const images = [];
    $('div.woocommerce-product-gallery__image img, .product-images img, .woocommerce-product-gallery img').each((_, el) => {
      const src = $(el).attr('data-large_image') || $(el).attr('data-src') || $(el).attr('src');
      if (src && !src.includes('placeholder') && !images.includes(src)) {
        const fullSrc = src.replace(/-\d+x\d+\./, '.');
        images.push(fullSrc);
      }
    });
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && !images.includes(ogImage)) {
      images.unshift(ogImage);
    }

    // Categories
    const categories = [];
    $('.posted_in a, .product_meta .posted_in a, nav.woocommerce-breadcrumb a').each((_, el) => {
      const cat = $(el).text().trim();
      if (cat && cat !== 'Home' && !categories.includes(cat)) {
        categories.push(cat);
      }
    });

    // Description
    const descriptionHtml = $('#tab-description, .woocommerce-Tabs-panel--description, .product-description').first().html() || '';

    // Short description
    const shortDescription = $('.woocommerce-product-details__short-description').first().html() || '';

    // Stock status
    const stockEl = $('.stock, .in-stock, .out-of-stock').first();
    let stockStatus = 'instock';
    if (stockEl.hasClass('out-of-stock') || stockEl.text().toLowerCase().includes('out of stock')) {
      stockStatus = 'outofstock';
    }

    // Variations
    const variations = [];
    $('table.variations select option, .variations_form select option').each((_, el) => {
      const val = $(el).val();
      const text = $(el).text().trim();
      if (val && text && val !== '') {
        variations.push({ value: val, label: text });
      }
    });

    // Tags
    const tags = [];
    $('.tagged_as a').each((_, el) => {
      const tag = $(el).text().trim();
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    });

    // SEO Meta
    const meta_title = $('meta[property="og:title"]').attr('content') || $('title').text() || title;
    const meta_description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || shortDescription || '';

    const product = {
      source_url: url,
      source_site: 'dropShop',
      title,
      slug: slugify(title),
      regular_price: regularPrice ? regularPrice + PRICE_MARKUP : null,
      sale_price: salePrice ? salePrice + PRICE_MARKUP : null,
      final_price: finalPrice,
      description: descriptionHtml,
      short_description: shortDescription,
      categories,
      images,
      variations,
      stock_status: stockStatus,
      tags,
      meta_title,
      meta_description,
    };

    log.info(`Scraped: ${title}`, { basePrice, finalPrice, markup: PRICE_MARKUP, images: images.length });
    return product;
  } catch (error) {
    log.error(`Failed to scrape ${url}`, { error: error.message });
    return null;
  }
}
