import { WebCrawler } from '../scraper/WebScraper/crawler';
import { SummarizationService, SummaryType, ExtractiveSummarizer } from '../services/summarization/summarization-service';

interface CrawlerSummarizationOptions {
  enabled: boolean;
  type: SummaryType;
  maxLength?: number;
  minLength?: number;
  extractiveSummarizer?: ExtractiveSummarizer;
  temperature?: number;
  modelName?: string;
  fallbackStrategy?: 'textrank' | 'lexrank';
  earlyStop?: boolean;
  noRepeatNgramSize?: number;
  numBeams?: number;
  useFallbackModel?: boolean;
}

interface TestConfig {
  url: string;
  description: string;
  config: CrawlerSummarizationOptions;
}

// Test configuration
const TEST_PROJECT_ID = 1;
const TEST_JOB_ID = `test-job-${Date.now()}`;

// Test URLs with known content - using documentation sites and blogs with meaningful content
const TEST_URLS = [
  {
    url: 'https://docs.nestjs.com/first-steps',
    description: 'NestJS Documentation - First Steps',
    expectedContent: ['controllers', 'providers', 'modules']
  },
  {
    url: 'https://blog.supabase.com/introducing-vector',
    description: 'Supabase Blog - Vector Introduction',
    expectedContent: ['vector', 'embeddings', 'similarity search']
  },
  {
    url: 'https://docs.python.org/3/tutorial/introduction.html',
    description: 'Python Documentation - Introduction',
    expectedContent: ['python', 'programming', 'tutorial']
  },
  {
    url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
    description: 'TypeScript Handbook - Introduction',
    expectedContent: ['typescript', 'javascript', 'types']
  }
];

interface Summary {
  type: SummaryType;
  extractive_summary?: string;
  abstractive_summary?: string;
  created_at?: Date;
  success: boolean;
  error?: string;
}

const TEST_CONTENT: Record<string, string> = {
  'https://docs.nestjs.com/first-steps': 'NestJS is a framework for building efficient, scalable Node.js server-side applications...',
  'https://www.typescriptlang.org/docs/handbook/intro.html': 'TypeScript extends JavaScript by adding types to the language...',
  'https://docs.python.org/3/tutorial/introduction.html': 'Python is an easy to learn, powerful programming language...'
};

const TEST_CONFIGS: TestConfig[] = [
  {
    url: 'https://docs.nestjs.com/first-steps',
    description: 'NestJS Documentation',
    config: {
      enabled: true,
      type: 'both',
      maxLength: 500,
      minLength: 100,
      extractiveSummarizer: 'transformers',
      fallbackStrategy: 'textrank',
      temperature: 0.3,
      modelName: 'gpt-4'
    }
  },
  {
    url: 'https://blog.supabase.com/introducing-vector',
    description: 'Supabase Blog - Vector Introduction',
    config: {
      enabled: true,
      type: 'extractive',
      maxLength: 150,
      minLength: 50,
      extractiveSummarizer: 'transformers'
    }
  },
  {
    url: 'https://docs.python.org/3/tutorial/introduction.html',
    description: 'Python Documentation - Introduction',
    config: {
      enabled: true,
      type: 'abstractive',
      maxLength: 150,
      minLength: 50,
      temperature: 0.3,
      modelName: 'gpt-4'
    }
  },
  {
    url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
    description: 'TypeScript Handbook - Introduction',
    config: {
      enabled: true,
      type: 'both',
      maxLength: 200,
      minLength: 50,
      extractiveSummarizer: 'transformers',
      fallbackStrategy: 'textrank',
      temperature: 0.3,
      modelName: 'gpt-4'
    }
  }
];

