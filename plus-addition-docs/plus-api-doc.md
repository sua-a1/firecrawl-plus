# Firecrawl Plus API Documentation

> 🚀 **Local API Availability**: All features documented here are fully supported in the locally run API, as that is the open source version of Firecrawl that is available. You can utilize these advanced capabilities entirely within your own infrastructure, maintaining complete control over your data processing pipeline.

#How to Run Locally

First, start by installing dependencies:

1. node.js [instructions](https://nodejs.org/en/learn/getting-started/how-to-install-nodejs)
2. pnpm [instructions](https://pnpm.io/installation)
3. redis [instructions](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/)

Set environment variables in a .env in the /apps/api/ directory you can copy over the template in .env.example.

To start, we wont set up authentication, or any optional sub services (pdf parsing, JS blocking support, AI features )

.env:

```
# ===== Required ENVS ======
NUM_WORKERS_PER_QUEUE=8
PORT=3002
HOST=0.0.0.0
REDIS_URL=redis://localhost:6379
REDIS_RATE_LIMIT_URL=redis://localhost:6379

## To turn on DB authentication, you need to set up supabase.
USE_DB_AUTHENTICATION=false

# ===== Optional ENVS ======

# Supabase Setup (used to support DB authentication, advanced logging, etc.)
SUPABASE_ANON_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_TOKEN=

# Other Optionals
TEST_API_KEY= # use if you've set up authentication and want to test with a real API key
SCRAPING_BEE_API_KEY= #Set if you'd like to use scraping Bee to handle JS blocking
OPENAI_API_KEY= # add for LLM dependednt features (image alt generation, etc.)
BULL_AUTH_KEY= @
PLAYWRIGHT_MICROSERVICE_URL=  # set if you'd like to run a playwright fallback
LLAMAPARSE_API_KEY= #Set if you have a llamaparse key you'd like to use to parse pdfs
SLACK_WEBHOOK_URL= # set if you'd like to send slack server health status messages
POSTHOG_API_KEY= # set if you'd like to send posthog events like job logs
POSTHOG_HOST= # set if you'd like to send posthog events like job logs


```

### Installing dependencies

First, install the dependencies using pnpm.

```bash
# cd apps/api # to make sure you're in the right folder
pnpm install # make sure you have pnpm version 9+!
```

### Running the project

You're going to need to open 3 terminals. Here is [a video guide accurate as of Oct 2024](https://youtu.be/LHqg5QNI4UY).

### Terminal 1 - setting up redis

Run the command anywhere within your project

```bash
redis-server
```

### Terminal 2 - setting up workers

Now, navigate to the apps/api/ directory and run:

```bash
pnpm run workers
# if you are going to use the [llm-extract feature](https://github.com/mendableai/firecrawl/pull/586/), you should also export OPENAI_API_KEY=sk-______
```

This will start the workers who are responsible for processing crawl jobs.

### Terminal 3 - setting up the main server

To do this, navigate to the apps/api/ directory and run if you don’t have this already, install pnpm here: https://pnpm.io/installation
Next, run your server with:

```bash
pnpm run start
```

### Terminal 3 - sending our first request.

Alright: now let’s send our first request.

```curl
curl -X GET http://localhost:3002/test
```

This should return the response Hello, world!

# Link Management API Documentation

## Overview
The Link Management API provides endpoints to detect, report, and fix broken links within your project. It supports both batch operations and individual link fixes, with options for automatic suggestions and manual overrides.

## Authentication
All endpoints require authentication using a Bearer token:
```bash
Authorization: Bearer YOUR_API_KEY
```

## Endpoints

### 1. Get Broken Links Report
Returns a paginated list of broken links for a specific project, with optional sorting and filtering.

**Endpoint:** `GET /v1/links/broken/:project_id`

**Parameters:**
- `project_id` (path parameter): The ID of the project
- `sort_by` (query, optional): Sort field ['last_checked', 'status_code', 'page_url', 'extracted_link']
- `sort_order` (query, optional): Sort direction ['asc', 'desc']
- `page` (query, optional): Page number (default: 1)
- `per_page` (query, optional): Items per page (default: 50)
- `format` (query, optional): Response format ['json', 'csv'] (default: 'json')

**Response Formats:**

1. JSON (default):
```json
{
  "broken_links": [
    {
      "id": 123,
      "source_page": "https://example.com/page",
      "broken_url": "https://example.com/broken",
      "status_code": 404,
      "suggested_alternative": "https://example.com/new",
      "manual_override": null,
      "anchor_text": "Click here",
      "last_checked": "2024-02-21T08:22:43.717Z"
    }
  ],
  "total_count": 1,
  "project_id": "123",
  "metadata": {
    "filters_applied": {
      "excludes_test_data": true,
      "excludes_fixed_links": true,
      "status_codes": [404, 500, 502, 503, 504]
    },
    "last_updated": "2024-02-21T10:00:55.563Z",
    "pagination": {
      "current_page": 1,
      "total_pages": 1,
      "per_page": 50,
      "total_count": 1
    }
  }
}
```

2. CSV Format:
When `format=csv` is specified, the response will be a downloadable CSV file with the following columns:
- Source Page
- Broken URL
- Status Code
- Suggested Alternative
- Anchor Text
- Last Checked

The CSV file will be named `broken-links-{project_id}-{timestamp}.csv`

**Example Requests:**

1. JSON Format (default):
```bash
curl -X GET "http://localhost:3002/v1/links/broken/123?sort_by=last_checked&sort_order=desc&page=1&per_page=50" \
  -H "Authorization: Bearer YOUR_API_KEY"
```
2. Explicit JSON Format:
```bash
curl -X GET "http://localhost:3002/v1/links/broken/1?format=json" \
  -H "Authorization: Bearer YOUR_API_KEY"
```
3. CSV Format:
```bash
curl -X GET "http://localhost:3002/v1/links/broken/1?format=csv" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  --output broken-links-report.csv
```
4. CSV Format with sorting and pagination:
```bash
curl -X GET "http://localhost:3002/v1/links/broken/1?format=csv&sort_by=last_checked&sort_order=desc&page=1&per_page=50" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  --output broken-links-sorted.csv
```

### 2. Batch Fix Broken Links
Applies suggested alternatives to all eligible broken links in a project.

**Endpoint:** `POST /v1/links/fix/batch`

**Request Body:**
```json
{
  "project_id": "123"
}
```

**Response:**
```json
{
  "processed": 5,
  "skipped": 0,
  "total": 5,
  "success": true,
  "completed": true,
  "details": {
    "processed": [1, 2, 3, 4, 5],
    "skipped": []
  }
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3002/v1/links/fix/batch" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "123"}'
```

**Notes:**
- Only processes links that:
  - Have a valid suggested alternative
  - Don't have a manual override
  - Have error status codes (404, 500, 502, 503, 504)
  - Are not test URLs (filtered by patterns)
  - Have different suggested and current URLs

### 3. Manual Override for Single Link
Manually override a broken link with a new URL.

**Endpoint:** `POST /v1/links/fix/:link_id`

**Path Parameters:**
- `link_id`: ID of the link to override

**Request Body:**
```json
{
  "manual_override_url": "https://example.com/new-url",
  "project_id": "123"
}
```

**Response:**
```json
{
  "success": true,
  "link_id": "456",
  "original_url": "https://example.com/old-url",
  "manual_override_url": "https://example.com/new-url"
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3002/v1/links/fix/456" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "manual_override_url": "https://example.com/new-url",
    "project_id": "123"
  }'
```

## Error Responses

### 400 Bad Request
Returned when request parameters are invalid:
```json
{
  "error": "Invalid query parameters",
  "details": [
    {
      "code": "invalid_enum_value",
      "path": ["sort_by"],
      "message": "Invalid sort field"
    }
  ]
}
```

### 500 Internal Server Error
Returned when a server-side error occurs:
```json
{
  "error": "Database query failed",
  "details": {
    "code": "23505",
    "message": "Unique constraint violation"
  }
}
```

## Rate Limiting
All endpoints are subject to rate limiting based on the `RateLimiterMode.CrawlStatus` configuration.

## Filtering Logic
The API automatically applies the following filters:
- Excludes test URLs (patterns: '%test-page-%', '%broken-link-%')
- Only shows links with error status codes (404, 500, 502, 503, 504)
- Excludes links where suggested URL matches current URL
- Excludes links that have been manually overridden

## Testing
For testing purposes, you can use the provided test script:
```bash
# Set required environment variables
export API_BASE_URL=http://localhost:3002/v1
export API_KEY=your_test_key
export TEST_PROJECT_ID=1

# Run the test script
npx ts-node src/scripts/test-link-reports.ts
npx ts-node src/scripts/test-crawler-link-management.ts
```

# Crawling API Documentation

## Overview
The Crawling API provides endpoints to crawl websites and retrieve content in various formats, including AI-powered summaries of the crawled content.

## Authentication
All endpoints require authentication using a Bearer token:
```bash
Authorization: Bearer YOUR_API_KEY
```

## Endpoints

### 1. Start Crawl
Initiates a crawl job for a website.

**Endpoint:** `POST /v1/crawl`

**Request Body:**
```json
{
  "url": "https://docs.firecrawl.dev",
  "limit": 10,
  "scrapeOptions": {
    "formats": ["markdown", "html"]
  },
  "summarization": {
    "enabled": true,
    "type": "both",
    "maxLength": 500,
    "minLength": 100,
    "extractiveSummarizer": "transformers",
    "fallbackStrategy": "textrank",
    "temperature": 0.3,
    "modelName": "gpt-4",
    "earlyStop": true,
    "noRepeatNgramSize": 3,
    "numBeams": 4,
    "useFallbackModel": false
  }
}
```

**Parameters:**
- `url` (required): The starting URL to crawl
- `limit` (optional): Maximum number of pages to crawl (default: 100)
- `scrapeOptions` (optional): Configuration for content scraping
  - `formats`: Array of formats to return (markdown, html)
- `summarization` (optional): Configuration for content summarization
  - `enabled`: Whether to generate summaries (default: false)
  - `type`: Type of summary to generate ("extractive", "abstractive", or "both")
  - `maxLength`: Maximum length of generated summaries
  - `minLength`: Minimum length of generated summaries
  - `extractiveSummarizer`: Summarization algorithm ("transformers", "textrank", "lexrank")
  - `fallbackStrategy`: Fallback method if primary fails ("textrank", "lexrank")
  - `temperature`: Temperature for AI model (0.0 to 1.0)
  - `modelName`: Name of the AI model to use
  - `earlyStop`: Whether to use early stopping
  - `noRepeatNgramSize`: Size of n-grams to prevent repetition
  - `numBeams`: Number of beams for beam search
  - `useFallbackModel`: Whether to use fallback model if primary fails

**Response:**
```json
{
  "success": true,
  "id": "123-456-789",
  "url": "https://api.firecrawl.dev/v1/crawl/123-456-789"
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3002/v1/crawl" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.firecrawl.dev",
    "limit": 10,
    "scrapeOptions": {
      "formats": ["markdown", "html"]
    },
    "projectId":1,
    "summarization": {
      "enabled": true,
      "type": "both",
      "maxLength": 500,
      "minLength": 100,
      "extractiveSummarizer": "transformers",
      "fallbackStrategy": "textrank",
      "temperature": 0.3,
      "modelName": "gpt-4"
    }
  }'
```

### 2. Get Crawl Status
Check the status of a crawl job and retrieve results.

**Endpoint:** `GET /v1/crawl/:job_id`

**Parameters:**
- `job_id` (path parameter): The ID of the crawl job

**Response:**
```json
{
  "status": "completed",
  "total": 36,
  "creditsUsed": 36,
  "expiresAt": "2024-00-00T00:00:00.000Z",
  "data": [
    {
      "markdown": "Content in markdown format...",
      "html": "Content in HTML format...",
      "metadata": {
        "title": "Page Title",
        "language": "en",
        "sourceURL": "https://example.com/page",
        "description": "Page description",
        "ogLocaleAlternate": [],
        "statusCode": 200
      },
      "summaries": {
        "extractive": "Key points extracted from the content...",
        "abstractive": "AI-generated narrative summary..."
      }
    }
  ]
}
```

**Example Request:**
```bash
curl -X GET "http://localhost:3002/v1/crawl/123-456-789" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Error Responses

### 400 Bad Request
Returned when request parameters are invalid:
```json
{
  "success": false,
  "error": "Invalid request parameters",
  "details": [
    {
      "code": "invalid_enum_value",
      "path": ["summarization.type"],
      "message": "Invalid summary type. Must be one of: extractive, abstractive, both"
    }
  ]
}
```

### 404 Not Found
Returned when a crawl job is not found:
```json
{
  "success": false,
  "error": "Crawl job not found",
  "details": {
    "job_id": "123-456-789"
  }
}
```

### 500 Internal Server Error
Returned when crawling fails:
```json
{
  "success": false,
  "error": "Crawl failed",
  "details": {
    "code": "CRAWL_ERROR",
    "message": "Failed to crawl website: connection timeout"
  }
}
```

## Rate Limiting
- Crawl job creation: 5 requests per minute
- Crawl status checks: 60 requests per minute

## Testing
For testing purposes, you can use the provided test script:
```bash
# Set required environment variables
export API_BASE_URL=http://localhost:3002/v1
export API_KEY=your_test_key
export TEST_PROJECT_ID=1

# Run the test script
npx ts-node src/scripts/test-crawler-link-management.ts
```

# Content Summarization API Documentation

## Overview
The Content Summarization API provides endpoints to generate and retrieve AI-powered summaries of web content. It supports both extractive and abstractive summarization methods, with configurable options for length, style, and fallback strategies.

## Authentication
All endpoints require authentication using a Bearer token:
```bash
Authorization: Bearer YOUR_API_KEY
```

## Endpoints

### 1. Get Summary by URL
Retrieves an existing summary for a specific URL.

**Endpoint:** `GET /v1/summaries/:page_url`

**Parameters:**
- `page_url` (path parameter): URL-encoded page URL to get summary for

**Response:**
```json
{
  "success": true,
  "data": {
    "page_url": "https://example.com/page",
    "extractive_summary": "Key points extracted from the content...",
    "abstractive_summary": "AI-generated narrative summary...",
    "summary_type": "both",
    "created_at": "2024-02-21T08:22:43.717Z",
    "metadata": {
      "processedAt": "2024-02-21T08:22:43.717Z",
      "contentLength": 5000,
      "summaryLength": 500
    }
  }
}
```

**Example Request:**
```bash
curl -X GET "http://localhost:3002/v1/summaries/https%3A%2F%2Fexample.com%2Fpage" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 2. Generate Summary
Generates a new summary for provided content.

**Endpoint:** `POST /v1/summaries/generate`

**Request Body:**
```json
{
  "url": "https://example.com/page",
  "text": "Content to summarize...",
  "type": "both",
  "maxLength": 500,
  "minLength": 100,
  "options": {
    "extractiveSummarizer": "transformers",
    "fallbackStrategy": "textrank",
    "temperature": 0.3,
    "modelName": "gpt-4"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "extractive_summary": "Key points extracted from the content...",
    "abstractive_summary": "AI-generated narrative summary...",
    "original_text": "Content to summarize...",
    "metadata": {
      "processedAt": "2024-02-21T08:22:43.717Z",
      "options": {
        "type": "both",
        "maxLength": 500,
        "minLength": 100
      }
    },
    "created_at": "2024-02-21T08:22:43.717Z",
    "updated_at": "2024-02-21T08:22:43.717Z"
  }
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3002/v1/summaries/generate" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/page",
    "text": "Content to summarize...",
    "type": "both",
    "maxLength": 500,
    "minLength": 100,
    "options": {
      "extractiveSummarizer": "transformers",
      "fallbackStrategy": "textrank",
      "temperature": 0.3,
      "modelName": "gpt-4"
    }
  }'
```

### 3. Batch Summary Generation
Generates summaries for multiple URLs in bulk.

**Endpoint:** `POST /v1/summaries/bulk`

**Request Body:**
```json
{
  "urls": [
    "https://example.com/page1",
    "https://example.com/page2"
  ],
  "type": "both",
  "maxLength": 500,
  "minLength": 100,
  "options": {
    "extractiveSummarizer": "transformers",
    "fallbackStrategy": "textrank",
    "temperature": 0.3,
    "modelName": "gpt-4"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "job_id": "bulk-summary-123",
    "total_urls": 2,
    "status": "processing",
    "estimated_completion_time": "2024-02-21T08:27:43.717Z"
  }
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3002/v1/summaries/bulk" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com/page1",
      "https://example.com/page2"
    ],
    "type": "both",
    "maxLength": 500,
    "minLength": 100,
    "options": {
      "extractiveSummarizer": "transformers",
      "fallbackStrategy": "textrank",
      "temperature": 0.3,
      "modelName": "gpt-4"
    }
  }'
```

### 4. Get Batch Summary Status
Check the status of a bulk summarization job.

**Endpoint:** `GET /v1/summaries/bulk/:job_id`

**Parameters:**
- `job_id` (path parameter): The ID of the bulk summarization job

**Response:**
```json
{
  "success": true,
  "data": {
    "job_id": "bulk-summary-123",
    "status": "completed",
    "total_urls": 2,
    "completed_urls": 2,
    "failed_urls": 0,
    "summaries": [
      {
        "url": "https://example.com/page1",
        "extractive_summary": "...",
        "abstractive_summary": "...",
        "created_at": "2024-02-21T08:22:43.717Z"
      },
      {
        "url": "https://example.com/page2",
        "extractive_summary": "...",
        "abstractive_summary": "...",
        "created_at": "2024-02-21T08:22:43.717Z"
      }
    ]
  }
}
```

**Example Request:**
```bash
curl -X GET "http://localhost:3002/v1/summaries/bulk/bulk-summary-123" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Configuration Options

### Summarization Types
- `extractive`: Extracts key sentences from the original text
- `abstractive`: Generates a new summary using AI
- `both`: Generates both extractive and abstractive summaries

### Extractive Summarizers
- `transformers`: Uses Transformers.js with BART model (default)
- `textrank`: Uses TextRank algorithm
- `lexrank`: Uses LexRank algorithm

### Fallback Strategies
- `textrank`: Falls back to TextRank if primary method fails
- `lexrank`: Falls back to LexRank if primary method fails

## Error Responses

### 400 Bad Request
Returned when request parameters are invalid:
```json
{
  "success": false,
  "error": "Invalid request parameters",
  "details": [
    {
      "code": "invalid_enum_value",
      "path": ["type"],
      "message": "Invalid summary type. Must be one of: extractive, abstractive, both"
    }
  ]
}
```

### 404 Not Found
Returned when a summary is not found:
```json
{
  "success": false,
  "error": "Summary not found",
  "details": {
    "url": "https://example.com/page"
  }
}
```

### 500 Internal Server Error
Returned when summarization fails:
```json
{
  "success": false,
  "error": "Summarization failed",
  "details": {
    "code": "SUMMARY_GENERATION_ERROR",
    "message": "Failed to generate summary: model initialization error"
  }
}
```

## Rate Limiting
- Single summary generation: 10 requests per minute
- Batch summary generation: 2 requests per minute
- Summary retrieval: 60 requests per minute

## Testing
For testing purposes, you can use the provided test script:
```bash
# Set required environment variables
export API_BASE_URL=http://localhost:3002/v1
export API_KEY=your_test_key
export TEST_PROJECT_ID=1

# Run the test script
npx ts-node src/scripts/test-summaries-crawler.ts
```
