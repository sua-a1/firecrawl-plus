import axios, { AxiosError } from "axios";
import { load } from "cheerio"; // rustified
import { URL } from "url";
import { getLinksFromSitemap } from "./sitemap";
import robotsParser, { Robot } from "robots-parser";
import { getURLDepth } from "./utils/maxDepthUtils";
import { axiosTimeout } from "../../lib/timeout";
import { logger as _logger } from "../../lib/logger";
import https from "https";
import { redisConnection } from "../../services/queue-service";
import { extractLinks } from "../../lib/html-transformer";
import { TimeoutSignal, URLTrace } from "../../controllers/v1/types";
import { LinkManagementService } from "../../services/link-management/link-management.service";
import { supabase_service } from "../../services/supabase";
import { addSummarizationJob } from '../../services/summarization/summarization-jobs';
import crypto from "crypto";

export class WebCrawler {
  private jobId: string;
  private initialUrl: string;
  private baseUrl: string;
  private includes: string[];
  private excludes: string[];
  private maxCrawledLinks: number;
  private maxCrawledDepth: number;
  private visited: Set<string> = new Set();
  private crawledUrls: Map<string, string> = new Map();
  private limit: number;
  private robotsTxtUrl: string;
  public robots: Robot;
  private generateImgAltText: boolean;
  private allowBackwardCrawling: boolean;
  private allowExternalContentLinks: boolean;
  private allowSubdomains: boolean;
  private ignoreRobotsTxt: boolean;
  private logger: typeof _logger;
  private sitemapsHit: Set<string> = new Set();
  private projectId?: number;
  private urlTraces: URLTrace[] = [];
  private validateLinks: boolean = false;
  private linkManagementService?: LinkManagementService;
  private summarizationEnabled: boolean = false;
  private summarizationOptions?: {
    type: 'extractive' | 'abstractive' | 'both';
    maxLength?: number;
    minLength?: number;
    extractiveSummarizer?: 'transformers' | 'textrank' | 'lexrank';
    fallbackStrategy?: 'textrank' | 'lexrank';
    temperature?: number;
    modelName?: string;
    earlyStop?: boolean;
    noRepeatNgramSize?: number;
    numBeams?: number;
    useFallbackModel?: boolean;
  };

  constructor({
    jobId,
    initialUrl,
    baseUrl,
    includes,
    excludes,
    maxCrawledLinks = 10000,
    limit = 10000,
    generateImgAltText = false,
    maxCrawledDepth = 10,
    allowBackwardCrawling = false,
    allowExternalContentLinks = false,
    allowSubdomains = false,
    ignoreRobotsTxt = false,
    projectId,
    validateLinks = false,
    summarization = { enabled: false, type: 'extractive' }
  }: {
    jobId: string;
    initialUrl: string;
    baseUrl?: string;
    includes?: string[];
    excludes?: string[];
    maxCrawledLinks?: number;
    limit?: number;
    generateImgAltText?: boolean;
    maxCrawledDepth?: number;
    allowBackwardCrawling?: boolean;
    allowExternalContentLinks?: boolean;
    allowSubdomains?: boolean;
    ignoreRobotsTxt?: boolean;
    projectId?: number;
    validateLinks?: boolean;
    summarization?: {
      enabled: boolean;
      type: 'extractive' | 'abstractive' | 'both';
      maxLength?: number;
      minLength?: number;
      extractiveSummarizer?: 'transformers' | 'textrank' | 'lexrank';
      fallbackStrategy?: 'textrank' | 'lexrank';
      temperature?: number;
      modelName?: string;
      earlyStop?: boolean;
      noRepeatNgramSize?: number;
      numBeams?: number;
      useFallbackModel?: boolean;
    };
  }) {
    this.jobId = jobId;
    this.initialUrl = initialUrl;
    this.baseUrl = baseUrl ?? new URL(initialUrl).origin;
    this.includes = Array.isArray(includes) ? includes : [];
    this.excludes = Array.isArray(excludes) ? excludes : [];
    this.limit = limit;
    this.robotsTxtUrl = `${this.baseUrl}${this.baseUrl.endsWith("/") ? "" : "/"}robots.txt`;
    this.robots = robotsParser(this.robotsTxtUrl, "");
    // Deprecated, use limit instead
    this.maxCrawledLinks = maxCrawledLinks ?? limit;
    this.maxCrawledDepth = maxCrawledDepth ?? 10;
    this.generateImgAltText = generateImgAltText ?? false;
    this.allowBackwardCrawling = allowBackwardCrawling ?? false;
    this.allowExternalContentLinks = allowExternalContentLinks ?? false;
    this.allowSubdomains = allowSubdomains ?? false;
    this.ignoreRobotsTxt = ignoreRobotsTxt ?? false;
    this.logger = _logger.child({ crawlId: this.jobId, module: "WebCrawler" });
    this.projectId = projectId;
    this.validateLinks = validateLinks;
    this.summarizationEnabled = summarization.enabled;

    if (this.summarizationEnabled) {
      this.summarizationOptions = summarization;
      this.logger.info('Summarization enabled for crawler', {
        type: summarization.type,
        projectId
      });
    }

    if (projectId) {
      this.linkManagementService = new LinkManagementService(supabase_service, {
        projectId,
        batchSize: 50,
        maxRetries: 3,
        allowExternalLinks: allowExternalContentLinks,
        includeSubdomains: allowSubdomains,
        rateLimit: {
          maxRequestsPerMinute: 300,
          delayBetweenBatches: 2000,
          requestsPerBatch: 10
        },
        alternativeUrlOptions: {
          maxResults: 5,
          minSimilarityScore: 0.7,
          useWaybackMachine: true,
          useSimilarityMatching: true,
          useAIMatching: true,
          openAIConfig: {
            apiKey: process.env.OPENAI_API_KEY!,
            model: 'text-embedding-3-small',
            dimensions: 1536
          },
          contextWeights: {
            url: 0.5,
            title: 0.3,
            description: 0.2
          }
        }
      });
    }
  }

