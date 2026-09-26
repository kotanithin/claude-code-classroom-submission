/**
 * Rate Limiter for API requests and token usage
 * Prevents exceeding Anthropic API rate limits.
 *
 * Uses a sliding 60-second window plus a concurrent-request limit.
 */

export interface RateLimiterConfig {
  /** Maximum requests per minute */
  maxRequestsPerMinute: number;

  /** Maximum tokens per minute */
  maxTokensPerMinute: number;

  /** Maximum concurrent requests */
  maxConcurrent: number;
}

export const DEFAULT_RATE_LIMITS: RateLimiterConfig = {
  maxRequestsPerMinute: 50,
  maxTokensPerMinute: 100000,
  maxConcurrent: 5
};

interface RequestRecord {
  timestamp: number;
  tokens: number;
}

/**
 * Sliding-window rate limiter.
 */
export class RateLimiter {
  private config: RateLimiterConfig;
  private requestHistory: RequestRecord[] = [];
  private activeRequests = 0;
  private waitQueue: Array<() => void> = [];

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      ...DEFAULT_RATE_LIMITS,
      ...config
    };
  }

  /**
   * Wait until a request can be made.
   */
  async acquire(estimatedTokens: number = 1000): Promise<void> {
    if (estimatedTokens < 0) {
      throw new Error('estimatedTokens cannot be negative');
    }

    await this.waitForSlot();
    await this.waitForRateLimit(estimatedTokens);

    this.activeRequests++;

    this.requestHistory.push({
      timestamp: Date.now(),
      tokens: estimatedTokens
    });
  }

  /**
   * Release a request slot after completion.
   *
   * @param actualTokens Actual token usage, if known.
   */
  release(actualTokens?: number): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);

    if (
      actualTokens !== undefined &&
      actualTokens >= 0 &&
      this.requestHistory.length > 0
    ) {
      const lastRequest =
        this.requestHistory[this.requestHistory.length - 1];

      if (lastRequest) {
        lastRequest.tokens = actualTokens;
      }
    }

    const next = this.waitQueue.shift();

    if (next) {
      next();
    }
  }

  /**
   * Get current rate-limit status.
   */
  getStatus(): {
    activeRequests: number;
    requestsInWindow: number;
    tokensInWindow: number;
    availableRequests: number;
    availableTokens: number;
  } {
    this.pruneOldRecords();

    const requestsInWindow = this.requestHistory.length;

    const tokensInWindow = this.requestHistory.reduce(
      (sum, record) => sum + record.tokens,
      0
    );

    return {
      activeRequests: this.activeRequests,
      requestsInWindow,
      tokensInWindow,
      availableRequests: Math.max(
        0,
        this.config.maxRequestsPerMinute - requestsInWindow
      ),
      availableTokens: Math.max(
        0,
        this.config.maxTokensPerMinute - tokensInWindow
      )
    };
  }

  /**
   * Check whether a request can proceed immediately.
   */
  canProceed(estimatedTokens: number = 1000): boolean {
    if (estimatedTokens < 0) {
      return false;
    }

    this.pruneOldRecords();

    const requestsInWindow = this.requestHistory.length;

    const tokensInWindow = this.requestHistory.reduce(
      (sum, record) => sum + record.tokens,
      0
    );

    return (
      this.activeRequests < this.config.maxConcurrent &&
      requestsInWindow < this.config.maxRequestsPerMinute &&
      tokensInWindow + estimatedTokens <=
        this.config.maxTokensPerMinute
    );
  }

  /**
   * Wait for a concurrent request slot.
   */
  private async waitForSlot(): Promise<void> {
    if (this.activeRequests < this.config.maxConcurrent) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Wait until the sliding-window rate limits permit the request.
   */
  private async waitForRateLimit(
    estimatedTokens: number
  ): Promise<void> {
    while (!this.canProceed(estimatedTokens)) {
      this.pruneOldRecords();

      if (this.requestHistory.length === 0) {
        break;
      }

      const oldestRequest = this.requestHistory[0];

      if (!oldestRequest) {
        break;
      }

      const expirationTime =
        oldestRequest.timestamp + 60_000;

      const now = Date.now();

      const calculatedWait =
        expirationTime - now + 100;

      const waitTime = Math.min(
        5_000,
        Math.max(100, calculatedWait)
      );

      await new Promise<void>((resolve) => {
        setTimeout(resolve, waitTime);
      });
    }
  }

  /**
   * Remove requests older than 60 seconds.
   */
  private pruneOldRecords(): void {
    const cutoff = Date.now() - 60_000;

    this.requestHistory = this.requestHistory.filter(
      (record) => record.timestamp > cutoff
    );
  }
}

/**
 * Wrap an async operation with rate limiting.
 */
export async function withRateLimit<T>(
  rateLimiter: RateLimiter,
  fn: () => Promise<T>,
  estimatedTokens: number = 1000
): Promise<T> {
  await rateLimiter.acquire(estimatedTokens);

  try {
    return await fn();
  } finally {
    rateLimiter.release();
  }
}

/**
 * Global rate limiter instance.
 */
export const globalRateLimiter = new RateLimiter();