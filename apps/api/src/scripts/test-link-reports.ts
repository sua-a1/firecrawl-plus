import { supabase_service } from '../services/supabase';
import { logger } from '../lib/logger';
import axios from 'axios';
import dotenv from 'dotenv';
import { EventSource } from 'eventsource';

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3002/v1';
const API_KEY = process.env.API_KEY || 'test_key';
const PROJECT_ID = Number(process.env.TEST_PROJECT_ID || '1');

// Log configuration
logger.info('Test configuration', {
  API_BASE_URL,
  PROJECT_ID,
  hasApiKey: !!API_KEY
});

// Helper function to make authenticated API calls
async function makeRequest(endpoint: string, method: 'GET' | 'POST' | 'PUT', data?: any) {
  const url = `${API_BASE_URL}${endpoint}`;
  logger.info(`API Request: ${method} ${endpoint}`, {
    method,
    url,
    requestData: data,
    projectId: PROJECT_ID
  });

  try {
    const response = await axios({
      method,
      url,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      data,
      validateStatus: null // Allow any status code for debugging
    });

    // Log raw response data
    console.log('\n=== COMPLETE API RESPONSE ===');
    console.log('URL:', response.config.url);
    console.log('Method:', response.config.method);
    console.log('Status:', response.status, response.statusText);
    console.log('\nRequest Headers:', JSON.stringify(response.config.headers, null, 2));
    console.log('\nRequest Data:', JSON.stringify(response.config.data, null, 2));
    console.log('\nResponse Headers:', JSON.stringify(response.headers, null, 2));
    console.log('\nResponse Data:', JSON.stringify(response.data, null, 2));
    console.log('=== END RESPONSE ===\n');

    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}: ${JSON.stringify(response.data)}`);
    }

    return response.data;
  } catch (error: any) {
    // Log complete error details
    console.log('\n=== COMPLETE API ERROR ===');
    console.log('Error Message:', error.message);
    if (error.response) {
      console.log('Status:', error.response.status, error.response.statusText);
      console.log('\nResponse Headers:', JSON.stringify(error.response.headers, null, 2));
      console.log('\nResponse Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('\nRequest Config:', {
      url: error.config?.url,
      method: error.config?.method,
      data: error.config?.data
    });
    console.log('=== END ERROR ===\n');
    
    throw error;
  }
}

// Test functions
async function testGetBrokenLinksReport(options: {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
  format?: 'json' | 'csv';
} = {}) {
  const params = new URLSearchParams();
  if (options.sortBy) params.append('sort_by', options.sortBy);
  if (options.sortOrder) params.append('sort_order', options.sortOrder);
  if (options.page) params.append('page', options.page.toString());
  if (options.perPage) params.append('per_page', options.perPage.toString());
  if (options.format) params.append('format', options.format);

  logger.info('Testing broken links report', {
    endpoint: `/links/broken/${PROJECT_ID}`,
    options,
    params: params.toString(),
    projectId: PROJECT_ID
  });
  
  try {
    const report = await makeRequest(
      `/links/broken/${PROJECT_ID}?${params.toString()}`,
      'GET'
    );
    
    logger.info('Broken links report details', {
      totalLinks: report.total_count,
      returnedLinks: options.format === 'csv' ? 'CSV format' : report.broken_links.length,
      projectId: options.format === 'csv' ? PROJECT_ID : report.project_id,
      options,
      format: options.format || 'json',
      report: options.format === 'csv' ? 'CSV data' : report // Don't log CSV data
    });
    
    return report;
  } catch (error) {
    logger.error('Failed to get broken links report', { 
      error, 
      options,
      projectId: PROJECT_ID
    });
    throw error;
  }
}

let testLinkId: number | null = null;

async function createTestData() {
  logger.info('Creating test data');
  
  const timestamp = Date.now();
  const testData = {
    project_id: PROJECT_ID,
    page_url: `https://example.com/page-${timestamp}`,
    extracted_link: `https://example.com/old-link-${timestamp}`,
    status_code: 404,
    last_checked: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  logger.info('Inserting test link', { 
    testData,
    projectId: PROJECT_ID 
  });

  const { data: link, error } = await supabase_service
    .from('links')
    .insert(testData)
    .select()
    .single();

  if (error) {
    logger.error('Failed to create test data', { error, testData });
    throw error;
  }

  testLinkId = link.id;
  logger.info('Created test link', { 
    linkId: testLinkId,
    link,
    testData,
    projectId: PROJECT_ID
  });

  // Verify the link was created
  const { data: verifyLink, error: verifyError } = await supabase_service
    .from('links')
    .select('*')
    .eq('id', testLinkId)
    .eq('project_id', PROJECT_ID)
    .single();

  if (verifyError) {
    logger.error('Failed to verify test link', { 
      verifyError, 
      testLinkId,
      projectId: PROJECT_ID 
    });
    throw verifyError;
  }

  logger.info('Verified test link exists', { 
    verifyLink,
    projectId: PROJECT_ID
  });

  // Add a delay to ensure the link is indexed
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function testSingleFix() {
  logger.info('Testing single fix', {
    endpoint: `/links/fix/${testLinkId}`,
    projectId: PROJECT_ID,
    linkId: testLinkId
  });
  
  if (!testLinkId) {
    throw new Error('No test link ID available');
  }

  try {
    // First get the broken link details
    const report = await makeRequest(
      `/links/broken/${PROJECT_ID}`,
      'GET'
    );

    if (!report.broken_links.length) {
      logger.info('No broken links available for fix', {
        report,
        projectId: PROJECT_ID
      });
      return;
    }

    // Find our test link
    const testLink = report.broken_links.find(link => link.id === testLinkId);
    if (!testLink) {
      logger.info('Test link not found in broken links', {
        testLinkId,
        availableLinks: report.broken_links.map(l => ({
          id: l.id,
          url: l.broken_url,
          status: l.status_code
        })),
        report
      });
      return;
    }

    logger.info('Found test link', {
      linkId: testLinkId,
      link: testLink,
      report
    });

    // Apply the manual override with correct request body structure
    const response = await makeRequest(
      `/links/fix/${testLinkId}`,
      'POST',
      {
        manual_override_url: 'https://example.com/fixed-url',
        project_id: PROJECT_ID
      }
    );

    // Verify the update
    const verifyReport = await makeRequest(
      `/links/broken/${PROJECT_ID}`,
      'GET'
    );

    const updatedLink = verifyReport.broken_links.find(link => link.id === testLinkId);
    
    logger.info('Manual override result', { 
      success: response.success,
      linkId: testLinkId,
      originalUrl: testLink.broken_url,
      newUrl: 'https://example.com/fixed-url',
      response,
      linkStillBroken: !!updatedLink
    });

    return response;
  } catch (error) {
    logger.error('Failed to apply manual override', {
      error,
      linkId: testLinkId,
      requestBody: {
        manual_override_url: 'https://example.com/fixed-url',
        project_id: PROJECT_ID
      }
    });
    throw error;
  }
}

async function testBatchFix() {
  logger.info('Testing batch fix', {
    endpoint: '/links/fix/batch',
    projectId: PROJECT_ID
  });

  try {
    // First get current broken links count
    const initialReport = await makeRequest(
      `/links/broken/${PROJECT_ID}`,
      'GET'
    );

    const initialCount = initialReport.total_count;
    logger.info('Initial broken links count', { 
      count: initialCount,
      projectId: PROJECT_ID
    });

    // Apply batch fix
    const response = await makeRequest(
      '/links/fix/batch',
      'POST',
      {
        project_id: PROJECT_ID
      }
    );

    // Verify the update
    const verifyReport = await makeRequest(
      `/links/broken/${PROJECT_ID}`,
      'GET'
    );

    logger.info('Batch fix result', {
      success: response.success,
      processed: response.processed,
      skipped: response.skipped,
      total: response.total,
      initialCount,
      remainingCount: verifyReport.total_count,
      response
    });

    return response;
  } catch (error) {
    logger.error('Failed to apply batch fix', {
      error,
      projectId: PROJECT_ID
    });
    throw error;
  }
}

// Main test runner
async function runTests() {
  try {
    logger.info('Starting link reports API tests');

    // Create test data
    await createTestData();

    // Test pagination and sorting
    const reports = await Promise.all([
      // Default report (JSON)
      testGetBrokenLinksReport(),
      // Sorted by last checked, newest first
      testGetBrokenLinksReport({
        sortBy: 'last_checked',
        sortOrder: 'desc'
      }),
      // Second page with custom page size
      testGetBrokenLinksReport({
        page: 2,
        perPage: 25
      }),
      // CSV format
      testGetBrokenLinksReport({
        format: 'csv'
      })
    ]);

    const firstReport = reports[0];
    logger.info('First report details', {
      totalLinks: firstReport.total_count,
      brokenLinks: firstReport.broken_links,
      fullReport: firstReport
    });

    if (firstReport.broken_links.length > 0) {
      // Test single fix with progress tracking
      await testSingleFix();

      // Test batch fix
      await testBatchFix();
    } else {
      logger.info('No broken links found to test fix operations', {
        firstReport
      });
    }

    logger.info('All tests completed successfully');
  } catch (error) {
    logger.error('Test suite failed', { error });
    process.exit(1);
  }
}

// Run the tests
if (require.main === module) {
  runTests().catch(console.error);
} 