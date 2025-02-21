import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { Database } from '../supabase_types';
import { logger } from '../lib/logger';
import { WebCrawler } from '../scraper/WebScraper/crawler';
import { supabase_service } from '../services/supabase';

// Load environment variables
config();

// Add environment variables check
const requiredEnvVars = [
  'SUPABASE_URL', 
  'SUPABASE_SERVICE_TOKEN',
  'OPENAI_API_KEY'
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Test configuration
const TEST_PROJECT_ID = 1;
const TEST_JOB_ID = `test-job-${Date.now()}`;

// Test URLs with known status - using Node.js docs which have stable URL patterns
const TEST_URLS = [
  {
    url: 'https://www.example.com/docs/v1',
    expectedStatus: 404,
    expectedAlternative: '/docs'
  },
  {
    url: 'https://www.example.com/api/v1',
    expectedStatus: 404,
    expectedAlternative: '/api'
  },
  {
    url: 'https://www.example.com/docs',
    expectedStatus: 200,
    isAlternative: true
  },
  {
    url: 'https://www.example.com/api',
    expectedStatus: 200,
    isAlternative: true
  },
  {
    url: 'https://www.example.com',
    expectedStatus: 200,
    isAlternative: false
  }
];

// Helper function to create test HTML
function createTestHtml(url: string): string {
  // Create HTML with links to test URLs - use www prefix consistently
  return `
    <html>
      <body>
        <h1>Test Page</h1>
        <a href="${url}" title="Main test link">Test Link</a>
        <a href="https://www.example.com/docs" title="Documentation">Docs</a>
        <a href="https://www.example.com/api" title="API Reference">API</a>
        <a href="https://www.example.com" title="Home">Home</a>
      </body>
    </html>
  `;
}

// Helper function to print test results
function printTestResults(title: string, data: any) {
  console.log('\n=== TEST RESULTS: ' + title + ' ===');
  console.log(JSON.stringify(data, null, 2));
  console.log('=== END TEST RESULTS ===\n');
}

// Helper function to get working URLs
function getWorkingUrls(): string[] {
  return TEST_URLS
    .filter(testUrl => testUrl.expectedStatus === 200)
    .map(testUrl => testUrl.url);
}

// Helper function to get broken URLs
function getBrokenUrls(): string[] {
  return TEST_URLS
    .filter(testUrl => testUrl.expectedStatus === 404)
    .map(testUrl => testUrl.url);
}

// Helper function to clean up test data
async function cleanupTestData() {
  await supabase_service
    .from('links')
    .delete()
    .eq('project_id', TEST_PROJECT_ID);
}

// Helper function to add a working URL to the database
async function addWorkingUrl(url: string) {
  logger.info(`Adding working URL: ${url}`);
  
  try {
    const { error } = await supabase_service
      .from("links")
      .upsert([{
        project_id: TEST_PROJECT_ID,
        page_url: url,
        extracted_link: url,
        status_code: 200,
        is_internal: true,
        last_checked: new Date().toISOString()
      }], {
        onConflict: "project_id,page_url,extracted_link"
      });

    if (error) {
      logger.error(`Failed to insert working URL ${url}:`, error);
    } else {
      logger.info(`Successfully added working URL: ${url}`);
    }
  } catch (error) {
    logger.error(`Error adding working URL ${url}:`, error);
  }
}

// Helper function to process a test URL
async function processTestUrl(url: string) {
  try {
    // Initialize crawler with link validation enabled
    const crawler = new WebCrawler({
      jobId: TEST_JOB_ID,
      initialUrl: url,
      projectId: TEST_PROJECT_ID,
      validateLinks: true, // This triggers the crawler's built-in LinkManagementService
      allowExternalContentLinks: true,
      maxCrawledLinks: 10,
      allowSubdomains: true,
      allowBackwardCrawling: true,
      ignoreRobotsTxt: true,
      includes: [],
      excludes: [],
      limit: 10
    });

    // Use crawler to process the URL
    console.log(`\n🔍 Processing URL: ${url}`);
    const html = createTestHtml(url);
    
    // Extract links using crawler's built-in link management
    console.log('Extracting and validating links...');
    const extractedLinks = await crawler.extractLinksFromHTML(html, url);
    console.log(`Extracted ${extractedLinks.length} links`);

    // Wait for link validation to complete
    console.log('Waiting for link validation...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get validation results
    const { data: validatedLinks, error } = await supabase_service
      .from('links')
      .select('*')
      .eq('project_id', TEST_PROJECT_ID)
      .eq('page_url', url);

    if (error) {
      console.error('Failed to fetch validation results:', error);
      return;
    }

    // Print validation results
    printTestResults(`Link Validation Results for ${url}`, {
      url,
      totalValidated: validatedLinks?.length || 0,
      validatedLinks: validatedLinks?.map(link => ({
        extractedLink: link.extracted_link,
        statusCode: link.status_code,
        isInternal: link.is_internal,
        suggestedAlternative: link.suggested_alternative,
        lastChecked: link.last_checked,
        anchorText: link.anchor_text
      }))
    });

    // Wait for alternatives to be processed
    console.log('\n⏳ Waiting for alternative URL suggestions...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check for alternatives
    const { data: alternatives, error: altError } = await supabase_service
      .from('links')
      .select('*')
      .eq('project_id', TEST_PROJECT_ID)
      .eq('status_code', 404)
      .not('suggested_alternative', 'is', null);

    if (altError) {
      console.error('Failed to fetch alternatives:', altError);
      return;
    }

    printTestResults(`Alternative URLs Found`, {
      totalAlternatives: alternatives?.length || 0,
      alternatives: alternatives?.map(alt => ({
        brokenUrl: alt.extracted_link,
        suggestedAlternative: alt.suggested_alternative,
        confidence: alt.similarity_score
      }))
    });

  } catch (error) {
    console.error(`Error processing URL ${url}:`, error);
  }
}

async function runTest() {
  console.log("\n🚀 Starting crawler link management integration tests\n");

  // Clean up any existing test data
  console.log("Cleaning up existing test data...");
  await cleanupTestData();

  // Add working URLs to database FIRST
  console.log("\n📌 Adding working URLs to database");
  const workingUrls = getWorkingUrls();
  for (const url of workingUrls) {
    console.log(`Adding working URL: ${url}`);
    await addWorkingUrl(url);
  }

  // Wait longer for working URLs to be indexed
  console.log("\n⏳ Waiting for working URLs to be indexed...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Process test URLs
  console.log("\n📌 Processing test URLs");
  const brokenUrls = getBrokenUrls();
  for (const url of brokenUrls) {
    console.log(`\n🔍 Processing URL: ${url}`);
    await processTestUrl(url);
    // Add delay between processing URLs
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Wait longer for alternatives to be processed
  console.log('\n⏳ Waiting for alternatives to be processed...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Generate final broken links report
  console.log('\n📊 Generating final broken links report...');
  const { data: brokenLinks, error: reportError } = await supabase_service
    .from('links')
    .select('*')
    .eq('project_id', TEST_PROJECT_ID)
    .in('status_code', [403, 404, 408, 500, 502, 503, 504]);

  if (reportError) {
    throw reportError;
  }

  // Group broken links by status code
  const brokenLinksByStatus = (brokenLinks || []).reduce((acc, link) => {
    const status = link.status_code || 'unknown';
    acc[status] = acc[status] || [];
    acc[status].push({
      url: link.extracted_link,
      pageUrl: link.page_url,
      suggestedAlternative: link.suggested_alternative,
      anchorText: link.anchor_text,
      lastChecked: link.last_checked
    });
    return acc;
  }, {} as Record<string | number, any[]>);

  // Print final report
  printTestResults('Final Broken Links Report', {
    totalBrokenLinks: brokenLinks?.length || 0,
    byStatusCode: brokenLinksByStatus,
    alternativesFound: brokenLinks?.filter(l => l.suggested_alternative)?.length || 0,
    alternativeDetails: brokenLinks
      ?.filter(l => l.suggested_alternative)
      ?.map(l => ({
        brokenUrl: l.extracted_link,
        suggestedAlternative: l.suggested_alternative,
        statusCode: l.status_code,
        anchorText: l.anchor_text
      }))
  });

  // Clean up test data
  console.log('\n🧹 Cleaning up test data...');
  await supabase_service
    .from('links')
    .delete()
    .eq('project_id', TEST_PROJECT_ID);

  console.log('\n✨ All tests completed successfully\n');
}

// Run the tests
if (require.main === module) {
  runTest().catch(console.error);
} 