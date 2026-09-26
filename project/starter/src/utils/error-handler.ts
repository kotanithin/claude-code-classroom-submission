/**
 * Custom error class for review operations.
 */
export class ReviewError extends Error {
  constructor(
    message: string,
    public code: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);

    this.name = 'ReviewError';

    Error.captureStackTrace?.(this, ReviewError);
  }
}

/**
 * Error codes for the review system.
 */
export const ErrorCodes = {
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_GITHUB_TOKEN: 'MISSING_GITHUB_TOKEN',
  INVALID_CONFIG: 'INVALID_CONFIG',

  PR_NOT_FOUND: 'PR_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_FAILED: 'AGENT_FAILED',
  STRUCTURED_OUTPUT_FAILED: 'STRUCTURED_OUTPUT_FAILED',

  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode =
  typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry an asynchronous operation using exponential backoff
 * and jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  if (maxRetries < 1) {
    throw new ReviewError(
      'maxRetries must be at least 1',
      ErrorCodes.INVALID_CONFIG,
      { maxRetries }
    );
  }

  if (delayMs < 0) {
    throw new ReviewError(
      'delayMs cannot be negative',
      ErrorCodes.INVALID_CONFIG,
      { delayMs }
    );
  }

  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= maxRetries;
    attempt++
  ) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        break;
      }

      const exponentialDelay =
        delayMs * Math.pow(2, attempt - 1);

      const jitter = Math.floor(Math.random() * 100);

      await sleep(exponentialDelay + jitter);
    }
  }

  throw new ReviewError(
    `Operation failed after ${maxRetries} attempts`,
    ErrorCodes.RETRY_EXHAUSTED,
    {
      maxRetries,
      lastError:
        lastError instanceof Error
          ? lastError.message
          : String(lastError)
    }
  );
}

/**
 * Execute an asynchronous operation with a timeout.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new ReviewError(
      'timeoutMs must be greater than zero',
      ErrorCodes.INVALID_CONFIG,
      { timeoutMs }
    );
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>(
      (_, reject) => {
        timer = setTimeout(() => {
          reject(
            new ReviewError(
              errorMessage,
              ErrorCodes.AGENT_TIMEOUT,
              {
                timeoutMs
              }
            )
          );
        }, timeoutMs);
      }
    );

    return await Promise.race([
      fn(),
      timeoutPromise
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Check whether an unknown value is a ReviewError.
 */
export function isReviewError(
  error: unknown
): error is ReviewError {
  return error instanceof ReviewError;
}

/**
 * Format an error for logs and console output.
 */
export function formatError(error: unknown): string {
  if (isReviewError(error)) {
    return `[${error.code}] ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}