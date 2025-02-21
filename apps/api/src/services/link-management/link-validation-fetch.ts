import { Logger } from "winston";
import { TimeoutSignal } from "../../controllers/v1/types";
import { robustFetch } from "../../scraper/scrapeURL/lib/fetch";

export interface LinkValidationResponse {
  status: number;
  headers: Headers;
  body?: string;
}

export interface LinkValidationFetchParams {
  url: string;
  logger: Logger;
  tryCount?: number;
  tryCooldown?: number;
  timeout?: number;
  maxContentLength?: number;
}

/**
 * Normalize URL by ensuring it has a protocol and handling special cases
 */
function normalizeUrl(url: string): string | null {
  // Skip special schemes
  if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:')) {
    return null;
  }

  // Add protocol if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'https://' + url;
  }

  return url;
}

/**
 * Truncate content to avoid token limit issues
 * Aims to keep content under ~6000 tokens (conservative estimate for OpenAI's 8192 limit)
 * Rough estimate: 1 token ≈ 4 characters for English text
 */
function truncateContent(content: string, maxLength: number = 20000, logger?: Logger): string {
  if (!content || content.length <= maxLength) return content;
  
  // Keep first 60% and last 30% of the allowed length
  const firstPart = Math.floor(maxLength * 0.6);
  const lastPart = Math.floor(maxLength * 0.3);
  
  const truncated = content.slice(0, firstPart) + 
         '\n[...content truncated for token limit compliance...]\n' +
         content.slice(-lastPart);

  // Add debug logging for content length if logger provided
  if (logger) {
    logger.debug('Content truncation applied', {
      originalLength: content.length,
      truncatedLength: truncated.length,
      truncationRatio: (truncated.length / content.length).toFixed(2)
    });
  }
         
  return truncated;
}

/**
 * Specialized fetch function for link validation that properly handles HTTP status codes
 * and doesn't retry on 4xx responses
 */
export async function validateLinkFetch({
  url,
  logger,
  tryCount = 1,
  tryCooldown = 1000,
  timeout = 30000,
  maxContentLength = 20000,
}: LinkValidationFetchParams): Promise<LinkValidationResponse | null> {
  // Add debug logging
  logger.debug("Starting link validation request", {
    originalUrl: url,
    tryCount,
    tryCooldown,
    timeout,
    maxContentLength
  });

  // Handle special URLs
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    logger.debug("Skipping special scheme URL", { url });
    return {
      status: 204, // No Content
      headers: new Headers(),
      body: "Special scheme URL"
    };
  }

  logger.debug("Normalized URL for validation", {
    originalUrl: url,
    normalizedUrl
  });

  try {
    // Use native fetch for link validation since we don't need JSON parsing
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(normalizedUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,*/*',
        'User-Agent': 'FireCrawl-LinkValidator/1.0'
      },
      signal: controller.signal,
      redirect: 'manual' // Handle redirects manually
    });

    clearTimeout(timeoutId);

    // Get response body
    const body = await response.text();
    
    // Truncate body if needed
    const truncatedBody = truncateContent(body, maxContentLength, logger);
    
    // Log truncation if it occurred
    if (body.length !== truncatedBody.length) {
      logger.debug('Content truncated for token limit', {
        originalLength: body.length,
        truncatedLength: truncatedBody.length,
        url: normalizedUrl
      });
    }

    // Return response info
    return {
      status: response.status,
      headers: response.headers,
      body: truncatedBody
    };

  } catch (error) {
    // Handle URL parsing errors
    if (error.name === "TypeError" && error.cause?.code === "ERR_INVALID_URL") {
      logger.debug("Invalid URL format", { url, normalizedUrl, error });
      return {
        status: 400, // Bad Request
        headers: new Headers(),
        body: "Invalid URL format"
      };
    }

    // Handle network errors
    if (error instanceof TimeoutSignal || error.name === "AbortError") {
      logger.debug("Request timed out", { url: normalizedUrl, error });
      return {
        status: 408, // Request Timeout
        headers: new Headers()
      };
    }

    // Map common errors to appropriate status codes
    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
      logger.debug("Connection error", { 
        url: normalizedUrl, 
        errorCode: error.code,
        error: error.message 
      });
      return {
        status: error.code === "ENOTFOUND" ? 404 : 503, // Not Found or Service Unavailable
        headers: new Headers(),
        body: error.message
      };
    }

    if (error.code === "CERT_HAS_EXPIRED") {
      logger.debug("SSL certificate error", {
        url: normalizedUrl,
        error: error.message
      });
      return {
        status: 525, // SSL Handshake Failed
        headers: new Headers(),
        body: "SSL certificate has expired"
      };
    }

    // Handle fetch failures
    if (error.message === "fetch failed" && error.cause) {
      logger.debug("Fetch operation failed", {
        url: normalizedUrl,
        cause: error.cause,
        error: error.message
      });
      return {
        status: 503, // Service Unavailable
        headers: new Headers(),
        body: error.cause.message || error.message
      };
    }

    // Log unexpected errors
    logger.error("Unexpected error during link validation", {
      url: normalizedUrl,
      error: error.message,
      stack: error.stack
    });

    return {
      status: 500, // Internal Server Error
      headers: new Headers(),
      body: error.message
    };
  }
} 