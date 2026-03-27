import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createModuleLogger } from '../utils/logger.js';
import { sleep } from '../utils/rate-limiter.js';

const log = createModuleLogger('woo-uploader');

// Initialize WooCommerce API client lazily so dry runs work without keys
let api = null;

function getApi() {
  if (!api) {
    if (!config.wc.consumerKey || !config.wc.consumerSecret) {
      throw new Error('WooCommerce API credentials (WC_CONSUMER_KEY, WC_CONSUMER_SECRET) are missing.');
    }
    api = new WooCommerceRestApi.default({
      url: config.wc.url,
      consumerKey: config.wc.consumerKey,
      consumerSecret: config.wc.consumerSecret,
      version: 'wc/v3',
      queryStringAuth: true, // Force query string auth for HTTPS
    });
  }
  return api;
}

/**
 * Upload a single image to WordPress media library via REST API.
 * @param {string} localPath - Local path to the image file
 * @param {string} altText - Alt text for the image
 * @returns {Promise<{id: number, src: string}|null>}
 */
async function uploadImageToMedia(localPath, altText = '') {
  try {
    const fileName = path.basename(localPath);
    const fileBuffer = fs.readFileSync(localPath);

    // WordPress REST API media upload
    const response = await axios.post(
      `${config.wc.url}/wp-json/wp/v2/media`,
      fileBuffer,
      {
        headers: {
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Type': getMimeType(localPath),
        },
        auth: {
          username: config.wc.consumerKey,
          password: config.wc.consumerSecret,
        },
        maxContentLength: 50 * 1024 * 1024,
        timeout: 60000,
      }
    );

    log.debug(`Uploaded image: ${fileName}`, { id: response.data.id });
    return {
      id: response.data.id,
      src: response.data.source_url,
    };
  } catch (error) {
    log.error(`Failed to upload image: ${localPath}`, { error: error.message });
    return null;
  }
}

/**
 * Get MIME type from file extension.
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  };
  return types[ext] || 'image/jpeg';
}

/**
 * Find or create a product category by name.
 * @param {string} categoryName
 * @returns {Promise<number|null>} Category ID
 */
async function findOrCreateCategory(categoryName) {
  try {
    // Search for existing category
    const { data: existing } = await getApi().get('products/categories', {
      search: categoryName,
      per_page: 10,
    });

    const match = existing.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (match) return match.id;

    // Create new category
    const { data: created } = await getApi().post('products/categories', {
      name: categoryName,
    });

    log.info(`Created category: ${categoryName}`, { id: created.id });
    return created.id;
  } catch (error) {
    log.error(`Failed to handle category: ${categoryName}`, { error: error.message });
    return null;
  }
}

/**
 * Find or create a product tag by name.
 * @param {string} tagName
 * @returns {Promise<number|null>} Tag ID
 */
async function findOrCreateTag(tagName) {
  try {
    const { data: existing } = await getApi().get('products/tags', {
      search: tagName,
      per_page: 10,
    });

    const match = existing.find(t => t.name.toLowerCase() === tagName.toLowerCase());
    if (match) return match.id;

    const { data: created } = await getApi().post('products/tags', {
      name: tagName,
    });

    log.debug(`Created tag: ${tagName}`, { id: created.id });
    return created.id;
  } catch (error) {
    log.error(`Failed to handle tag: ${tagName}`, { error: error.message });
    return null;
  }
}

import * as cheerio from 'cheerio';

/**
 * Offlines all external images embedded in the description HTML by uploading them 
 * to the WooCommerce media library via a temporary dummy product.
 * @param {string} html 
 * @param {string} slug 
 * @returns {Promise<string>} Updated HTML with local giggly.shop image URLs
 */
