Phase 1: Database Infrastructure Analysis & Replication
1. Analyze Existing Tables ✅
    - Review all tables in supabase_types.ts
    - Identify tables that might be relevant for link management:
        - data table (has source and content fields)
        - data_sources table
        - source table
2. Required New Tables ✅
    - source_links table
    - link_redirects table
    - links table
    - wayback_cache table
    - url_embeddings table
3. Database Design ✅
    - Add to supabase_types.ts with the following tables:
        - source_links
        - links
        - wayback_cache
        - url_embeddings

4. Database Functions to Replicate ✅
Review and replicate relevant functions from supabase_types.ts:
search_documents
get_sources_info_new
get_sources_from_message

Phase 2: Existing Functionality Analysis ✅
1. URL Extraction Investigation
    - Found existing URL extraction in:
        - apps/api/src/lib/extract/url-processor.ts: Main URL processing and validation
        - apps/api/src/scraper/scrapeURL/lib/extractLinks.ts: HTML link extraction (Rust + Cheerio)
        - apps/api/src/lib/extract/extraction-service.ts: Orchestration service
    - Key Features Available:
        - Rust-based HTML parsing with Cheerio fallback
        - URL normalization and deduplication
        - Batch processing support (50-100 URLs)
        - Blocklist checking
        - External link handling
        - Progress tracking
        - Caching support

2. Link Validation Investigation ✅
    - Found existing functionality:
        - URL validation in url-processor.ts
        - Status tracking via URLTrace system
        - Batch processing infrastructure
        - Error handling and logging

Phase 3: Implementation Plan
1. Database Setup ✅
    - [x] Create new links table in Supabase
    - [x] Add necessary indexes
    - [x] Set up foreign key relationships
    - [x] Disable RLS as not needed
    - [x] Create wayback_cache table
    - [x] Create url_embeddings table with vector support

2. URL Extraction Integration ✅
    [x] Create new LinkManagementService:
        - [x] Integrate with existing extractLinks function
        - [x] Add link storage in new tables
        - [x] Implement status checking
        - [x] Add redirect management
        - [x] Interface with Wayback Machine API

3. Link Validation Enhancement ✅
    [x] Extend existing URL processing:
        - [x] Add status check hooks with retry mechanism
        - [x] Implement redirect tracking with type classification
        - [x] Add link storage during crawls
        - [x] Comprehensive error handling and logging
    [x] Implement batch processing (50-100 URLs)
    [x] Leverage existing retry mechanism via robustFetch
    [x] Implement status code categorization:
        - 3xx: Redirect handling with type classification
        - 4xx: Client errors (404, 403, etc.)
        - 5xx: Server errors
        - Network errors mapped to appropriate status codes

4. Alternative URL Suggestion ✅
    [x] Integrate with Wayback Machine API
    [x] Implement similarity matching using existing search functions
    [x] Implement AI-based similarity matching using pre-trained model
    [x] Set up caching for API responses
    [x] Enhance AI matching with OpenAI embeddings:
        - [x] Implement OpenAIEmbeddingsService with rate limiting
        - [x] Add weighted context processing (URL, title, description)
        - [x] Set up caching for embeddings
        - [x] Add configurable weights and thresholds
    [x] Add more sophisticated context-based matching:
      - [x] Implement semantic path analysis
        - [x] Add domain-specific preprocessing
        - [x] Add content-based fallback matching

5. Reporting System
    [x] Design report format
    [x] Create API endpoints for report generation:
        - [x] Implement GET /v1/links/broken/:project_id ✅
            - [x] Add project-specific filtering
            - [x] Include total count in response
            - [x] Add pagination support (page & per_page)
            - [x] Implement sorting options (last_checked, status_code, page_url, extracted_link)
            - [x] Add metadata with filter info
        - [x] Implement POST /v1/links/fix/batch ✅
            - [x] Add batch validation
            - [x] Add progress tracking
            - [x] Return processed/skipped counts
            - [x] Handle duplicate prevention
        - [x] Implement POST /v1/links/fix/:link_id ✅
            - [x] Add single link validation
            - [x] Update link status
            - [x] Support manual override
            - [x] Return success status
    [x] Add API documentation ✅
    [ ] Implement export functionality

6. Database Schema Updates ✅
    [x] Update links table:
        - [x] Add manual_override column
        - [x] Update database types in supabase_types.ts
    [x] Add stored procedure for batch updates:
        - [x] Create update_extracted_links function
        - [x] Add transaction support
        - [x] Add logging and error handling

Phase 4: Testing & Integration
1. Unit Tests
    [x] URL extraction integration tests ✅
    [x] Link validation tests ✅
    [x] Alternative suggestion tests:
        - [x] Test weighted similarity calculation
        - [x] Test context processing
        - [x] Test embedding caching
        - [x] Test rate limiting
    [x] Report generation tests ✅
    [x] New API endpoint tests: ✅
        - [x] Test project-specific report generation
        - [x] Test batch fix functionality
        - [x] Test single link fix
        - [x] Test manual override
        - [x] Test error handling
        - [x] Test validation rules

2. Integration Tests
    [x] End-to-end flow tests ✅
    [x] Performance tests for batch processing ✅
    [x] API endpoint tests ✅
    [x] Rate limiting and concurrency tests ✅

Key Implementation Notes:
- Reuse existing Rust-based URL extraction
- Leverage existing batch processing infrastructure
- Integrate with current URL validation system
- Use existing caching mechanisms
- Hook into URLTrace system for status tracking

Recent Implementations:
1. Link Validation System ✅
   - Robust HTTP request handling with configurable retries
   - Automatic redirect detection and classification
   - Comprehensive error mapping and status codes
   - Detailed logging for debugging
   - Database status updates with timestamps
   - Batch processing with rate limiting
   - Progress tracking and status updates

2. Alternative URL Suggestion System ✅
   - Wayback Machine integration with caching
   - Similarity-based matching using existing search functions
   - Advanced AI-based matching with OpenAI embeddings
   - Weighted context processing for better relevance
   - Result deduplication and scoring
   - Configurable thresholds and weights
   - Rate limiting for API calls

Next Steps (Priority Order):
1. Complete Context-Based Matching
   - Implement semantic path analysis
   - Add domain-specific preprocessing
   - Support custom similarity metrics
   - Add content-based fallback matching
2. Add Export Functionality
   - Design export format (CSV/JSON)
   - Add export endpoint
   - Support filtering in exports
3. Enhance Reporting
   - Add trend analysis
   - Add domain grouping
   - Add status change history

Usage Examples:
```typescript
const service = new LinkManagementService(supabase, {
  projectId: 123,
  batchSize: 50,
  maxRetries: 3,
  rateLimit: {
    maxRequestsPerMinute: 300,        // Max 300 requests per minute
    delayBetweenBatches: 2000,       // 2 second delay between batches
    requestsPerBatch: 10             // Process 10 requests concurrently
  }
});

const alternativeService = new AlternativeUrlService(supabase, {
  projectId: 123,
  maxResults: 10,
  minSimilarityScore: 0.7,
  useWaybackMachine: true,
  useSimilarityMatching: true,
  useAIMatching: true,
  openAIConfig: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
    dimensions: 1536
  },
  contextWeights: {
    url: 0.5,      // URL similarity weight
    title: 0.3,    // Title similarity weight
    description: 0.2 // Description similarity weight
  }
});
```