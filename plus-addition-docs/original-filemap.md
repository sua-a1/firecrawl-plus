<file_map>
├── firecrawl-plus
│   ├── .github
│   ├── apps
│   │   ├── api
│   │   │   ├── sharedLibs
│   │   │   │   ├── go-html-to-md
│   │   │   │   │   ├── go.mod
│   │   │   │   │   ├── go.sum
│   │   │   │   │   ├── html-to-markdown.go
│   │   │   │   │   └── README.md
│   │   │   │   └── html-transformer
│   │   │   │       ├── src
│   │   │   │       │   └── lib.rs
│   │   │   │       ├── Cargo.lock
│   │   │   │       └── Cargo.toml
│   │   │   ├── src
│   │   │   │   ├── __tests__
│   │   │   │   ├── controllers
│   │   │   │   │   ├── __tests__
│   │   │   │   │   │   └── crawl.test.ts
│   │   │   │   │   ├── v0
│   │   │   │   │   │   ├── admin
│   │   │   │   │   │   │   ├── acuc-cache-clear.ts
│   │   │   │   │   │   │   ├── check-fire-engine.ts
│   │   │   │   │   │   │   ├── queue.ts
│   │   │   │   │   │   │   └── redis-health.ts
│   │   │   │   │   │   ├── crawl-cancel.ts
│   │   │   │   │   │   ├── crawl-status.ts
│   │   │   │   │   │   ├── crawl.ts
│   │   │   │   │   │   ├── crawlPreview.ts
│   │   │   │   │   │   ├── keyAuth.ts
│   │   │   │   │   │   ├── liveness.ts
│   │   │   │   │   │   ├── readiness.ts
│   │   │   │   │   │   ├── scrape.ts
│   │   │   │   │   │   ├── search.ts
│   │   │   │   │   │   └── status.ts
│   │   │   │   │   ├── v1
│   │   │   │   │   │   ├── __tests__
│   │   │   │   │   │   │   ├── crawl.test.ts.WIP
│   │   │   │   │   │   │   └── urlValidation.test.ts
│   │   │   │   │   │   ├── batch-scrape.ts
│   │   │   │   │   │   ├── concurrency-check.ts
│   │   │   │   │   │   ├── crawl-cancel.ts
│   │   │   │   │   │   ├── crawl-errors.ts
│   │   │   │   │   │   ├── crawl-status-ws.ts
│   │   │   │   │   │   ├── crawl-status.ts
│   │   │   │   │   │   ├── crawl.ts
│   │   │   │   │   │   ├── credit-usage.ts
│   │   │   │   │   │   ├── extract-status.ts
│   │   │   │   │   │   ├── extract.ts
│   │   │   │   │   │   ├── liveness.ts
│   │   │   │   │   │   ├── map.ts
│   │   │   │   │   │   ├── readiness.ts
│   │   │   │   │   │   ├── scrape-status.ts
│   │   │   │   │   │   ├── scrape.ts
│   │   │   │   │   │   ├── search.ts
│   │   │   │   │   │   └── types.ts
│   │   │   │   │   └── auth.ts
│   │   │   │   ├── lib
│   │   │   │   │   ├── __tests__
│   │   │   │   │   ├── extract
│   │   │   │   │   │   ├── archive
│   │   │   │   │   │   │   └── crawling-index.ts
│   │   │   │   │   │   ├── completions
│   │   │   │   │   │   │   ├── analyzeSchemaAndPrompt.ts
│   │   │   │   │   │   │   ├── batchExtract.ts
│   │   │   │   │   │   │   ├── checkShouldExtract.ts
│   │   │   │   │   │   │   └── singleAnswer.ts
│   │   │   │   │   │   ├── helpers
│   │   │   │   │   │   │   ├── __tests__
│   │   │   │   │   │   │   │   └── source-tracker.test.ts
│   │   │   │   │   │   │   ├── cached-docs.ts
│   │   │   │   │   │   │   ├── deduplicate-objs-array.ts
│   │   │   │   │   │   │   ├── dereference-schema.ts
│   │   │   │   │   │   │   ├── dump-to-file.ts
│   │   │   │   │   │   │   ├── merge-null-val-objs.ts
│   │   │   │   │   │   │   ├── mix-schema-objs.ts
│   │   │   │   │   │   │   ├── source-tracker.ts
│   │   │   │   │   │   │   ├── spread-schemas.ts
│   │   │   │   │   │   │   └── transform-array-to-obj.ts
│   │   │   │   │   │   ├── index
│   │   │   │   │   │   │   └── pinecone.ts
│   │   │   │   │   │   ├── usage
│   │   │   │   │   │   │   ├── llm-cost.ts
│   │   │   │   │   │   │   └── model-prices.ts
│   │   │   │   │   │   ├── build-document.ts
│   │   │   │   │   │   ├── build-prompts.ts
│   │   │   │   │   │   ├── completions.ts
│   │   │   │   │   │   ├── config.ts
│   │   │   │   │   │   ├── document-scraper.ts
│   │   │   │   │   │   ├── extract-redis.ts
│   │   │   │   │   │   ├── extraction-service.ts
│   │   │   │   │   │   ├── reranker.ts
│   │   │   │   │   │   ├── team-id-sync.ts
│   │   │   │   │   │   └── url-processor.ts
│   │   │   │   │   ├── LLM-extraction
│   │   │   │   │   │   ├── helpers.ts
│   │   │   │   │   │   ├── index.ts
│   │   │   │   │   │   └── models.ts
│   │   │   │   │   ├── batch-process.ts
│   │   │   │   │   ├── cache.ts
│   │   │   │   │   ├── canonical-url.test.ts
│   │   │   │   │   ├── canonical-url.ts
│   │   │   │   │   ├── concurrency-limit.ts
│   │   │   │   │   ├── crawl-redis.test.ts
│   │   │   │   │   ├── crawl-redis.ts
│   │   │   │   │   ├── custom-error.ts
│   │   │   │   │   ├── default-values.ts
│   │   │   │   │   ├── entities.ts
│   │   │   │   │   ├── html-to-markdown.ts
│   │   │   │   │   ├── html-transformer.ts
│   │   │   │   │   ├── job-priority.ts
│   │   │   │   │   ├── logger.ts
│   │   │   │   │   ├── map-cosine.ts
│   │   │   │   │   ├── parse-mode.ts
│   │   │   │   │   ├── parseApi.ts
│   │   │   │   │   ├── ranker.test.ts
│   │   │   │   │   ├── ranker.ts
│   │   │   │   │   ├── scrape-events.ts
│   │   │   │   │   ├── strings.ts
│   │   │   │   │   ├── supabase-jobs.ts
│   │   │   │   │   ├── timeout.ts
│   │   │   │   │   ├── validate-country.ts
│   │   │   │   │   ├── validateUrl.test.ts
│   │   │   │   │   ├── validateUrl.ts
│   │   │   │   │   └── withAuth.ts
│   │   │   │   ├── main
│   │   │   │   │   └── runWebScraper.ts
│   │   │   │   ├── routes
│   │   │   │   │   ├── admin.ts
│   │   │   │   │   ├── v0.ts
│   │   │   │   │   └── v1.ts
│   │   │   │   ├── scraper
│   │   │   │   │   ├── scrapeURL
│   │   │   │   │   │   ├── engines
│   │   │   │   │   │   │   ├── cache
│   │   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   │   ├── docx
│   │   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   │   ├── fetch
│   │   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   │   ├── fire-engine
│   │   │   │   │   │   │   │   ├── checkStatus.ts
│   │   │   │   │   │   │   │   ├── delete.ts
│   │   │   │   │   │   │   │   ├── index.ts
│   │   │   │   │   │   │   │   └── scrape.ts
│   │   │   │   │   │   │   ├── pdf
│   │   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   │   ├── playwright
│   │   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   │   ├── scrapingbee
│   │   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   │   ├── utils
│   │   │   │   │   │   │   │   ├── downloadFile.ts
│   │   │   │   │   │   │   │   ├── safeFetch.ts
│   │   │   │   │   │   │   │   └── specialtyHandler.ts
│   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   ├── lib
│   │   │   │   │   │   │   ├── extractLinks.ts
│   │   │   │   │   │   │   ├── extractMetadata.ts
│   │   │   │   │   │   │   ├── fetch.ts
│   │   │   │   │   │   │   ├── mock.ts
│   │   │   │   │   │   │   ├── removeUnwantedElements.ts
│   │   │   │   │   │   │   └── urlSpecificParams.ts
│   │   │   │   │   │   ├── transformers
│   │   │   │   │   │   │   ├── cache.ts
│   │   │   │   │   │   │   ├── index.ts
│   │   │   │   │   │   │   ├── llmExtract.test.ts
│   │   │   │   │   │   │   ├── llmExtract.ts
│   │   │   │   │   │   │   ├── removeBase64Images.ts
│   │   │   │   │   │   │   └── uploadScreenshot.ts
│   │   │   │   │   │   ├── error.ts
│   │   │   │   │   │   ├── index.ts
│   │   │   │   │   │   ├── README.md
│   │   │   │   │   │   └── scrapeURL.test.ts
│   │   │   │   │   └── WebScraper
│   │   │   │   │       ├── __tests__
│   │   │   │   │       │   ├── crawler.test.ts
│   │   │   │   │       │   └── dns.test.ts
│   │   │   │   │       ├── custom
│   │   │   │   │       │   └── handleCustomScraping.ts
│   │   │   │   │       ├── utils
│   │   │   │   │       │   ├── __tests__
│   │   │   │   │       │   │   ├── blocklist.test.ts
│   │   │   │   │       │   │   └── maxDepthUtils.test.ts
│   │   │   │   │       │   ├── blocklist.ts
│   │   │   │   │       │   ├── maxDepthUtils.ts
│   │   │   │   │       │   └── removeBase64Images.ts
│   │   │   │   │       ├── crawler.ts
│   │   │   │   │       ├── sitemap-index.ts
│   │   │   │   │       └── sitemap.ts
│   │   │   │   ├── search
│   │   │   │   │   ├── fireEngine.ts
│   │   │   │   │   ├── googlesearch.ts
│   │   │   │   │   ├── index.ts
│   │   │   │   │   ├── searchapi.ts
│   │   │   │   │   └── serper.ts
│   │   │   │   ├── services
│   │   │   │   │   ├── alerts
│   │   │   │   │   │   ├── index.ts
│   │   │   │   │   │   └── slack.ts
│   │   │   │   │   ├── billing
│   │   │   │   │   │   ├── auto_charge.ts
│   │   │   │   │   │   ├── credit_billing.ts
│   │   │   │   │   │   ├── issue_credits.ts
│   │   │   │   │   │   └── stripe.ts
│   │   │   │   │   ├── idempotency
│   │   │   │   │   │   ├── create.ts
│   │   │   │   │   │   └── validate.ts
│   │   │   │   │   ├── indexing
│   │   │   │   │   │   ├── crawl-maps-index.ts
│   │   │   │   │   │   └── index-worker.ts
│   │   │   │   │   ├── logging
│   │   │   │   │   │   ├── crawl_log.ts
│   │   │   │   │   │   ├── log_job.ts
│   │   │   │   │   │   └── scrape_log.ts
│   │   │   │   │   ├── notification
│   │   │   │   │   │   ├── email_notification.ts
│   │   │   │   │   │   └── notification_string.ts
│   │   │   │   │   ├── posthog.ts
│   │   │   │   │   ├── queue-jobs.ts
│   │   │   │   │   ├── queue-service.ts
│   │   │   │   │   ├── queue-worker.ts
│   │   │   │   │   ├── rate-limiter.test.ts
│   │   │   │   │   ├── rate-limiter.ts
│   │   │   │   │   ├── redis.ts
│   │   │   │   │   ├── redlock.ts
│   │   │   │   │   ├── sentry.ts
│   │   │   │   │   ├── supabase.ts
│   │   │   │   │   ├── system-monitor.ts
│   │   │   │   │   └── webhook.ts
│   │   │   │   ├── control.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── run-req.ts
│   │   │   │   ├── strings.ts
│   │   │   │   ├── supabase_types.ts
│   │   │   │   └── types.ts
│   │   │   ├── utils
│   │   │   │   ├── logview.js
│   │   │   │   ├── urldump-redis.js
│   │   │   │   └── urldump.js
│   │   │   ├── .dockerignore
│   │   │   ├── .env.example
│   │   │   ├── .gitattributes
│   │   │   ├── .prettierrc
│   │   │   ├── docker-entrypoint.sh
│   │   │   ├── Dockerfile
│   │   │   ├── fly.staging.toml
│   │   │   ├── fly.toml
│   │   │   ├── jest.config.js
│   │   │   ├── jest.setup.js
│   │   │   ├── openapi-v0.json
│   │   │   ├── openapi.json
│   │   │   ├── package.json
│   │   │   ├── pnpm-lock.yaml
│   │   │   ├── requests.http
│   │   │   ├── tsconfig.json
│   │   │   └── v1-openapi.json
│   │   ├── js-sdk
│   │   ├── playwright-service
│   │   │   ├── Dockerfile
│   │   │   ├── get_error.py
│   │   │   ├── main.py
│   │   │   ├── README.md
│   │   │   ├── requests.http
│   │   │   ├── requirements.txt
│   │   │   └── runtime.txt
│   │   ├── playwright-service-ts
│   │   │   ├── helpers
│   │   │   │   └── get_error.ts
│   │   │   ├── api.ts
│   │   │   ├── Dockerfile
│   │   │   ├── package.json
│   │   │   ├── README.md
│   │   │   └── tsconfig.json
│   │   ├── python-sdk
│   │   ├── redis
│   │   │   ├── scripts
│   │   │   │   ├── bump_version.sh
│   │   │   │   ├── semver
│   │   │   │   └── version.sh
│   │   │   ├── .dockerignore
│   │   │   ├── Dockerfile
│   │   │   ├── fly.toml
│   │   │   ├── Procfile
│   │   │   ├── README.md
│   │   │   └── start-redis-server.sh
│   │   ├── rust-sdk
│   │   ├── test-suite
│   │   ├── ui
│   │   │   └── ingestion-ui
│   │   │       ├── public
│   │   │       │   ├── favicon.ico
│   │   │       │   └── vite.svg
│   │   │       ├── src
│   │   │       │   ├── components
│   │   │       │   │   ├── ui
│   │   │       │   │   │   ├── button.tsx
│   │   │       │   │   │   ├── card.tsx
│   │   │       │   │   │   ├── checkbox.tsx
│   │   │       │   │   │   ├── collapsible.tsx
│   │   │       │   │   │   ├── input.tsx
│   │   │       │   │   │   ├── label.tsx
│   │   │       │   │   │   └── radio-group.tsx
│   │   │       │   │   ├── ingestion.tsx
│   │   │       │   │   └── ingestionV1.tsx
│   │   │       │   ├── lib
│   │   │       │   │   └── utils.ts
│   │   │       │   ├── App.tsx
│   │   │       │   ├── index.css
│   │   │       │   ├── main.tsx
│   │   │       │   └── vite-env.d.ts
│   │   │       ├── .eslintrc.cjs
│   │   │       ├── components.json
│   │   │       ├── index.html
│   │   │       ├── LICENSE
│   │   │       ├── package.json
│   │   │       ├── postcss.config.js
│   │   │       ├── README.md
│   │   │       ├── tailwind.config.js
│   │   │       ├── tsconfig.app.json
│   │   │       ├── tsconfig.json
│   │   │       ├── tsconfig.node.json
│   │   │       └── vite.config.ts
│   │   └── www
│   │       └── README.md
│   ├── examples
│   ├── img
│   │   ├── firecrawl_logo.png
│   │   └── open-source-cloud.png
│   ├── .gitattributes
│   ├── .gitmodules
│   ├── CONTRIBUTING.md
│   ├── docker-compose.yaml
│   ├── LICENSE
│   ├── README.md
│   └── SELF_HOST.md