async function sideloadDescriptionImages(html, slug) {
  if (!html) return html;
  const $ = cheerio.load(html, null, false);
  const externalImages = [];
  const gigglyHost = new URL(config.wc.url).hostname;
  
  $('img').each((i, el) => {
    let src = $(el).attr('src');
    if (!src) return;
    try {
      const srcUrl = new URL(src);
      if (srcUrl.hostname !== gigglyHost) {
         if (!externalImages.includes(src)) {
           externalImages.push(src);
         }
      }
    } catch(e) {}
  });

  if (externalImages.length === 0) {
    return html;
  }

  log.info(`Found ${externalImages.length} external inline description images. Sideloading via API proxy...`);
  
  try {
    const payload = {
      name: `SideloadProxy_${slug}`,
      type: 'simple',
      status: 'draft',
      images: externalImages.map(src => ({ src }))
    };
    
    // Create dummy product
    const { data: proxyProduct } = await getApi().post('products', payload);
    const downloadedImages = proxyProduct.images || [];
    
    // Immediately delete dummy product
    await getApi().delete(`products/${proxyProduct.id}`, { force: true });
    
    // Build map of Old URL -> New Local URL
    const urlMap = {};
    for (let i = 0; i < downloadedImages.length; i++) {
        // WooCommerce preserves the order of images
        if (externalImages[i]) {
            urlMap[externalImages[i]] = downloadedImages[i].src;
        }
    }

    // Rewrite HTML
    $('img').each((i, el) => {
      let src = $(el).attr('src');
      if (src && urlMap[src]) {
        $(el).attr('src', urlMap[src]);
        
        // Clear conflicting responsive srcset attributes from the source
        $(el).removeAttr('srcset');
        $(el).removeAttr('sizes');
      }
    });

    log.info(`Successfully sideloaded inline description images for ${slug}`);
    return $.html();

  } catch(error) {
    log.error(`Failed to sideload description images: ${slug}`, { error: error.message });
    return html; // Fallback to original hotlinked HTML on failure
  }
}

/**
 * Upload a processed product to giggly.shop via WooCommerce REST API.
 * @param {object} product - Processed product data
 * @param {string[]} localImagePaths - Downloaded image file paths
 * @returns {Promise<number|null>} WooCommerce product ID
 */
