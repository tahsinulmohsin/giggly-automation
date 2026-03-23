/**
 * Simple rate limiter that enforces a minimum delay between requests.
 */
export class RateLimiter {
  constructor(delayMs = 2000) {
    this.delayMs = delayMs;
    this.lastRequestTime = 0;
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.delayMs) {
      const waitTime = this.delayMs - elapsed;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();
  }
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
