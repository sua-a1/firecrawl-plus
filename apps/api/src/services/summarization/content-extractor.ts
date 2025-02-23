import { logger as defaultLogger } from "../../lib/logger";
import { transformHtml } from "../../lib/html-transformer";
import { load } from "cheerio";
import { parseMarkdown } from "../../lib/html-to-markdown";

// Tags to exclude for cleaner content extraction
const EXCLUDE_TAGS = [
  "header", "footer", "nav", "aside", ".header", ".footer",
  ".sidebar", ".nav", ".menu", ".social", ".share", ".ad",
  ".cookie-banner", ".popup", ".modal", "script", "style",
  "noscript", "iframe", "form", "button", ".comments"
];

// Tags to focus on for main content
const INCLUDE_TAGS = [
  "article", "main", ".content", ".post", ".article",
  ".entry-content", ".post-content", "#content", "#main"
];

// Special characters mapping for normalization
const SPECIAL_CHARS_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '\u2014': '-', // em dash
  '\u2013': '-', // en dash
  '\u2018': "'", // left single quote
  '\u2019': "'", // right single quote
  '\u201C': '"', // left double quote
  '\u201D': '"', // right double quote
  '\u2026': '...', // ellipsis
  '&#x27;': "'",
  '&#x2F;': '/',
  '&#39;': "'",
  '&#47;': '/'
};

export type ContentType = 'html' | 'markdown' | 'text';

export interface ContentExtractionOptions {
  removeBoilerplate?: boolean;  // Remove headers, footers, etc
  includeImages?: boolean;      // Keep image references in the text
  maxLength?: number;          // Maximum length of extracted content
  customIncludeTags?: string[]; // Additional tags to include
  customExcludeTags?: string[]; // Additional tags to exclude
  contentType?: ContentType;   // Type of content being processed
  convertToMarkdown?: boolean; // Convert final output to markdown
  preserveNewlines?: boolean;  // Keep meaningful line breaks
  normalizeWhitespace?: boolean; // Normalize all types of whitespace
  removeEmptyLines?: boolean;  // Remove lines that are just whitespace
}

export class ContentExtractor {
  private readonly logger: typeof defaultLogger;

  constructor(logger = defaultLogger.child({ module: 'ContentExtractor' })) {
    this.logger = logger;
  }

  /**
   * Extract main content from various content types
   */
  async extractContent(content: string, url: string, options: ContentExtractionOptions = {}): Promise<string> {
    // Default to HTML if content type not specified
    const contentType = options.contentType || 'html';
    
    this.logger.debug('Starting content extraction', { 
      contentType, 
      url,
      options: {
        ...options,
        convertToMarkdown: options.convertToMarkdown ?? false
      }
    });

    try {
      let extractedContent: string;

      switch (contentType) {
        case 'markdown':
          extractedContent = await this.extractFromMarkdown(content, options);
          break;
        case 'text':
          extractedContent = await this.extractFromText(content, options);
          break;
        case 'html':
        default:
          extractedContent = await this.extractFromHtml(content, url, options);
      }

      // Convert to markdown if requested
      if (options.convertToMarkdown && contentType === 'html') {
        this.logger.debug('Converting content to markdown');
        extractedContent = await parseMarkdown(extractedContent);
      }

      // Clean and normalize the extracted content
      return this.cleanExtractedContent(extractedContent, options);
    } catch (error) {
      this.logger.error('Error during content extraction', { error, contentType, url });
      throw error;
    }
  }

  /**
   * Extract content from HTML using Rust transformer with fallback to Cheerio
   */
  private async extractFromHtml(html: string, url: string, options: ContentExtractionOptions): Promise<string> {
    try {
      // Try Rust-based transformer first
      const extractedHtml = await transformHtml({
        html,
        url,
        include_tags: [...INCLUDE_TAGS, ...(options.customIncludeTags || [])],
        exclude_tags: [...EXCLUDE_TAGS, ...(options.customExcludeTags || [])],
        only_main_content: options.removeBoilerplate ?? true
      });

      return extractedHtml;
    } catch (error) {
      this.logger.error("Rust transformer failed, falling back to Cheerio", { error });
      return this.extractWithCheerio(html, options);
    }
  }

  /**
   * Extract content from Markdown
   */
  private async extractFromMarkdown(markdown: string, options: ContentExtractionOptions): Promise<string> {
    // For markdown, we don't need to do much processing since it's already clean
    // Just handle images if needed
    if (!options.includeImages) {
      markdown = markdown.replace(/!\[.*?\]\(.*?\)/g, ''); // Remove image references
    }
    return markdown;
  }