export async function uploadProduct(product, localImagePaths = []) {
  try {
    log.info(`Uploading product: ${product.title}`);

    // Step 0: Smart Merge - Check for existing duplicate by slug
    const existingProduct = await findProductBySlug(product.slug);
    
    // Calculate new regular and sale prices formatting correctly
    let reqRegularPrice = '';
    let reqSalePrice = '';
    if (product.final_price && !product.regular_price) {
      reqRegularPrice = String(product.final_price);
    } else if (product.final_price && product.regular_price && !product.sale_price) {
      reqRegularPrice = String(product.final_price);
    } else if (product.regular_price && product.sale_price && product.regular_price > product.sale_price) {
      reqRegularPrice = String(product.regular_price);
      reqSalePrice = String(product.sale_price);
    } else if (product.final_price) {
      reqRegularPrice = String(product.final_price);
    }

    if (existingProduct) {
      const existingPrice = parseFloat(existingProduct.price || 0);
      const newPrice = parseFloat(reqSalePrice || reqRegularPrice || product.final_price || 0);

      log.info(`Duplicate found [${product.slug}]. Current Price: ৳${existingPrice} | New Scraped Price: ৳${newPrice}`);

      if (newPrice > 0 && (newPrice < existingPrice || existingPrice === 0)) {
        log.info(`🏆 Smart Merge: New price (৳${newPrice}) is cheaper! Overwriting existing product #${existingProduct.id}...`);
        
        const updatePayload = {
          regular_price: reqRegularPrice,
          sale_price: reqSalePrice,
          stock_status: product.stock_status || 'instock'
        };
        
        await getApi().put(`products/${existingProduct.id}`, updatePayload);
        log.info(`✓ Successfully updated existing product #${existingProduct.id} with cheaper price!`);
        return existingProduct.id;
      } else {
        log.info(`🛑 Smart Merge: Existing product is cheaper or equal (৳${existingPrice}). Discarding new scrape.`);
        return existingProduct.id; // Return ID so SQLite marks it 'uploaded' and ignores it
      }
    }

    // Prepare images — use source URLs directly (WooCommerce downloads them)
    const images = [];
    const productImages = typeof product.images === 'string'
      ? JSON.parse(product.images)
      : product.images || [];

    for (const imgUrl of productImages) {
      if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
        images.push({
          src: imgUrl,
          alt: product.title,
        });
      }
    }

    // Prepare categories
    const categoryIds = [];
    const productCategories = typeof product.categories === 'string'
      ? JSON.parse(product.categories)
      : product.categories || [];

    for (const catName of productCategories) {
      const catId = await findOrCreateCategory(catName);
      if (catId) categoryIds.push({ id: catId });
      await sleep(500); // Rate limit category API calls
    }

    // Prepare tags
    const tagIds = [];
    const productTags = typeof product.tags === 'string'
      ? JSON.parse(product.tags)
      : product.tags || [];

    for (const tagName of productTags) {
      const tagId = await findOrCreateTag(tagName);
      if (tagId) tagIds.push({ id: tagId });
      await sleep(300); // Rate limit tag API calls
    }

    // Prepare SEO metadata
    const metaData = [];
    if (product.meta_description) {
      metaData.push({ key: '_yoast_wpseo_metadesc', value: product.meta_description });
      metaData.push({ key: 'rank_math_description', value: product.meta_description });
    }
    if (product.meta_title) {
      metaData.push({ key: '_yoast_wpseo_title', value: product.meta_title });
      metaData.push({ key: 'rank_math_title', value: product.meta_title });
    }

    // Sideload any external images located in the HTML description
    const sanitizedDescription = await sideloadDescriptionImages(product.description || '', product.slug);

    // Build product payload
    const payload = {
      name: product.title,
      slug: product.slug,
      type: 'simple',
      status: 'publish',
      description: sanitizedDescription,

      short_description: product.short_description || '',
      regular_price: product.regular_price ? String(product.regular_price) : '',
      sale_price: product.sale_price ? String(product.sale_price) : '',
      categories: categoryIds,
      tags: tagIds,
      images: images,
      manage_stock: false,
      stock_status: product.stock_status || 'instock',
      meta_data: metaData,
    };

    if (reqRegularPrice) payload.regular_price = reqRegularPrice;
    if (reqSalePrice) payload.sale_price = reqSalePrice;

    const { data: wcProduct } = await getApi().post('products', payload);

    log.info(`Product uploaded successfully`, {
      id: wcProduct.id,
      title: wcProduct.name,
      price: wcProduct.price,
      url: wcProduct.permalink,
    });

    return wcProduct.id;
  } catch (error) {
    log.error(`Failed to upload product: ${product.title}`, {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data?.message,
    });
    return null;
  }
}

/**
 * Update the stock status of an existing product on giggly.shop.
 * @param {number} wcProductId
 * @param {string} stockStatus - 'instock' or 'outofstock'
 */
export async function updateProductStock(wcProductId, stockStatus) {
  try {
    await getApi().put(`products/${wcProductId}`, {
      stock_status: stockStatus,
    });
    log.info(`Updated stock for product #${wcProductId}: ${stockStatus}`);
  } catch (error) {
    log.error(`Failed to update stock for product #${wcProductId}`, {
      error: error.message,
    });
  }
}

/**
 * Check if a product already exists on giggly.shop by slug.
 * @param {string} slug
 * @returns {Promise<number|null>} Product ID if exists
 */
export async function findProductBySlug(slug) {
  try {
    const { data } = await getApi().get('products', { slug, per_page: 1 });
    return data.length > 0 ? data[0] : null;
  } catch (error) {
    log.error(`Failed to search for product slug: ${slug}`, { error: error.message });
    return null;
  }
}
