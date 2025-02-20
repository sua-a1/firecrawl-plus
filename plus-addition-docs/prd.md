# **FireCrawl AI Enhancements – Project Requirements Document**

## **Understand the Problem**

FireCrawl is a **scalable web crawling system** designed to extract structured data from the web. While it efficiently gathers data, it lacks **advanced AI-driven enhancements** that would make it easier for users to analyze, maintain, and extract meaningful insights from large datasets.

This project introduces **three AI-powered features** to enhance FireCrawl’s capabilities:

1. **AI-Powered "Broken Link Detector"** – Automatically detect broken links and suggest alternatives.  
2. **Automated Detection of Content Updates** – Identify significant changes in crawled pages and notify users.  
3. **AI-Powered Content Summarization** – Generate concise summaries of crawled content to improve data readability.

---

## **Key Components Needed**

### **1\. Broken Link Detection & Alternative Suggestions**

* Extract all URLs from crawled pages.  
* Check HTTP response codes for broken links (404, 403, 500).  
* Suggest alternative URLs using:  
  * **Archived versions** (via Wayback Machine API).  
  * **Search engine queries** for updated content.  
  * **AI-based similarity matching** with existing data.

### **2\. Content Update Detection**

* Store **historical snapshots** of crawled pages.  
* Compare new vs. previous versions using:  
  * **Text diffing algorithms** (e.g., Diff Match Patch).  
  * **AI-based importance scoring** (using BERT or SBERT embeddings).  
* Categorize changes into:  
  * **Minor (insignificant text changes).**  
  * **Major (new sections, removed content, title/meta updates).**  
* Notify users of significant updates via dashboard alerts.

### **3\. AI-Powered Content Summarization (Stretch Goal)**

* Extract key text content while filtering **boilerplate elements** (menus, ads, footers).  
* Apply AI-based summarization:  
  * **Extractive Summarization (TF-IDF, BERT-Summarizer).**  
  * **Abstractive Summarization (T5, Pegasus, GPT-4 API).**  
* Allow users to select summary length/detail level.

---

## **User Flow Overview**

### **User Story 1: Broken Link Detector**

1. **User initiates a crawl** of multiple websites.  
2. **FireCrawl scans extracted links** and detects:  
   * **404 (Not Found)**, **403 (Forbidden)**, or **500+ errors**.  
3. **For broken links**, FireCrawl:  
   * Queries **Wayback Machine** for archived versions.  
   * Searches for similar pages using **Google/Bing API**.  
   * Uses **AI embedding similarity matching** to find an alternative from the dataset.  
4. **User receives a report** of broken links with suggested fixes.

---

### **User Story 2: Content Update Detection**

1. FireCrawl **stores a snapshot** of a web page on first crawl.  
2. On subsequent crawls, FireCrawl:  
   * **Compares new vs. old versions** using a diff algorithm.  
   * **Scores changes based on importance** (e.g., slight wording changes vs. a major section rewrite).  
3. If a page **undergoes major changes**, FireCrawl:  
   * **Generates a “diff report”** highlighting differences.  
   * **Triggers a dashboard alert** (or an email notification, if configured).  
4. Users can review and export page change logs.

---

### **User Story 3: AI-Powered Summarization (Stretch Goal)**

1. User enables **AI-powered summarization** in FireCrawl settings.  
2. FireCrawl **processes extracted content**, removing clutter (navigation, ads).  
3. The AI model **generates concise summaries** of each crawled page.  
4. Summaries are:  
   * **Displayed in the FireCrawl dashboard** alongside original content.  
   * **Available via API calls** for integration into other applications.  
   * **Customizable** (short summary vs. detailed insights).

---

## **Architectural Building Blocks**

### **1\. Broken Link Detection System**

* **Crawl Engine Enhancements**  
  * Extract and check links asynchronously using `aiohttp`.  
* **Alternative Link Suggestions**  
  * Query **Wayback Machine API** for archived versions.  
  * Query **Google/Bing API** for alternatives.  
  * Use **SBERT-based embedding search** to find similar URLs.  
* **Alerting System**  
  * Broken links stored in Supabase/PostgreSQL for reporting.  
  * Alerts sent via **email**.

### **2\. Automated Content Update Detection**

* **Storage System**  
  * Store previous HTML versions in **Supabase**.  
* **Comparison Algorithm**  
  * Use **Diff Match Patch** for structural changes.  
  * Use **SBERT similarity matching** for AI-driven importance scoring.  
* **User Notifications**  
  * Trigger UI alerts or API responses when changes exceed a threshold.

### **3\. AI-Powered Summarization (Stretch Goal)**

* **Text Extraction**  
  * Use extraction & readability libraries to strip non-relevant content.  
* **Summarization Engine**  
  * Apply **extractive** (TF-IDF, BERT) and **abstractive** (T5, GPT) summarization.  
* **Storage & Output**  
  * Store summaries alongside crawled data in Supabase/PostgreSQL.  
  * Provide API access for retrieval.

---

## **Acceptance Criteria & User Stories**

### **User Story 1: Detecting & Reporting Broken Links**

**Title:** As a researcher, SEO expert, or data analyst, I want FireCrawl to detect broken links and suggest replacements so that my crawled datasets remain accurate, up-to-date, and useful.

**Acceptance Criteria:**

* Extracted links are automatically **checked for availability**.  
* Broken links **are categorized** by error type (404, 403, 500).  
* Suggested alternatives come from **Wayback Machine, Google, or AI similarity matching**.  
* Users receive a **report summarizing broken links and recommendations**.

---

### **User Story 2: Detecting & Reporting Page Updates**

**Title:** As a competitive intelligence analyst, journalist, or researcher, I want FireCrawl to alert me when significant content changes occur on monitored websites so that I can stay informed and act quickly.

**Acceptance Criteria:**

* FireCrawl **compares new and previous versions** of pages.  
* Changes are **scored based on importance** (minor, major, complete rewrite).  
* Users can **review change reports** in the dashboard.  
* FireCrawl can **send notifications** when major updates occur.

---

### **User Story 3: AI-Powered Content Summarization (Stretch Goal)**

**Title:** As a data analyst, news aggregator, or business researcher, I want FireCrawl to generate AI-powered summaries of crawled content so that I can extract key insights without reading full-length articles.

.  
**Acceptance Criteria:**

* AI summarization can be toggled **on/off** in FireCrawl settings.  
* Extracted text is **processed using AI models** to generate summaries.  
* Summaries are **stored alongside full content** for easy reference.  
* Users can choose between **extractive (key sentences) or abstractive (reworded)** summaries.  
* Summaries are available **in the dashboard or via API**.

---

## **Developer Resources & API Integrations**

| Feature | API / Library |
| ----- | ----- |
| **Broken Link Checking** | `axios,http`, Google/Bing API, Wayback Machine API |
| **Content Update Diffing** | `difflib`, `diff-match-patch`, `SBERT` |
| **Summarization** | `transformers` (T5, Pegasus), `sumy`, `spacy` |
| **Storage & Retrieval** | Supabase/PostgreSQl |
| **Alerting & Reporting** | PostHog, Email API (SendGrid, AWS SES) |

---

## **Benefits & Takeaways**

✅ **Proactive Maintenance:** Detecting **broken links** ensures **high-quality** datasets.  
✅ **Enhanced Monitoring:** Users can track **important website changes** without manual checking.  
✅ **Efficient Insights:** AI summaries help **users quickly digest** large amounts of content.  
✅ **Scalable & Modular:** Features can be **integrated incrementally** into FireCrawl.

---

