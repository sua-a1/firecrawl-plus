import "dotenv/config";
import axios from "axios";
import { logger } from "../lib/logger";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3002/v1";
const API_KEY = process.env.API_KEY || "test_key";
const TEST_PROJECT_ID = process.env.TEST_PROJECT_ID || "1";

async function checkServerHealth(): Promise<boolean> {
  try {
    await axios.get(API_BASE_URL);
    return true;
  } catch (error) {
    logger.error('Server health check failed. Is the server running?', {
      url: API_BASE_URL,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return false;
  }
}

async function makeRequest(endpoint: string, method: 'GET' | 'POST', data?: any) {
  try {
    logger.debug('Making API request', {
      method,
      endpoint,
      timeout: 60000
    });
    
    const response = await axios({
      method,
      url: `${API_BASE_URL}${endpoint}`,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      data,
      timeout: 60000, // 60 second timeout
    });
    return response.data;
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      logger.error('Connection refused. Is the server running?', {
        url: `${API_BASE_URL}${endpoint}`
      });
    } else {
      logger.error('Request failed', {
        endpoint,
        status: error.response?.status,
        error: error.response?.data || error.message
      });
    }
    throw error;
  }
}

async function testGetSummary(pageUrl: string) {
  logger.info('Testing GET /summaries/:page_url');
  
  try {
    const response = await makeRequest(`/summaries/${encodeURIComponent(pageUrl)}`, 'GET');
    logger.info('Get summary response:', { response });
    return response;
  } catch (error) {
    logger.error('Get summary failed', { error });
    throw error;
  }
}

async function testGenerateSummary(url: string, text: string) {
  logger.info('Testing POST /summaries/generate');
  
  try {
    const data = {
      url,
      text,
      type: 'both',
      maxLength: 150,
      minLength: 50,
      options: {
        temperature: 0.3,
        extractiveSummarizer: 'transformers'
      }
    };
    
    const response = await makeRequest('/summaries/generate', 'POST', data);
    logger.info('Generate summary response:', { response });
    return response;
  } catch (error) {
    logger.error('Generate summary failed', { error });
    throw error;
  }
}

async function testBatchGetSummaries(urls: string[]) {
  logger.info('Testing GET /summaries/batch');
  
  try {
    const queryString = `urls=${encodeURIComponent(JSON.stringify(urls))}`;
    const response = await makeRequest(`/summaries/batch?${queryString}`, 'GET');
    logger.info('Batch get summaries response:', { response });
    return response;
  } catch (error) {
    logger.error('Batch get summaries failed', { error });
    throw error;
  }
}

async function testBulkGenerateSummaries(urls: string[]) {
  logger.info('Testing POST /summaries/bulk');
  
  try {
    const data = {
      urls,
      type: 'both',
      options: {
        temperature: 0.3,
        extractiveSummarizer: 'transformers'
      }
    };
    
    const response = await makeRequest('/summaries/bulk', 'POST', data);
    logger.info('Bulk generate summaries response:', { response });
    return response;
  } catch (error) {
    logger.error('Bulk generate summaries failed', { error });
    throw error;
  }
}

async function runTests() {
  try {
    // Check if server is running first
    const isServerHealthy = await checkServerHealth();
    if (!isServerHealthy) {
      logger.error('Server is not running. Please start the server first.');
      logger.info('You can start the server with: npm run dev');
      process.exit(1);
    }

    // Validate environment
    if (API_KEY === 'test_key') {
      logger.warn('Using default API key. Set API_KEY environment variable for production testing.');
    }

    // Test data
    const testUrl = 'https://example.com/test-page';
    const testText = `
      This is a test article that needs to be summarized. It contains multiple sentences
      and paragraphs to test the summarization capabilities. The summary should capture
      the main points while maintaining coherence and readability. We want to ensure
      that both extractive and abstractive summarization work correctly.
    `.trim(); // Trim whitespace

    const testUrls = [
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3'
    ];

    // Run tests sequentially
    logger.info('Starting summarization endpoint tests...', {
      apiUrl: API_BASE_URL,
      testProjectId: TEST_PROJECT_ID
    });

    // Test 1: Generate a new summary
    const generatedSummary = await testGenerateSummary(testUrl, testText);
    
    // Test 2: Get the generated summary
    const retrievedSummary = await testGetSummary(testUrl);
    
    // Test 3: Test batch retrieval
    const batchSummaries = await testBatchGetSummaries(testUrls);
    
    // Test 4: Test bulk generation
    const bulkSummaries = await testBulkGenerateSummaries(testUrls);

    logger.info('All tests completed successfully!');
    
    return {
      generatedSummary,
      retrievedSummary,
      batchSummaries,
      bulkSummaries
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Test suite failed', {
        error: error.message,
        stack: error.stack
      });
    } else {
      logger.error('Test suite failed with unknown error', { error });
    }
    process.exit(1);
  }
}

// Run the tests
if (require.main === module) {
  runTests();
}

export {
  testGetSummary,
  testGenerateSummary,
  testBatchGetSummaries,
  testBulkGenerateSummaries,
  runTests
}; 