  public filterLinks(
    sitemapLinks: string[],
    limit: number,
    maxDepth: number,
    fromMap: boolean = false,
  ): string[] {
    // If the initial URL is a sitemap.xml, skip filtering
    if (this.initialUrl.endsWith("sitemap.xml") && fromMap) {
      return sitemapLinks.slice(0, limit);
    }

    return sitemapLinks
      .filter((link) => {
        let url: URL;
        try {
          url = new URL(link.trim(), this.baseUrl);
        } catch (error) {
          this.logger.debug(`Error processing link: ${link}`, {
            link,
            error,
            method: "filterLinks",
          });
          return false;
        }
        const path = url.pathname;

        const depth = getURLDepth(url.toString());

        // Check if the link exceeds the maximum depth allowed
        if (depth > maxDepth) {
          return false;
        }

        // Check if the link should be excluded
        if (this.excludes.length > 0 && this.excludes[0] !== "") {
          if (
            this.excludes.some((excludePattern) =>
              new RegExp(excludePattern).test(path),
            )
          ) {
            return false;
          }
        }

        // Check if the link matches the include patterns, if any are specified
        if (this.includes.length > 0 && this.includes[0] !== "") {
          if (
            !this.includes.some((includePattern) =>
              new RegExp(includePattern).test(path),
            )
          ) {
            return false;
          }
        }

        // Normalize the initial URL and the link to account for www and non-www versions
        const normalizedInitialUrl = new URL(this.initialUrl);
        let normalizedLink;
        try {
          normalizedLink = new URL(link);
        } catch (_) {
          return false;
        }
        const initialHostname = normalizedInitialUrl.hostname.replace(
          /^www\./,
          "",
        );
        const linkHostname = normalizedLink.hostname.replace(/^www\./, "");

        // Ensure the protocol and hostname match, and the path starts with the initial URL's path
        // commented to able to handling external link on allowExternalContentLinks
        // if (linkHostname !== initialHostname) {
        //   return false;
        // }

        if (!this.allowBackwardCrawling) {
          if (
            !normalizedLink.pathname.startsWith(normalizedInitialUrl.pathname)
          ) {
            return false;
          }
        }

        const isAllowed = this.ignoreRobotsTxt
          ? true
          : (this.robots.isAllowed(link, "FireCrawlAgent") ?? true);
        // Check if the link is disallowed by robots.txt
        if (!isAllowed) {
          this.logger.debug(`Link disallowed by robots.txt: ${link}`, {
            method: "filterLinks",
            link,
          });
          return false;
        }

        if (this.isFile(link)) {
          return false;
        }

        return true;
      })
      .slice(0, limit);
  }