// Helper function to create test HTML
function createTestHtml(url: string, content: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head><title>Test Page</title></head>
      <body>
        <article>
          <h1>Test Content from ${url}</h1>
          <p>${content}</p>
        </article>
      </body>
    </html>
  `;
}

// Helper function to print test results
function printTestResults(title: string, data: { 
  totalSummaries: number;
  summariesByUrl: Record<string, Summary[]>;
  successRate: { extractive: number; abstractive: number; both: number };
}) {
  console.log(`\n=== ${title} ===`);
  const report = {
    totalSummaries: data.totalSummaries,
    summariesByUrl: {} as Record<string, Summary[]>,
    successRate: data.successRate,
    failures: [] as string[]
  };

  for (const [url, summaries] of Object.entries(data.summariesByUrl)) {
    report.summariesByUrl[url] = summaries.map(summary => ({
      type: summary.type,
      extractive_summary: summary.extractive_summary,
      abstractive_summary: summary.abstractive_summary,
      created_at: summary.created_at,
      success: summary.success,
      error: summary.error
    }));

    // Track failures
    summaries.forEach(summary => {
      if (!summary.success) {
        report.failures.push(`${url}: ${summary.error}`);
      }
    });
  }

  // Only log failures if they exist
  if (report.failures.length > 0) {
    console.log('\nFailed Summaries:');
    report.failures.forEach(failure => console.log(`- ${failure}`));
  }

  // Print full summaries in the report
  console.log('\nGenerated Summaries:');
  for (const [url, summaries] of Object.entries(data.summariesByUrl)) {
    summaries.forEach(summary => {
      if (summary.success) {
        console.log(`\n${url}:`);
        if (summary.extractive_summary) {
          console.log('\nExtractive Summary:');
          console.log(summary.extractive_summary);
        }
        if (summary.abstractive_summary) {
          console.log('\nAbstractive Summary:');
          console.log(summary.abstractive_summary);
        }
      }
    });
  }

  console.log('\nFinal Report:', JSON.stringify(report, null, 2));
}

async function processTestUrl(testConfig: TestConfig): Promise<Summary> {
  const { url, config, description } = testConfig;
  console.log(`\nProcessing test URL: ${url}`);
  console.log(`Description: ${description}`);

  try {
    const testHtml = createTestHtml(url, TEST_CONTENT[url] || 'Test content');
    const crawler = new WebCrawler({
      jobId: 'test-job',
      initialUrl: url,
      projectId: 1,
      summarization: config
    });

    await crawler.processPage(url, testHtml);

    // Get summaries using SummaryService directly
    const summaryService = new SummarizationService();
    const summary = await summaryService.generateSummary(testHtml, config);

    return {
      type: config.type,
      extractive_summary: summary.extractive_summary,
      abstractive_summary: summary.abstractive_summary,
      created_at: new Date(),
      success: true
    };
  } catch (error) {
    console.error(`Failed to process ${url}:`, error.message);
    return {
      type: config.type,
      success: false,
      error: error.message
    };
  }
}

async function runTest() {
  try {
    console.log('Starting summarization tests...');

    const results = {
      totalSummaries: 0,
      summariesByUrl: {} as Record<string, Summary[]>,
      successRate: {
        extractive: 0,
        abstractive: 0,
        both: 0
      }
    };

    for (const testConfig of TEST_CONFIGS) {
      const summary = await processTestUrl(testConfig);
      
      if (!results.summariesByUrl[testConfig.url]) {
        results.summariesByUrl[testConfig.url] = [];
      }
      
      results.summariesByUrl[testConfig.url].push(summary);
      results.totalSummaries++;

      if (summary.success) {
        if (summary.extractive_summary) results.successRate.extractive++;
        if (summary.abstractive_summary) results.successRate.abstractive++;
        if (summary.extractive_summary && summary.abstractive_summary) results.successRate.both++;
      }
    }

    printTestResults('Final Summarization Report', results);
  } catch (error) {
    console.error('Test failed:', error.message);
  } finally {
    process.exit(0);
  }
}

// Run the tests
if (require.main === module) {
  runTest().catch(console.error);
}