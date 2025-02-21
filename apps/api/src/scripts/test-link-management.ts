import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { Database } from '../supabase_types';
import { LinkManagementService } from '../services/link-management/link-management.service';
import { logger } from '../lib/logger';
import { indexPage } from '../lib/extract/index/pinecone';
import { Document } from '../controllers/v1/types';
import { Pinecone } from '@pinecone-database/pinecone';
import { searchSimilarPages } from '../lib/extract/index/pinecone';

type Link = Database['public']['Tables']['links']['Row'];

// Load environment variables
config();

// Add environment variables check
const requiredEnvVars = [
  'OPENAI_API_KEY', 
  'PINECONE_API_KEY',
  'SUPABASE_URL', 
  'SUPABASE_SERVICE_TOKEN'
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Safely assert environment variables after checking
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_TOKEN!;
const openAIKey = process.env.OPENAI_API_KEY!;
const pineconeKey = process.env.PINECONE_API_KEY!;

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: pineconeKey,
});

// Add debug logging for Pinecone operations
const pineconeLogger = console;
pineconeLogger.debug('Initializing Pinecone client...', {
  hasApiKey: !!pineconeKey
});

// Create Supabase client
const supabase = createClient<Database>(supabaseUrl, supabaseKey);

// Test configuration
const TEST_PROJECT_ID = 1;

// Test pages with real URLs and known 404s
const TEST_PAGES = [
  {
    url: 'https://github.com/cursor-ai',
    html: `
      <html>
        <head>
          <title>Cursor AI GitHub Organization</title>
          <meta name="description" content="Home of the Cursor AI project, featuring repositories for the Cursor editor and related tools.">
        </head>
        <body>
          <h1>Cursor AI GitHub Organization</h1>
          <p>Welcome to the Cursor AI GitHub organization. Here you'll find our open source projects and tools.</p>
          <div class="links">
            <a href="https://github.com/cursor-ai/cursor">Cursor Editor Repository</a>
            <a href="https://github.com/cursor-ai/nonexistent">404 Link</a>
            <a href="https://cursor.sh">Cursor Website</a>
          </div>
          <div class="content">
            <h2>About Cursor</h2>
            <p>Cursor is a next-generation text editor with AI capabilities, designed to help developers write better code faster.</p>
          </div>
        </body>
      </html>
    `,
    markdown: `
# Cursor AI GitHub Organization

Welcome to the Cursor AI GitHub organization. Here you'll find our open source projects and tools.

## Links
- [Cursor Editor Repository](https://github.com/cursor-ai/cursor)
- [404 Link](https://github.com/cursor-ai/nonexistent)
- [Cursor Website](https://cursor.sh)

## About Cursor
Cursor is a next-generation text editor with AI capabilities, designed to help developers write better code faster.
    `
  },
  {
    url: 'https://cursor.sh',
    html: `
      <html>
        <head>
          <title>Cursor - The AI-first Code Editor</title>
          <meta name="description" content="Cursor is an AI-first code editor that helps you write better code faster. Features include AI chat, code completion, and more.">
        </head>
        <body>
          <h1>Welcome to Cursor</h1>
          <p>The AI-powered development environment that helps you write better code faster.</p>
          <div class="links">
            <a href="https://docs.cursor.sh">Documentation</a>
            <a href="https://cursor.sh/old-page">404 Link</a>
            <a href="https://github.com/cursor-ai">GitHub</a>
          </div>
          <div class="features">
            <h2>Key Features</h2>
            <ul>
              <li>AI-powered code completion</li>
              <li>Intelligent code chat</li>
              <li>Advanced refactoring tools</li>
            </ul>
          </div>
        </body>
      </html>
    `,
    markdown: `
# Welcome to Cursor

The AI-powered development environment that helps you write better code faster.

## Links
- [Documentation](https://docs.cursor.sh)
- [404 Link](https://cursor.sh/old-page)
- [GitHub](https://github.com/cursor-ai)

## Key Features
- AI-powered code completion
- Intelligent code chat
- Advanced refactoring tools
    `
  }
];

// Create a test data source
async function createTestDataSource() {
  const testSourceId = `test-source-${Date.now()}`;
  
  const { data: existingSource, error: fetchError } = await supabase
    .from('data_sources')
    .select()
    .eq('name', 'test-source')
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    throw fetchError;
  }

  if (existingSource) {
    logger.info('Using existing test data source', { id: existingSource.id });
    return existingSource.id;
  }

  const { data: newSource, error: insertError } = await supabase
    .from('data_sources')
    .insert({
      id: testSourceId,
      name: 'test-source',
      type: 'test',
      description: 'Test data source for link management'
    })
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  logger.info('Created new test data source', { id: newSource.id });
  return newSource.id;
}