  public async getRobotsTxt(skipTlsVerification = false, abort?: AbortSignal): Promise<string> {
    let extraArgs = {};
    if (skipTlsVerification) {
      extraArgs["httpsAgent"] = new https.Agent({
        rejectUnauthorized: false,
      });
    }
    const response = await axios.get(this.robotsTxtUrl, {
      timeout: axiosTimeout,
      signal: abort,
      ...extraArgs,
    });
    return response.data;
  }

  public importRobotsTxt(txt: string) {
    this.robots = robotsParser(this.robotsTxtUrl, txt);
  }

  public async tryGetSitemap(
    urlsHandler: (urls: string[]) => unknown,
    fromMap: boolean = false,
    onlySitemap: boolean = false,
    timeout: number = 120000,
    abort?: AbortSignal,
    mock?: string,
  ): Promise<number> {
    this.logger.debug(`Fetching sitemap links from ${this.initialUrl}`, {
      method: "tryGetSitemap",
    });
    let leftOfLimit = this.limit;

    const normalizeUrl = (url: string) => {
      url = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
      if (url.endsWith("/")) {
        url = url.slice(0, -1);
      }
      return url;
    };

    const _urlsHandler = async (urls: string[]) => {
      if (fromMap && onlySitemap) {
        return urlsHandler(urls);
      } else {
        let filteredLinks = this.filterLinks(
          [...new Set(urls)],
          leftOfLimit,
          this.maxCrawledDepth,
          fromMap,
        );
        leftOfLimit -= filteredLinks.length;
        let uniqueURLs: string[] = [];
        for (const url of filteredLinks) {
          if (
            await redisConnection.sadd(
              "sitemap:" + this.jobId + ":links",
              normalizeUrl(url),
            )
          ) {
            uniqueURLs.push(url);
          }
        }

        await redisConnection.expire(
          "sitemap:" + this.jobId + ":links",
          3600,
          "NX",
        );
        if (uniqueURLs.length > 0) {
          return urlsHandler(uniqueURLs);
        }
      }
    };

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Sitemap fetch timeout")), timeout);
    });

    try {
      let count = (await Promise.race([
        Promise.all([
          this.tryFetchSitemapLinks(this.initialUrl, _urlsHandler, abort, mock),
          ...this.robots
            .getSitemaps()
            .map((x) => this.tryFetchSitemapLinks(x, _urlsHandler, abort, mock)),
        ]).then((results) => results.reduce((a, x) => a + x, 0)),
        timeoutPromise,
      ])) as number;

      if (count > 0) {
        if (
          await redisConnection.sadd(
            "sitemap:" + this.jobId + ":links",
            normalizeUrl(this.initialUrl),
          )
        ) {
          urlsHandler([this.initialUrl]);
        }
        count++;
      }

      return count;
    } catch (error) {
      if (error.message === "Sitemap fetch timeout") {
        this.logger.warn("Sitemap fetch timed out", {
          method: "tryGetSitemap",
          timeout,
        });
        return 0;
      }
      this.logger.error("Error fetching sitemap", {
        method: "tryGetSitemap",
        error,
      });
      return 0;
    }
  }

  public filterURL(href: string, url: string): string | null {
    let fullUrl = href;
    if (!href.startsWith("http")) {
      try {
        fullUrl = new URL(href, url).toString();
      } catch (_) {
        return null;
      }
    }
    let urlObj;
    try {
      urlObj = new URL(fullUrl);
    } catch (_) {
      return null;
    }
    const path = urlObj.pathname;

    if (this.isInternalLink(fullUrl)) {
      // INTERNAL LINKS
      if (
        this.isInternalLink(fullUrl) &&
        this.noSections(fullUrl) &&
        !this.matchesExcludes(path) &&
        this.isRobotsAllowed(fullUrl, this.ignoreRobotsTxt)
      ) {
        return fullUrl;
      } else if (
        this.isInternalLink(fullUrl) &&
        this.noSections(fullUrl) &&
        !this.matchesExcludes(path) &&
        !this.isRobotsAllowed(fullUrl, this.ignoreRobotsTxt)
      ) {
        (async () => {
          await redisConnection.sadd(
            "crawl:" + this.jobId + ":robots_blocked",
            fullUrl,
          );
          await redisConnection.expire(
            "crawl:" + this.jobId + ":robots_blocked",
            24 * 60 * 60,
            "NX",
          );
        })();
      }
    } else {
      // EXTERNAL LINKS
      if (
        this.isInternalLink(url) &&
        this.allowExternalContentLinks &&
        !this.isSocialMediaOrEmail(fullUrl) &&
        !this.matchesExcludes(fullUrl, true) &&
        !this.isExternalMainPage(fullUrl)
      ) {
        return fullUrl;
      }
    }

    if (
      this.allowSubdomains &&
      !this.isSocialMediaOrEmail(fullUrl) &&
      this.isSubdomain(fullUrl)
    ) {
      return fullUrl;
    }

    return null;
  }

  private async extractLinksFromHTMLRust(html: string, url: string) {
    return (await extractLinks(html)).filter(x => this.filterURL(x, url));
  }

  private extractLinksFromHTMLCheerio(html: string, url: string) {
    let links: string[] = [];

    const $ = load(html);
    $("a").each((_, element) => {
      let href = $(element).attr("href");
      if (href) {
        if (href.match(/^https?:\/[^\/]/)) {
          href = href.replace(/^https?:\//, "$&/");
        }
        const u = this.filterURL(href, url);
        if (u !== null) {
          links.push(u);
        }
      }
    });

    // Extract links from iframes with inline src
    $("iframe").each((_, element) => {
      const src = $(element).attr("src");
      if (src && src.startsWith("data:text/html")) {
        const iframeHtml = decodeURIComponent(src.split(",")[1]);
        const iframeLinks = this.extractLinksFromHTMLCheerio(iframeHtml, url);
        links = links.concat(iframeLinks);
      }
    });

    return links;
  }

  public async extractLinksFromHTML(html: string, url: string) {
    try {
      const uniqueLinks = [...new Set((await extractLinks(html)).map(x => {
        try {
          return new URL(x, url).href;
        } catch (e) {
          this.logger.error('Failed to parse URL', {
            url: x,
            baseUrl: url,
            error: e
          });
          return null;
        }
      }).filter(x => x !== null) as string[])];

      // Use LinkManagementService if available
      if (this.linkManagementService && uniqueLinks.length > 0) {
        try {
          this.logger.debug('Starting link extraction and storage', {
            url,
            totalLinks: uniqueLinks.length,
            module: 'WebCrawler'
          });

          // Store links
          const storedLinks = await this.linkManagementService.extractAndStoreLinks(
            url,
            html
          );

          // Validate stored links if validation is enabled
          if (this.validateLinks && storedLinks.length > 0) {
            this.logger.debug('Starting link validation', {
              url,
              totalLinks: storedLinks.length
            });

            try {
              await this.linkManagementService.validateLinksBatch(storedLinks);
              
              // Find alternatives for broken links
              this.logger.debug('Finding alternatives for broken links', {
                url,
                totalLinks: storedLinks.length
              });
              
              const alternatives = await this.linkManagementService.findAlternativesForBrokenLinks();
              
              this.logger.debug('Alternatives found', {
                url,
                alternativesCount: alternatives.size,
                alternatives: Array.from(alternatives.entries())
              });
            } catch (validationError) {
              this.logger.error('Link validation failed', {
                error: validationError,
                url,
                totalLinks: storedLinks.length
              });
              // Continue execution even if validation fails
            }
          }
          
          // Log results for debugging
          this.logger.debug('Links processed', {
            url,
            totalLinks: uniqueLinks.length,
            storedLinks: storedLinks.length,
            module: 'WebCrawler'
          });
        } catch (error) {
          this.logger.error('Failed to store and validate links', {
            error,
            url,
            module: 'WebCrawler'
          });
        }
      }

      return uniqueLinks;
    } catch (error) {
      this.logger.error("Failed to call html-transformer! Falling back to cheerio...", {
        error,
        module: "scrapeURL", 
        method: "extractMetadata"
      });
      
      const links = this.extractLinksFromHTMLCheerio(html, url);
      
      // Use LinkManagementService if available
      if (this.linkManagementService && links.length > 0) {
        try {
          this.logger.debug('Starting link extraction and storage (cheerio fallback)', {
            url,
            totalLinks: links.length,
            module: 'WebCrawler'
          });

          // Store links
          const storedLinks = await this.linkManagementService.extractAndStoreLinks(
            url,
            html
          );

          // Validate stored links if validation is enabled
          if (this.validateLinks && storedLinks.length > 0) {
            this.logger.debug('Starting link validation (cheerio fallback)', {
              url,
              totalLinks: storedLinks.length
            });

            try {
              await this.linkManagementService.validateLinksBatch(storedLinks);
              
              // Find alternatives for broken links
              this.logger.debug('Finding alternatives for broken links (cheerio fallback)', {
                url,
                totalLinks: storedLinks.length
              });
              
              const alternatives = await this.linkManagementService.findAlternativesForBrokenLinks();
              
              this.logger.debug('Alternatives found (cheerio fallback)', {
                url,
                alternativesCount: alternatives.size,
                alternatives: Array.from(alternatives.entries())
              });
            } catch (validationError) {
              this.logger.error('Link validation failed (cheerio fallback)', {
                error: validationError,
                url,
                totalLinks: storedLinks.length
              });
              // Continue execution even if validation fails
            }
          }
          
          // Log results for debugging
          this.logger.debug('Links processed (cheerio fallback)', {
            url,
            totalLinks: links.length,
            storedLinks: storedLinks.length,
            module: 'WebCrawler'
          });
        } catch (error) {
          this.logger.error('Failed to store and validate links (cheerio fallback)', {
            error,
            url,
            module: 'WebCrawler'
          });
        }
      }

      return links;
    }
  }

  private isRobotsAllowed(
    url: string,
    ignoreRobotsTxt: boolean = false,
  ): boolean {
    return ignoreRobotsTxt
      ? true
      : this.robots
        ? (this.robots.isAllowed(url, "FireCrawlAgent") ?? true)
        : true;
  }

  private matchesExcludes(url: string, onlyDomains: boolean = false): boolean {
    return this.excludes.some((pattern) => {
      if (onlyDomains) return this.matchesExcludesExternalDomains(url);

      return this.excludes.some((pattern) => new RegExp(pattern).test(url));
    });
  }

  // supported formats: "example.com/blog", "https://example.com", "blog.example.com", "example.com"
  private matchesExcludesExternalDomains(url: string) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;

      for (let domain of this.excludes) {
        let domainObj = new URL("http://" + domain.replace(/^https?:\/\//, ""));
        let domainHostname = domainObj.hostname;
        let domainPathname = domainObj.pathname;

        if (
          hostname === domainHostname ||
          hostname.endsWith(`.${domainHostname}`)
        ) {
          if (pathname.startsWith(domainPathname)) {
            return true;
          }
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  private isExternalMainPage(url: string): boolean {
    return !Boolean(
      url
        .split("/")
        .slice(3)
        .filter((subArray) => subArray.length > 0).length,
    );
  }

  private noSections(link: string): boolean {
    return !link.includes("#");
  }

  private isInternalLink(link: string): boolean {
    const urlObj = new URL(link, this.baseUrl);
    const baseDomain = new URL(this.baseUrl).hostname
      .replace(/^www\./, "")
      .trim();
    const linkDomain = urlObj.hostname.replace(/^www\./, "").trim();

    return linkDomain === baseDomain;
  }

  private isSubdomain(link: string): boolean {
    return new URL(link, this.baseUrl).hostname.endsWith(
      "." + new URL(this.baseUrl).hostname.split(".").slice(-2).join("."),
    );
  }

  public isFile(url: string): boolean {
    const fileExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".css",
      ".js",
      ".ico",
      ".svg",
      ".tiff",
      // ".pdf",
      ".zip",
      ".exe",
      ".dmg",
      ".mp4",
      ".mp3",
      ".wav",
      ".pptx",
      // ".docx",
      ".xlsx",
      // ".xml",
      ".avi",
      ".flv",
      ".woff",
      ".ttf",
      ".woff2",
      ".webp",
      ".inc",
    ];

    try {
      const urlWithoutQuery = url.split("?")[0].toLowerCase();
      return fileExtensions.some((ext) => urlWithoutQuery.endsWith(ext));
    } catch (error) {
      this.logger.error(`Error processing URL in isFile`, {
        method: "isFile",
        error,
      });
      return false;
    }
  }

  private isSocialMediaOrEmail(url: string): boolean {
    const socialMediaOrEmail = [
      "facebook.com",
      "twitter.com",
      "linkedin.com",
      "instagram.com",
      "pinterest.com",
      "mailto:",
      "github.com",
      "calendly.com",
      "discord.gg",
      "discord.com",
    ];
    return socialMediaOrEmail.some((ext) => url.includes(ext));
  }

  private async tryFetchSitemapLinks(
    url: string,
    urlsHandler: (urls: string[]) => unknown,
    abort?: AbortSignal,
    mock?: string,
  ): Promise<number> {
    const sitemapUrl = url.endsWith(".xml")
      ? url
      : `${url}${url.endsWith("/") ? "" : "/"}sitemap.xml`;

    let sitemapCount: number = 0;

    // Try to get sitemap from the provided URL first
    try {
      sitemapCount = await getLinksFromSitemap(
        { sitemapUrl, urlsHandler, mode: "fire-engine" },
        this.logger,
        this.jobId,
        this.sitemapsHit,
        abort,
        mock,
      );
    } catch (error) {
      if (error instanceof TimeoutSignal) {
        throw error;
      } else {
        this.logger.debug(`Failed to fetch sitemap from ${sitemapUrl}`, {
          method: "tryFetchSitemapLinks",
          sitemapUrl,
          error,
        });
      }
    }

    // If this is a subdomain, also try to get sitemap from the main domain
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const domainParts = hostname.split(".");

      // Check if this is a subdomain (has more than 2 parts and not www)
      if (domainParts.length > 2 && domainParts[0] !== "www") {
        // Get the main domain by taking the last two parts
        const mainDomain = domainParts.slice(-2).join(".");
        const mainDomainUrl = `${urlObj.protocol}//${mainDomain}`;
        const mainDomainSitemapUrl = `${mainDomainUrl}/sitemap.xml`;

        try {
          // Get all links from the main domain's sitemap
          sitemapCount += await getLinksFromSitemap(
            {
              sitemapUrl: mainDomainSitemapUrl,
              urlsHandler(urls) {
                return urlsHandler(
                  urls.filter((link) => {
                    try {
                      const linkUrl = new URL(link);
                      return linkUrl.hostname.endsWith(hostname);
                    } catch {}
                  }),
                );
              },
              mode: "fire-engine",
            },
            this.logger,
            this.jobId,
            this.sitemapsHit,
            abort,
            mock,
          );
        } catch (error) {
          if (error instanceof TimeoutSignal) {
            throw error;
          } else {
            this.logger.debug(
              `Failed to fetch main domain sitemap from ${mainDomainSitemapUrl}`,
              { method: "tryFetchSitemapLinks", mainDomainSitemapUrl, error },
            );
          }
        }
      }
    } catch (error) {
      if (error instanceof TimeoutSignal) {
        throw error;
      } else {
        this.logger.debug(`Error processing main domain sitemap`, {
          method: "tryFetchSitemapLinks",
          url,
          error,
        });
      }
    }

    // If no sitemap found yet, try the baseUrl as a last resort
    if (sitemapCount === 0) {
      const baseUrlSitemap = `${this.baseUrl}/sitemap.xml`;
      try {
        sitemapCount += await getLinksFromSitemap(
          { sitemapUrl: baseUrlSitemap, urlsHandler, mode: "fire-engine" },
          this.logger,
          this.jobId,
          this.sitemapsHit,
          abort,
          mock,
        );
      } catch (error) {
        if (error instanceof TimeoutSignal) {
          throw error;
        } else {
          this.logger.debug(`Failed to fetch sitemap from ${baseUrlSitemap}`, {
            method: "tryFetchSitemapLinks",
            sitemapUrl: baseUrlSitemap,
            error,
          });
          if (error instanceof AxiosError && error.response?.status === 404) {
            // ignore 404
          } else {
            sitemapCount += await getLinksFromSitemap(
              { sitemapUrl: baseUrlSitemap, urlsHandler, mode: "fire-engine" },
              this.logger,
              this.jobId,
              this.sitemapsHit,
              abort,
              mock,
            );
          }
        }
      }
    }

    if (this.sitemapsHit.size >= 20) {
      this.logger.warn("Sitemap limit hit!", { crawlId: this.jobId, url: this.baseUrl });
    }

    return sitemapCount;
  }

  public async processPage(url: string, content: string): Promise<void> {
    this.logger.debug('Processing page for summarization', {
      url,
      contentLength: content.length,
      summarizationEnabled: this.summarizationEnabled,
      projectId: this.projectId,
      summarizationOptions: this.summarizationOptions
    });

    if (this.summarizationEnabled) {
      try {
        const jobId = crypto.randomUUID();
        this.logger.info('Attempting to generate and store summary', {
          url,
          jobId,
          projectId: this.projectId,
          summaryType: this.summarizationOptions?.type
        });

        await this.generateAndStoreSummary(url, content);
      } catch (error) {
        this.logger.error('Failed to generate and store summary', {
          url,
          projectId: this.projectId,
          error: error.message,
          stack: error.stack
        });
      }
    } else {
      this.logger.debug('Summarization not enabled for this page', {
        url,
        projectId: this.projectId
      });
    }
  }

  private async generateAndStoreSummary(url: string, content: string): Promise<void> {
    // Debug logging for initial state
    this.logger.debug('generateAndStoreSummary called', {
      url,
      contentLength: content.length,
      summarizationEnabled: this.summarizationEnabled,
      projectId: this.projectId,
      summaryType: this.summarizationOptions?.type,
      hasContent: !!content
    });

    if (!this.summarizationEnabled || !this.projectId || !this.summarizationOptions) {
      this.logger.debug('Summarization not enabled, projectId not set, or options missing', { 
        url,
        enabled: this.summarizationEnabled,
        projectId: this.projectId,
        hasOptions: !!this.summarizationOptions,
        contentLength: content.length
      });
      return;
    }

    try {
      this.logger.info('Starting summarization job creation', { 
        url,
        projectId: this.projectId,
        contentLength: content.length,
        summaryType: this.summarizationOptions.type
      });
      
      // Generate a unique job ID that includes both crawl ID and URL hash
      const urlHash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
      const uniqueId = crypto.randomUUID();
      const jobId = `${this.jobId}_${urlHash}_${uniqueId}`;
      
      // Check if we've already processed this URL in this crawl
      const cacheKey = `summarization:${this.jobId}:${urlHash}`;
      const hasProcessed = await redisConnection.get(cacheKey);
      
      if (hasProcessed) {
        this.logger.info('URL already processed in this crawl, skipping', {
          url,
          urlHash,
          jobId: this.jobId
        });
        return;
      }
      
      // Log the job data before queueing
      this.logger.debug('Preparing to queue summarization job', {
        jobId,
        teamId: this.projectId.toString(),
        pageUrl: url,
        contentLength: content.length,
        summaryType: this.summarizationOptions.type,
        maxLength: this.summarizationOptions.maxLength
      });

      await addSummarizationJob({
        teamId: this.projectId.toString(),
        plan: 'default',
        pageUrl: url,
        originalText: content,
        summaryType: this.summarizationOptions.type,
        maxLength: this.summarizationOptions.maxLength,
        projectId: this.projectId
      }, {
        priority: 10,
        jobId
      });

      // Mark this URL as processed for this crawl
      await redisConnection.set(cacheKey, '1', 'EX', 3600); // Expire after 1 hour

      this.logger.info('Summarization job queued successfully', { 
        url,
        jobId,
        projectId: this.projectId,
        summaryType: this.summarizationOptions.type
      });
    } catch (error) {
      this.logger.error('Error queueing summarization job', { 
        error, 
        url,
        projectId: this.projectId,
        summaryType: this.summarizationOptions?.type,
        errorMessage: error.message,
        errorStack: error.stack
      });
    }
  }
}
