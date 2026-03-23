import axios from 'axios';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { createModuleLogger } from '../utils/logger.js';
import config from '../config.js';

const log = createModuleLogger('image-downloader');

// Ensure downloads directory exists
fs.mkdirSync(config.paths.downloads, { recursive: true });

/**
 * Download a single image and return the local file path.
 * @param {string} imageUrl
 * @param {string} productSlug
 * @param {number} index
 * @returns {Promise<string|null>} Local file path or null on failure
 */
async function downloadImage(imageUrl, productSlug, index) {
  try {
    const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    const fileName = `${productSlug}-${index}${ext}`;
    const filePath = path.join(config.paths.downloads, fileName);

    // Skip if already downloaded
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': config.scraping.userAgent,
        'Referer': new URL(imageUrl).origin,
      },
    });

    fs.writeFileSync(filePath, response.data);
    log.debug(`Downloaded: ${fileName}`);
    return filePath;
  } catch (error) {
    log.error(`Failed to download image: ${imageUrl}`, { error: error.message });
    return null;
  }
}

/**
 * Download all images for a product.
 * @param {string[]} imageUrls
 * @param {string} productSlug
 * @returns {Promise<string[]>} Array of local file paths
 */
export async function downloadProductImages(imageUrls, productSlug) {
  const limit = pLimit(config.scraping.maxImageConcurrency);
  const downloads = imageUrls.map((url, i) =>
    limit(() => downloadImage(url, productSlug, i))
  );
  const results = await Promise.all(downloads);
  return results.filter(Boolean);
}