async function runTests() {
  try {
    // Create test data source
    const dataSourceId = await createTestDataSource();
    logger.info('Test data source ready', { dataSourceId });

    // Initialize services
    const linkManagementService = new LinkManagementService(supabase, {
      projectId: TEST_PROJECT_ID,
      allowExternalLinks: true,
      maxRetries: 3,
      batchSize: 10,
      alternativeUrlOptions: {
        useWaybackMachine: true,
        useSimilarityMatching: true,
        useAIMatching: true,
        openAIConfig: {
          apiKey: openAIKey,
          model: 'text-embedding-3-small'
        }
      }
    });

    // Test 1: Index test pages in Pinecone
    logger.info('Test 1: Index test pages in Pinecone');
    for (const testPage of TEST_PAGES) {
      const document: Document = {
        metadata: {
          url: testPage.url,
          sourceURL: testPage.url,
          title: testPage.url.includes('github') ? 
            'Cursor AI GitHub Organization' : 
            'Cursor - The AI-first Code Editor',
          description: testPage.url.includes('github') ?
            'Home of the Cursor AI project, featuring repositories for the Cursor editor and related tools.' :
            'Cursor is an AI-first code editor that helps you write better code faster. Features include AI chat, code completion, and more.',
          language: 'en',
          keywords: 'cursor, ai, code editor, development',
          robots: '',
          ogTitle: '',
          ogDescription: '',
          ogUrl: '',
          ogImage: '',
          ogSiteName: '',
          statusCode: 200,
          contentType: 'text/html',
          charset: 'utf-8',
          viewport: '',
          crawlId: 'test-crawl',
          teamId: 'test-team'
        },
        url: testPage.url,
        html: testPage.html,
        title: testPage.url.includes('github') ? 
          'Cursor AI GitHub Organization' : 
          'Cursor - The AI-first Code Editor',
        description: testPage.url.includes('github') ?
          'Home of the Cursor AI project, featuring repositories for the Cursor editor and related tools.' :
          'Cursor is an AI-first code editor that helps you write better code faster. Features include AI chat, code completion, and more.',
        links: [],
        markdown: testPage.markdown
      };

      await indexPage({
        document,
        originUrl: testPage.url,
        crawlId: 'test-crawl',
        teamId: 'test-team'
      });

      logger.info('Indexed test page', { 
        url: testPage.url,
        title: document.title,
        description: document.description
      });
    }

    // Test 2: Extract and store links
    logger.info('Test 2: Extract and store links');
    for (const testPage of TEST_PAGES) {
      // Create a source entry for the test page
      const { data: source, error: sourceError } = await supabase
        .from('source')
        .insert({
          content: testPage.html,
          link: testPage.url,
          message_id: 1 // Using a dummy message_id
        })
        .select()
        .single();

      if (sourceError) {
        throw sourceError;
      }

      const links = await linkManagementService.extractAndStoreLinks(
        testPage.url,
        testPage.html,
        source.id,
        dataSourceId
      );

      logger.info('Extracted and stored links', {
        pageUrl: testPage.url,
        linkCount: links.length,
        links: links.map(l => l.extracted_link)
      });
    }

    // Test 3: Validate links
    logger.info('Test 3: Validate links');
    const results = await linkManagementService.validateAllLinks();
    logger.info('Link validation results', {
      totalChecked: results.length,
      results: results.map(r => ({
        url: r.url,
        statusCode: r.statusCode,
        redirectUrl: r.redirectUrl
      }))
    });

    // Test 4: Find alternatives for broken links
    logger.info('Test 4: Find alternatives for broken links');
    await linkManagementService.findAlternativesForBrokenLinks();

    // Test 5: Get final results
    const brokenLinks = await linkManagementService.getBrokenLinks();
    logger.info('Final broken links with alternatives', {
      brokenLinks: brokenLinks.map(l => ({
        url: l.extracted_link,
        statusCode: l.status_code,
        alternative: l.suggested_alternative
      }))
    });

  } catch (error) {
    logger.error('Test failed', { error });
    throw error;
  }
}

// Run tests
runTests().catch(console.error);
