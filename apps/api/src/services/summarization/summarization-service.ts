import { pipeline, env, AutoTokenizer } from '@xenova/transformers';
import type { Pipeline, SummarizationPipeline, SummarizationOutput } from '@xenova/transformers';
import OpenAI from 'openai';
import { logger } from '../../lib/logger';
import { truncateText } from '../../scraper/scrapeURL/transformers/llmExtract';
import { SummarizerManager } from 'node-summarizer';

// Configure Transformers.js to use WASM backend for better performance
env.useBrowserCache = false;
env.backends.onnx.wasm.numThreads = 4;
env.localModelPath = process.env.LOCAL_MODEL_PATH || './models';
env.cacheDir = process.env.MODEL_CACHE_DIR || './.cache';

// Model configuration
const BART_MODEL = 'Xenova/bart-large-cnn';
const FALLBACK_MODEL = 'Xenova/distilbart-cnn-6-6';

export type SummaryType = 'extractive' | 'abstractive' | 'both';
export type ExtractiveSummarizer = 'transformers' | 'textrank' | 'lexrank';

interface SummarizationOptions {
  maxLength?: number;
  minLength?: number;
  type: SummaryType;
  temperature?: number;
  modelName?: string;
  extractiveSummarizer?: ExtractiveSummarizer;
  fallbackStrategy?: 'textrank' | 'lexrank';
  // New transformer-specific options
  earlyStop?: boolean;
  noRepeatNgramSize?: number;
  numBeams?: number;
  useFallbackModel?: boolean;
}

interface TransformerPipeline {
  summarizer: SummarizationPipeline;
  tokenizer: AutoTokenizer;
}

interface SummarizationResult {
  generated_text: string;
}

