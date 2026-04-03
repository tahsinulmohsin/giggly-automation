import * as cheerio from 'cheerio';
import { createModuleLogger } from '../utils/logger.js';
import { fetchWithRetry, parsePrice, slugify, cleanDescriptionHtml } from '../utils/helpers.js';

const log = createModuleLogger('woocommerce-scraper');

/**
 * Generic scraper for standard WooCommerce product pages.
 * @param {string} url - The product URL to scrape
 * @param {string} sourceSite - The identifier for the source website
 * @returns {Promise<object|null>}
 */
export async function scrapeWooCommerceProduct(url, sourceSite) {
  try {
    log.info(`Scraping [${sourceSite}]: ${url}`);
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    // Title
    const title = $('h1.product_title, h1.entry-title').first().text().trim() 
      || $('h1').first().text().trim();

    if (!title) {
      log.warn(`No title found for ${url}`);
      return null;
    }

    // Pricing
    const priceContainer = $('p.price, .summary .price, .product-page-price').first();
    const delPrice = priceContainer.find('del').first().text().replace(/\s+/g, ' ');
    const insPrice = priceContainer.find('ins').first().text().replace(/\s+/g, ' ');

    let regularPrice = null;
    let salePrice = null;

    if (delPrice && insPrice) {
      regularPrice = parsePrice(delPrice);
      salePrice = parsePrice(insPrice);
    } else {
      const singlePrice = priceContainer.find('.woocommerce-Price-amount, .amount').first().text();
      regularPrice = parsePrice(singlePrice);
    }

    const finalPrice = salePrice || regularPrice;

    // Images
    const images = [];
    $('.woocommerce-product-gallery__image img, .product-images img, .woocommerce-product-gallery img').each((_, el) => {
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

    // Description (Handling standard WC and CommerceKit themes sequentially)
    let descriptionHtml = $('#tab-description').first().html();
    if (!descriptionHtml) descriptionHtml = $('.woocommerce-Tabs-panel--description').first().html();
    if (!descriptionHtml) descriptionHtml = $('.commercekit-Tabs-panel--description').first().html();
    if (!descriptionHtml) descriptionHtml = $('.product-description').first().html();
    descriptionHtml = descriptionHtml || '';
    descriptionHtml = cleanDescriptionHtml(descriptionHtml, url);

    // Short description
    const shortDescription = $('.woocommerce-product-details__short-description').first().html() || '';

    // Stock status
    const stockEl = $('.stock, .in-stock, .out-of-stock').first();
    let stockStatus = 'instock';
    if (stockEl.hasClass('out-of-stock') || stockEl.text().toLowerCase().includes('out of stock') || stockEl.text().toLowerCase().includes('sold out')) {
      stockStatus = 'outofstock';
    }

    // Variations (for variable products)
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
      source_site: sourceSite,
      title,
      slug: slugify(title),
      regular_price: regularPrice,
      sale_price: salePrice,
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

    log.info(`Scraped [${sourceSite}]: ${title}`, { price: finalPrice, images: images.length });
    return product;
  } catch (error) {
    log.error(`Failed to scrape ${url}`, { error: error.message });
    return null;
  }
}
