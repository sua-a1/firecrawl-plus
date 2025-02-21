## **✅ Overview & Scope**

**Objective:** Automatically generate concise summaries of web pages after crawling, helping users quickly understand key insights.

* **Summarization Types:**  
  * **Extractive Summarization** (highlights key sentences from the text using Transformers.js and Sumy).  
  * **Abstractive Summarization** (rephrases the content into a shorter version using OpenAI).  
* **Integration:**  
  * The summarization process will be added to the existing **crawling pipeline**.  
  * Summaries will be stored in **Supabase** and accessible through **API endpoints**

---

## **🏗️ System Architecture**

1. **Content Extraction:**  
   * Fetch and parse web pages.  
   * Extract the **main textual content** using built-in text extraction or **cheerio**  
2. **Summarization Pipeline:**  
   * Primary Summarization Engine:
     * **Transformers.js** for high-quality extractive summarization
     * Leverages pre-trained models for better context understanding
     * TypeScript-native implementation
   * Fallback Engine:
     * **node-summarizer** for lightweight, fast summarization
     * Multiple algorithm support (TextRank, LexRank)
     * Used when performance is critical or as backup
   * Abstractive Summarization:
     * **OpenAI's GPT API** for human-like summaries
3. **Storage & API:**  
   * Store the **original text** and **summary** in **Supabase**.  
   * Expose a **REST API** for retrieving the summaries.  

---

## **💾 Database Schema**

Update **`supabase_types.ts`** to include a new table for storing summaries:

`CREATE TABLE page_summaries (`  
    `id SERIAL PRIMARY KEY,`  
    `project_id INT REFERENCES mendable_project(id),`  
    `page_url TEXT NOT NULL,`  
    `original_text TEXT NOT NULL,`  
    `extractive_summary TEXT,`  
    `abstractive_summary TEXT,`  
    `summary_type TEXT CHECK (summary_type IN ('extractive', 'abstractive')),`  
    `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`  
`);`

---

## **⚙️ Implementation Steps**

The example code snippets are only loose guidelines, and should NOT be copied exactly.

### **1\. Content Extraction**

* **File:** `src/scraper/scrapeURL.ts`  
* **Goal:** Enhance the `scrapeURL` function to extract the main textual content.  
* **Implementation:**

example:  
`export async function extractTextFromHTML(html: string): Promise<string> {`  
    `const $ = cheerio.load(html);`  
    `// Remove unwanted elements`  
    `$('script, style, nav, footer, header, aside').remove();`  
    `// Extract main content`  
    `return $('body').text().replace(/\s+/g, ' ').trim();`  
`}`

---

### **2\. Queue-Based Summarization**

* **File:** `src/services/queue-service.ts`  
* **Goal:** Use **BullMQ** to asynchronously process text summarization jobs.  
* **Implementation:**

example:  
`import { Queue } from 'bullmq';`  
`import { HybridSummarizer } from './summarizer-service';`

`export const summarizationQueue = new Queue('summarizationQueue');`

`summarizationQueue.process(async (job) => {`  
    `const { page_url, text } = job.data;`  
    `const summarizer = new HybridSummarizer();`  
    `return await summarizer.summarize(page_url, text);`  
`});`

---

### **3\. Summarization Service**

* **File:** `src/services/summarizer-service.ts`  
* **Goal:** Implement hybrid summarization using Transformers.js and Sumy.  
* **Implementation:**

example:  
`import { pipeline } from '@xenova/transformers';`  
`import { SumyService } from './sumy-service';`  
`import { OpenAIService } from './openai-service';`

`export class HybridSummarizer {`  
    `private transformerSummarizer: any;`  
    `private sumyFallback: SumyService;`  
    `private openai: OpenAIService;`

    `async summarize(page_url: string, text: string): Promise<SummaryResult> {`  
        `try {`  
            `// Try Transformers.js first`  
            `const extractiveSummary = await this.transformerSummarize(text);`  
            
            `// Abstractive Summary (Advanced)`  
            `const response = await this.openai.summarize(text);`  
            `const abstractiveSummary = response.choices[0].message?.content || '';`

            `return { extractiveSummary, abstractiveSummary };`  
        `} catch (error) {`  
            `// Fallback to Sumy if transformer fails`  
            `logger.warn('Transformer summarization failed, using Sumy fallback', { error });`  
            `const fallbackSummary = await this.sumyFallback.summarize(text);`  
            `return { extractiveSummary: fallbackSummary, abstractiveSummary: null };`  
        `}`  
    `}`  
`}`

---

### **4\. Database Service (Supabase Integration)**

* **File:** `src/services/supabase.ts`  
* **Goal:** Store summaries in the **`page_summaries`** table.  
* **Implementation:**

example:  
`import { supabase } from './supabase-client';`

`export async function saveSummaryToSupabase(`  
    `page_url: string,`   
    `original_text: string,`   
    `extractive_summary: string,`   
    `abstractive_summary: string | null`  
`) {`  
    `const { error } = await supabase.from('page_summaries').insert({`  
        `page_url,`  
        `original_text,`  
        `extractive_summary,`  
        `abstractive_summary,`  
        `summary_type: abstractive_summary ? 'both' : 'extractive'`  
    `});`  
    ``if (error) throw new Error(`Supabase Error: ${error.message}`);``  
`}`

---

### **5\. API Endpoints**

* **File:** `src/controllers/v1/summarize.ts`  
* **Goal:** Allow users to retrieve summaries via API.  
* **Implementation:**

example:  
`import { Request, Response } from 'express';`  
`import { supabase } from '../../services/supabase-client';`

`export async function getPageSummary(req: Request, res: Response) {`  
    `const { page_url } = req.params;`  
    `const { data, error } = await supabase.from('page_summaries').select('*').eq('page_url', page_url);`  
    `if (error) return res.status(500).send(error.message);`  
    `res.json(data);`  
`}`

---

### **6\. Route Configuration**

* **File:** `src/routes/v1.ts`  
* **Implementation:**

example:  
`import { Router } from 'express';`  
`import { getPageSummary } from '../controllers/v1/summarize';`

`const router = Router();`  
`router.get('/summaries/:page_url', getPageSummary);`

`export default router;`

---

### **7\. FireCrawl Dashboard Integration**

* **File:** `src/frontend/components/PageSummary.tsx`  
* **Goal:** Display page summaries in the **FireCrawl dashboard**.  
* **Implementation:**

example:  
`import React, { useState, useEffect } from 'react';`  
`import axios from 'axios';`

`export default function PageSummary({ pageUrl }) {`  
    `const [summary, setSummary] = useState(null);`

    `useEffect(() => {`  
        ``axios.get(`/api/v1/summaries/${encodeURIComponent(pageUrl)}`)``  
            `.then(response => setSummary(response.data))`  
            `.catch(console.error);`  
    `}, [pageUrl]);`

    `return (`  
        `<div className="summary-container">`  
            `<h3>Page Summary</h3>`  
            `{summary ? (`  
                `<div>`  
                    `<h4>Extractive Summary:</h4>`  
                    `<p>{summary.extractive_summary}</p>`  
                    `<h4>Abstractive Summary:</h4>`  
                    `<p>{summary.abstractive_summary}</p>`  
                `</div>`  
            `) : (`  
                `<p>Loading summary...</p>`  
            `)}`  
        `</div>`  
    `);`  
`}`


---

## **⚡ Performance Optimization**

* Use Transformers.js for quality, Sumy for speed when needed
* Cache generated summaries using **Redis** for faster access
* Process large pages asynchronously using **BullMQ** queues
* Implement intelligent fallback mechanisms
* Monitor and optimize API costs