  /**
   * Extract content from plain text
   */
  private async extractFromText(text: string, options: ContentExtractionOptions): Promise<string> {
    // For plain text, we just need to handle basic cleaning
    return text;
  }

  /**
   * Fallback extraction using Cheerio
   */
  private async extractWithCheerio(html: string, options: ContentExtractionOptions): Promise<string> {
    const $ = load(html);

    // Remove unwanted elements
    EXCLUDE_TAGS.forEach(tag => $(tag).remove());
    if (!options.includeImages) {
      $('img').remove();
    }

    // Extract content from main content areas
    let content = '';
    INCLUDE_TAGS.forEach(tag => {
      const element = $(tag);
      if (element.length) {
        content += element.text() + '\n\n';
      }
    });

    // If no main content found, fall back to body
    if (!content.trim()) {
      content = $('body').text();
    }

    return content;
  }

  /**
   * Clean and normalize extracted content
   */
  private cleanExtractedContent(content: string, options: ContentExtractionOptions): string {
    this.logger.debug('Starting content cleaning', {
      contentLength: content.length,
      options: {
        preserveNewlines: options.preserveNewlines,
        normalizeWhitespace: options.normalizeWhitespace,
        removeEmptyLines: options.removeEmptyLines
      }
    });

    let cleaned = content;

    // Step 1: Normalize special characters and entities
    cleaned = this.normalizeSpecialCharacters(cleaned);

    // Step 2: Handle whitespace and line breaks
    cleaned = this.normalizeWhitespace(cleaned, {
      preserveNewlines: options.preserveNewlines ?? true,
      removeEmptyLines: options.removeEmptyLines ?? true
    });

    // Step 3: Remove any remaining HTML entities
    cleaned = this.removeRemainingHtmlEntities(cleaned);

    // Step 4: Normalize Unicode whitespace characters
    cleaned = this.normalizeUnicodeWhitespace(cleaned);

    // Step 5: Apply length limit if specified
    if (options.maxLength && cleaned.length > options.maxLength) {
      cleaned = this.truncateToLength(cleaned, options.maxLength);
    }

    this.logger.debug('Content cleaning completed', {
      originalLength: content.length,
      cleanedLength: cleaned.length
    });

    return cleaned;
  }

  /**
   * Normalize special characters and HTML entities
   */
  private normalizeSpecialCharacters(text: string): string {
    let normalized = text;
    
    // Replace known special characters
    for (const [char, replacement] of Object.entries(SPECIAL_CHARS_MAP)) {
      normalized = normalized.replace(new RegExp(char, 'g'), replacement);
    }

    return normalized;
  }

  /**
   * Normalize whitespace and handle line breaks
   */
  private normalizeWhitespace(text: string, options: { preserveNewlines: boolean, removeEmptyLines: boolean }): string {
    let normalized = text;

    if (options.preserveNewlines) {
      // Preserve intentional line breaks while removing excessive ones
      normalized = normalized
        .replace(/\r\n/g, '\n')  // Normalize line endings
        .replace(/\r/g, '\n')    // Convert remaining \r to \n
        .replace(/\n\s*\n\s*\n+/g, '\n\n')  // Max 2 consecutive line breaks
        .replace(/[ \t]+/g, ' '); // Normalize horizontal whitespace
    } else {
      // Convert all whitespace to single spaces
      normalized = normalized.replace(/\s+/g, ' ');
    }

    if (options.removeEmptyLines) {
      // Remove lines that are just whitespace
      normalized = normalized
        .split('\n')
        .filter(line => line.trim().length > 0)
        .join('\n');
    }

    return normalized.trim();
  }

  /**
   * Remove any remaining HTML entities
   */
  private removeRemainingHtmlEntities(text: string): string {
    return text
      // Remove numeric HTML entities
      .replace(/&#?[0-9a-zA-Z]+;/g, ' ')
      // Remove any remaining < or > that might be from HTML tags
      .replace(/[<>]/g, ' ');
  }

  /**
   * Normalize Unicode whitespace characters
   */
  private normalizeUnicodeWhitespace(text: string): string {
    return text
      // Replace various Unicode whitespace characters with regular space
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      // Replace zero-width spaces
      .replace(/[\u200B-\u200D\uFEFF]/g, '');
  }

  /**
   * Truncate text to specified length while preserving word boundaries
   */
  private truncateToLength(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;

    // Try to truncate at a word boundary
    let truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) { // Only truncate at word boundary if we don't lose too much content
      truncated = truncated.slice(0, lastSpace);
    }

    return truncated + '...';
  }
} 