import config from '../config.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('name-replacer');

/**
 * Replace all source website names in text with "Giggly Gadgets".
 * Works on both plain text and HTML content.
 * @param {string} text
 * @returns {string}
 */
export function replaceSourceNames(text) {
  if (!text) return text;

  let result = text;
  for (const { pattern, replacement } of config.nameReplacements) {
    // Create a new RegExp each time to reset lastIndex for global patterns
    const regex = new RegExp(pattern.source, pattern.flags);
    result = result.replace(regex, replacement);
  }

  return result;
}

/**
 * Process a product object — replace source names in title, descriptions, etc.
 * @param {object} product
 * @returns {object}
 */
export function processProduct(product) {
  const processed = { ...product };

  processed.title = replaceSourceNames(processed.title);
  processed.description = replaceSourceNames(processed.description);
  processed.short_description = replaceSourceNames(processed.short_description);

  // Also clean up categories
  if (processed.categories) {
    processed.categories = processed.categories.map(cat => replaceSourceNames(cat));
  }

  // Clean up tags
  if (processed.tags) {
    processed.tags = processed.tags.map(tag => replaceSourceNames(tag));
  }

  // Clean up SEO fields
  processed.meta_title = replaceSourceNames(processed.meta_title);
  processed.meta_description = replaceSourceNames(processed.meta_description);

  log.debug(`Processed product: ${processed.title}`);
  return processed;
}