export class SummarizationService {
  private openai: OpenAI;
  private extractivePipeline: TransformerPipeline | null = null;
  private fallbackPipeline: TransformerPipeline | null = null;
  private readonly logger = logger.child({ module: 'SummarizationService' });
  private summarizer: SummarizerManager;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.openai = new OpenAI();
    this.summarizer = new SummarizerManager();
    // Pre-warm the pipeline
    this.initializationPromise = this.prewarmPipeline();
  }

  /**
   * Pre-warm the pipeline by initializing it in the background
   */
  private async prewarmPipeline(): Promise<void> {
    try {
      this.logger.info('Pre-warming summarization pipeline...');
      await this.initializeExtractivePipeline(false);
      this.logger.info('Pipeline pre-warming completed successfully');
    } catch (error) {
      this.logger.error('Pipeline pre-warming failed', { error });
      // Don't throw - let the actual usage handle errors
    }
  }

  /**
   * Initialize the extractive summarization pipeline
   */
  private async initializeExtractivePipeline(useFallback: boolean = false): Promise<TransformerPipeline> {
    // Wait for any ongoing initialization
    if (this.initializationPromise) {
      await this.initializationPromise;
    }

    const targetPipeline = useFallback ? this.fallbackPipeline : this.extractivePipeline;
    const modelName = useFallback ? FALLBACK_MODEL : BART_MODEL;

    if (!targetPipeline) {
      this.logger.debug('Initializing extractive summarization pipeline', {
        model: modelName,
        isFallback: useFallback
      });

      try {
        // Initialize both pipeline and tokenizer with increased timeout
        const initPromise = Promise.all([
          pipeline('summarization', modelName, {
            quantized: true,
            revision: 'main'
          }),
          AutoTokenizer.from_pretrained(modelName)
        ]);

        const [summarizer, tokenizer] = await initPromise;

        const newPipeline = {
          summarizer,
          tokenizer
        };

        // Store the pipeline in the appropriate property
        if (useFallback) {
          this.fallbackPipeline = newPipeline;
        } else {
          this.extractivePipeline = newPipeline;
        }

        this.logger.info('Pipeline initialized successfully', {
          model: modelName,
          isFallback: useFallback
        });

        return newPipeline;
      } catch (error) {
        this.logger.error('Failed to initialize pipeline', {
          error,
          model: modelName,
          isFallback: useFallback
        });
        throw new Error(`Failed to initialize ${useFallback ? 'fallback' : 'primary'} pipeline: ${error.message}`);
      }
    }

    return targetPipeline;
  }

  /**
   * Generate a summary using TextRank algorithm
   */
  private async generateTextRankSummary(text: string, options: SummarizationOptions): Promise<string> {
    this.logger.debug('Generating TextRank summary', { textLength: text.length });
    
    try {
      const result = await this.summarizer.getSummaryByRank(text, {
        limit: options.maxLength || 3, // Number of sentences
        clean: true // Clean and normalize text
      });
      
      return result;
    } catch (error) {
      this.logger.error('Error generating TextRank summary', { error });
      throw error;
    }
  }

  /**
   * Generate a summary using LexRank algorithm
   */
  private async generateLexRankSummary(text: string, options: SummarizationOptions): Promise<string> {
    this.logger.debug('Generating LexRank summary', { textLength: text.length });
    
    try {
      const result = await this.summarizer.getSummaryByFrequency(text, {
        limit: options.maxLength || 3, // Number of sentences
        clean: true // Clean and normalize text
      });
      
      return result;
    } catch (error) {
      this.logger.error('Error generating LexRank summary', { error });
      throw error;
    }
  }

  /**
   * Generate an extractive summary with fallback mechanisms
   */
  private async generateExtractiveSummary(text: string, options: SummarizationOptions): Promise<string> {
    this.logger.debug('Generating extractive summary', { 
      textLength: text.length, 
      summarizer: options.extractiveSummarizer || 'transformers'
    });

    try {
      // Try primary summarizer first
      if (!options.extractiveSummarizer || options.extractiveSummarizer === 'transformers') {
        try {
          // Get the appropriate pipeline
          const { summarizer, tokenizer } = await this.initializeExtractivePipeline(options.useFallbackModel);

          // Truncate text based on model's max token length
          const modelMaxTokens = options.useFallbackModel ? 512 : 1024;
          const truncatedText = truncateText(text, modelMaxTokens);

          // Configure generation parameters
          const generateConfig = {
            max_length: options.maxLength || 150,
            min_length: options.minLength || 50,
            do_sample: false,
            early_stopping: options.earlyStop ?? true,
            no_repeat_ngram_size: options.noRepeatNgramSize ?? 3,
            num_beams: options.numBeams ?? 4,
            temperature: 1.0,
            top_k: 50,
            top_p: 0.95,
            // Remove bad_words_ids as it's not properly supported
          };

          // Generate summary
          const result = await summarizer(truncatedText, generateConfig);
          
          // Type assertion since we know the structure
          const summary = Array.isArray(result) 
            ? (result[0] as { summary_text: string }).summary_text
            : (result as { summary_text: string }).summary_text;

          this.logger.debug('Transformers.js summary generated', {
            inputLength: text.length,
            outputLength: summary.length,
            model: options.useFallbackModel ? FALLBACK_MODEL : BART_MODEL
          });

          return summary;
        } catch (error) {
          this.logger.warn('Primary model failed, attempting fallback model', { error });
          
          // If primary model failed and fallback wasn't already tried, attempt with fallback model
          if (!options.useFallbackModel) {
            return this.generateExtractiveSummary(text, { ...options, useFallbackModel: true });
          }
          
          this.logger.warn('Transformers.js summarization failed completely, falling back to node-summarizer', { error });
          // Fall through to node-summarizer fallback
        }
      }

      // Use specified fallback or TextRank as default
      const fallbackStrategy = options.fallbackStrategy || 'textrank';
      this.logger.debug('Using node-summarizer fallback', { strategy: fallbackStrategy });

      if (fallbackStrategy === 'lexrank') {
        return await this.generateLexRankSummary(text, options);
      } else {
        return await this.generateTextRankSummary(text, options);
      }
    } catch (error) {
      this.logger.error('All extractive summarization methods failed', { error });
      throw error;
    }
  }

  /**
   * Generate an abstractive summary using OpenAI
   */
  private async generateAbstractiveSummary(text: string, options: SummarizationOptions): Promise<string> {
    this.logger.debug('Generating abstractive summary', { textLength: text.length, options });

    try {
      // Calculate token limits and truncate if necessary
      const maxInputTokens = options.modelName?.includes('gpt-4') ? 6000 : 3000; // Conservative limits
      const truncatedText = truncateText(text, maxInputTokens);

      // Enhanced prompt engineering for better summaries
      const systemPrompt = `You are an expert summarizer with deep knowledge in creating concise, informative summaries. Follow these guidelines:

1. Maintain key information hierarchy
2. Preserve critical details and context
3. Ensure logical flow and coherence
4. Use clear, professional language
5. Focus on essential information
6. Maintain factual accuracy

Length: ${options.maxLength || 150} words
Style: Professional and concise
Format: Continuous text without bullet points`;

      const userPrompt = `Create a comprehensive summary of the following text, focusing on the main points and key insights. The summary should be self-contained and understandable without the original text:

${truncatedText}`;

      const completion = await this.openai.chat.completions.create({
        model: options.modelName || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: options.temperature || 0.3,
        max_tokens: Math.min(options.maxLength || 150, 500), // Ensure reasonable token limit
        presence_penalty: 0.1, // Slight penalty for repetition
        frequency_penalty: 0.1, // Slight penalty for frequent tokens
        top_p: 0.9 // Slightly reduce randomness while maintaining quality
      });

      const summary = completion.choices[0].message.content;
      
      if (!summary) {
        throw new Error('OpenAI returned empty summary');
      }

      this.logger.debug('Abstractive summary generated successfully', { 
        summaryLength: summary.length,
        inputLength: text.length,
        truncated: text.length !== truncatedText.length,
        modelUsed: options.modelName || 'gpt-4'
      });

      return summary;
    } catch (error) {
      // Enhanced error handling with specific error types
      if (error instanceof OpenAI.APIError) {
        this.logger.error('OpenAI API error during summary generation', {
          error: error.message,
          type: error.type,
          code: error.status
        });
        
        // Handle rate limits and token limits specifically
        if (error.status === 429) {
          throw new Error('Rate limit exceeded for OpenAI API');
        } else if (error.status === 400 && error.message.includes('token')) {
          throw new Error('Token limit exceeded for OpenAI API');
        }
      }

      this.logger.error('Error generating abstractive summary', { 
        error,
        textLength: text.length,
        options 
      });
      throw error;
    }
  }

  /**
   * Generate a summary based on the specified type
   */
  public async generateSummary(text: string, options: SummarizationOptions): Promise<{
    extractive_summary?: string;
    abstractive_summary?: string;
  }> {
    this.logger.info('Starting summary generation', { 
      type: options.type,
      textLength: text.length 
    });

    const result: { 
      extractive_summary?: string; 
      abstractive_summary?: string; 
    } = {};

    try {
      switch (options.type) {
        case 'extractive':
          result.extractive_summary = await this.generateExtractiveSummary(text, options);
          break;
        case 'abstractive':
          result.abstractive_summary = await this.generateAbstractiveSummary(text, options);
          break;
        case 'both':
          // Run both summaries in parallel for better performance
          const [extractive, abstractive] = await Promise.all([
            this.generateExtractiveSummary(text, options),
            this.generateAbstractiveSummary(text, options)
          ]);
          result.extractive_summary = extractive;
          result.abstractive_summary = abstractive;
          break;
      }

      this.logger.info('Summary generation completed successfully', { 
        type: options.type,
        hasExtractive: !!result.extractive_summary,
        hasAbstractive: !!result.abstractive_summary
      });

      return result;
    } catch (error) {
      this.logger.error('Error during summary generation', { error, type: options.type });
      throw error;
    }
  }
} 