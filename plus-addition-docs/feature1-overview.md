Primary Language: TypeScript
Web Framework: NestJS
HTTP Requests: axios/existing functionality
HTML Parsing: cheerio/existing functionality
Database: Supabase

1. Extract & Store Links from Crawled Pages
Goal: Efficiently extract all URLs from crawled HTML pages and store them for link checking.
Try to use existing URL extraction functionality first. Check @extract/url-processor.ts @extraction-service.ts. If it's not good enough, then we will implement our own that follows the steps below:
Steps:
Extract URLs:
Parse each crawled page 
Extract absolute URLs (convert relative URLs).
Store internal and external links separately.
Store URLs in Supabase:

Store extracted URLs in Supabase.
Schema Example:
sql
Copy
Edit
CREATE TABLE links (
    id SERIAL PRIMARY KEY,
    page_url TEXT NOT NULL,
    extracted_link TEXT NOT NULL,
    status_code INT,
    last_checked TIMESTAMP,
    suggested_alternative TEXT
);
Asynchronous URL Processing:

Use aiohttp or httpx for asynchronous requests to check URLs quickly.
Batch URLs into groups of 50-100 for efficiency.

2. Check for Broken Links
Quickly identify broken links based on HTTP response codes.
Categorize Response Codes:
200 OK → Valid
403 Forbidden → Possible block (retry later)
404 Not Found → Broken Link
500+ Errors → Temporary server error (retry later)
Retry Mechanism:
Retry 3 times for temporary errors (403, 500).
If still broken, mark as permanently broken.
Store Results in Database:
Update status_code and last_checked in the database.
If broken, proceed to the suggest alternative URL step.

3. Suggest Alternative Links for Broken URLs
Goal: Use archived pages, search engines, and AI-based similarity to recommend alternative URLs.
a. Archive Lookup (Wayback Machine API)
API Endpoint: https://archive.org/wayback/available?url={URL}
b. Google/Bing API (try to see if we can use existing search functionality first)

3. Option 3: AI-Based Similarity Matching (Pre-Trained Models Only)
Pre-trained Models for Text Similarity:
OpenAI Embeddings (text-embedding-ada-002) – Faster and easy to integrate
Workflow:
✅ Extract anchor text of the broken link (e.g., <a href="#">Learn More</a> → "Learn More")
✅ Compare this text with the titles of other URLs in your dataset.
✅ Return the most similar URL as a replacement.

4. Generate Broken Link Reports
Goal: Provide a comprehensive report of detected broken links and suggestions.
Steps:
Collect Broken Links:
Query all URLs from the database where status_code != 200.
Format Report:
Include:
Original URL
Source Page (where the broken link was found)
Status Code
Suggested Alternative (if available)
Export Formats:
Display the report in the FireCrawl dashboard using a simple table.
Allow users to export the report as CSV or JSON.
API Endpoint for Reports:
Create an API route /api/reports/broken-links to return the report in JSON format.
Example JSON Output:
{
    "broken_links": [
        {
            "source_page": "https://example.com/articles",
            "broken_url": "https://oldblog.com/article1",
            "status_code": 404,
            "suggested_alternative": "https://archive.org/web/oldblog.com/article1"
        },
        {
            "source_page": "https://example.com/resources",
            "broken_url": "https://resourcehub.com/file.pdf",
            "status_code": 403,
            "suggested_alternative": "https://resourcehub.com/file-replacement.pdf"
        }
    ]
}
5. Dashboard Integration & User Interaction
Goal: Allow users to view and interact with broken link reports in FireCrawl’s dashboard.

Frontend Changes (NestJS):
✅ Display broken links in a sortable, filterable table.
✅ Allow users to:
View the page where the link was found.
See the broken URL and HTTP status.
Click on alternative suggestions (open in new tab).
Override AI suggestions by manually entering a new URL.
Backend API (FastAPI or Flask):
✅ Add an API endpoint /api/links/broken to fetch all broken links.
✅ Add an API route /api/links/fix to accept user-provided replacements.

Supabase Database Tables (Summary):
1. links (Stores extracted links & status)
CREATE TABLE links (
    id SERIAL PRIMARY KEY,
    page_url TEXT NOT NULL,
    extracted_link TEXT NOT NULL,
    status_code INT,
    last_checked TIMESTAMP,
    suggested_alternative TEXT,
    manual_override TEXT
);
2. link_history (Tracks link status over time)
CREATE TABLE link_history (
    id SERIAL PRIMARY KEY,
    link_id INT REFERENCES links(id),
    checked_at TIMESTAMP,
    status_code INT
);