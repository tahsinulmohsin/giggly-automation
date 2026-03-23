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

/**
 * Upload a processed product to giggly.shop via WooCommerce REST API.
 * @param {object} product - Processed product data
 * @param {string[]} localImagePaths - Downloaded image file paths
 * @returns {Promise<number|null>} WooCommerce product ID
 */
export async function uploadProduct(product, localImagePaths = []) {
  try {
    log.info(`Uploading product: ${product.title}`);

    // Prepare images — use source URLs directly (WooCommerce downloads them)
    const images = [];
    const productImages = typeof product.images === 'string'
      ? JSON.parse(product.images)
      : product.images || [];

    for (const imgUrl of productImages) {
      images.push({
        src: imgUrl,
        alt: product.title,
      });
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

    // Build product payload
    const payload = {
      name: product.title,
      slug: product.slug,
      type: 'simple',
      status: 'publish',
      description: product.description || '',
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

    // If there's only a final price (no original/sale distinction), just use regular_price
    if (product.final_price && !product.regular_price) {
      payload.regular_price = String(product.final_price);
    }
    if (product.final_price && product.regular_price && !product.sale_price) {
      payload.regular_price = String(product.final_price);
    }

    // For products with a sale: regular = higher price, sale = lower price
    if (product.regular_price && product.sale_price && product.regular_price > product.sale_price) {
      payload.regular_price = String(product.regular_price);
      payload.sale_price = String(product.sale_price);
    } else if (product.final_price) {
      payload.regular_price = String(product.final_price);
      payload.sale_price = '';
    }

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
    return data.length > 0 ? data[0].id : null;
  } catch (error) {
    log.error(`Failed to search for product slug: ${slug}`, { error: error.message });
    return null;
  }
}
