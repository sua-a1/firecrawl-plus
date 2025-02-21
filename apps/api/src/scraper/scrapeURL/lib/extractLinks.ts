// TODO: refactor
import { load } from "cheerio"; // rustified
import { logger } from "../../../lib/logger";
import { extractLinks as _extractLinks } from "../../../lib/html-transformer";
import { URLTrace } from "../../../controllers/v1/types";
import { LinkManagementService } from "../../../services/link-management/link-management.service";
import { supabase_service } from "../../../services/supabase";

async function extractLinksRust(html: string, baseUrl: string): Promise<string[]> {
  const hrefs = await _extractLinks(html);

  const links: string[] = [];

  hrefs.forEach(href => {
    href = href.trim();
    try {
      if (href.startsWith("http://") || href.startsWith("https://")) {
        // Absolute URL, add as is
        links.push(href);
      } else if (href.startsWith("/")) {
        // Relative URL starting with '/', append to origin
        links.push(new URL(href, baseUrl).href);
      } else if (!href.startsWith("#") && !href.startsWith("mailto:")) {
        // Relative URL not starting with '/', append to base URL
        links.push(new URL(href, baseUrl).href);
      } else if (href.startsWith("mailto:")) {
        // mailto: links, add as is
        links.push(href);
      }
      // Fragment-only links (#) are ignored
    } catch (error) {
      logger.error(
        `Failed to construct URL for href: ${href} with base: ${baseUrl}`,
        { error },
      );
    }
  });

  // Remove duplicates and return
  return [...new Set(links)];
}

export async function extractLinks(
  html: string, 
  baseUrl: string, 
  options?: {
    projectId?: string,
    validateLinks?: boolean,
    urlTraces?: URLTrace[]
  }
): Promise<string[]> {
  let links: string[] = [];
  
  try {
    links = await extractLinksRust(html, baseUrl);
  } catch (error) {
    logger.error("Failed to call html-transformer! Falling back to cheerio...", {
      error,
      module: "scrapeURL",
      method: "extractLinks"
    });
    
    links = await extractLinksCheerio(html, baseUrl);
  }

  // Store and validate links if requested and we have the necessary context
  if (options?.validateLinks && options.projectId) {
    const linkManagementService = new LinkManagementService(
      supabase_service,
      {
        projectId: Number(options.projectId),
        allowExternalLinks: true,
        maxRetries: 3,
        batchSize: 50
      }
    );
    
    try {
      await linkManagementService.extractAndStoreLinks(
        baseUrl,
        html
      );
      
      logger.debug('Links stored and validated', {
        baseUrl,
        totalLinks: links.length,
        module: 'extractLinks'
      });
    } catch (error) {
      logger.error('Failed to store and validate links', {
        error,
        baseUrl,
        module: 'extractLinks'
      });
    }
  }

  return links;
}

// Move the Cheerio extraction to a separate function for cleaner organization
async function extractLinksCheerio(html: string, baseUrl: string): Promise<string[]> {
  const $ = load(html);
  const links: string[] = [];

  $("a").each((_, element) => {
    let href = $(element).attr("href");
    if (href) {
      href = href.trim();
      try {
        if (href.startsWith("http://") || href.startsWith("https://")) {
          links.push(href);
        } else if (href.startsWith("/")) {
          links.push(new URL(href, baseUrl).href);
        } else if (!href.startsWith("#") && !href.startsWith("mailto:")) {
          links.push(new URL(href, baseUrl).href);
        } else if (href.startsWith("mailto:")) {
          links.push(href);
        }
      } catch (error) {
        logger.error(
          `Failed to construct URL for href: ${href} with base: ${baseUrl}`,
          { error }
        );
      }
    }
  });

  return [...new Set(links)];
}
