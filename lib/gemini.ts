/**
 * Gemini AI Service
 * Semantic search and matching using Gemini API
 */

import https from 'https';

/**
 * Call Gemini API directly (using https module to support proxies)
 */
export async function callGeminiAPI(prompt: string): Promise<string> {
  const currentKey = process.env.GEMINI_API_KEY;
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const model = "gemini-2.0-flash"; // Fixed to gemini-2.0-flash as per user requirement
  
  if (!currentKey) {
    throw new Error("Gemini API key is not configured. Please set it in the UI.");
  }

  const requestBody = JSON.stringify({
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048
    }
  });

  return new Promise((resolve, reject) => {
    // Follow user script: key no longer in URL, passed only via Header
    const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent`;
    const url = new URL(endpoint);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'x-goog-api-key': currentKey // Core: use specified Header for authentication
      },
      timeout: 30000 
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
            resolve(text);
          } catch (e) {
            reject(new Error(`Failed to parse Gemini response: ${e}`));
          }
        } else {
          reject(new Error(`Gemini API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Gemini API request failed: ${e.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gemini API request timeout'));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Match relevant tags using Gemini
 * @param userQuery User's search query
 * @param tags Array of tags, each containing label and slug
 * @param topN Number of most relevant tags to return, defaults to 5
 * @returns Array of matched tag indices (sorted by relevance)
 */
export async function findRelevantTags(
  userQuery: string,
  tags: Array<{ label: string; slug?: string }>,
  topN: number = 5
): Promise<number[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (tags.length === 0) {
    return [];
  }

  try {
    // Build tag text list (using label and slug)
    const tagTexts = tags.map((tag, index) => {
      const text = tag.slug ? `${tag.label} (${tag.slug})` : tag.label;
      return `${index}: ${text}`;
    });

    // Build prompt
    const prompt = `You are a professional market analysis assistant. A user has entered a query, and you need to find the top ${topN} most relevant tags from the following list.

User Query: ${userQuery}

Tag List (Format: Index: Tag Name):
${tagTexts.join("\n")}

Requirements:
1. Carefully analyze the intent and keywords of the user query
2. Find the tags most relevant to the query (consider synonyms, related concepts, etc.)
3. Return the numeric indices separated by commas, with no spaces
4. Return only the top ${topN} most relevant tag indices
5. Return ONLY the numeric indices, no other text or explanation
6. Ensure indices are between 0 and ${tags.length - 1}

Output Format Example (${topN} indices):
0,3,5,12,15`;

    // Call Gemini API
    console.log(`Calling Gemini API for tag matching (top ${topN})...`);
    const responseText = await callGeminiAPI(prompt);
    console.log("Gemini tag response:", responseText.substring(0, 200));

    // Parse returned indices
    const indices = responseText
      .trim()
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((idx) => !isNaN(idx) && idx >= 0 && idx < tags.length)
      .slice(0, topN); // Max topN

    console.log(`Found ${indices.length} relevant tags`);

    return indices;
  } catch (error) {
    console.error("Error calling Gemini API for tags:", error);
    throw new Error("Failed to find relevant tags using AI");
  }
}

/**
 * Match relevant event titles using Gemini
 * @param userQuery User's search query
 * @param eventTitles Array of event titles
 * @param topN Number of most relevant events to return, defaults to 20
 * @returns Array of matched event indices (sorted by relevance)
 */
export async function findRelevantEvents(
  userQuery: string,
  eventTitles: string[],
  topN: number = 20
): Promise<number[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (eventTitles.length === 0) {
    return [];
  }

  try {
    // If too many titles, only take the first 200 (to avoid token limits)
    const titlesToAnalyze = eventTitles.slice(0, 200);

    // Build prompt
    const prompt = `You are a professional market analysis assistant. A user has entered a query, and you need to find the top ${topN} most relevant events from the following list of event titles.

User Query: ${userQuery}

Event Title List (Format: Index: Title):
${titlesToAnalyze.map((title, index) => `${index}: ${title}`).join("\n")}

Requirements:
1. Carefully analyze the intent and keywords of the user query
2. Find the most relevant event titles for the query
3. Return the numeric indices separated by commas, with no spaces
4. Return only the top ${topN} most relevant event indices
5. Return ONLY the numeric indices, no other text or explanation
6. Ensure indices are between 0 and ${titlesToAnalyze.length - 1}

Output Format Example (${topN} indices):
0,2,5,8,12,15,18,22,25,28,30,33,35,38,40,42,45,48,50,52`;

    // Call Gemini API
    console.log(`Calling Gemini API for event matching (top ${topN})...`);
    const responseText = await callGeminiAPI(prompt);
    console.log("Gemini event response:", responseText.substring(0, 200));

    // Parse returned indices
    const indices = responseText
      .trim()
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((idx) => !isNaN(idx) && idx >= 0 && idx < titlesToAnalyze.length)
      .slice(0, topN); // Max topN

    console.log(`Found ${indices.length} relevant events`);

    return indices;
  } catch (error) {
    console.error("Error calling Gemini API for events:", error);
    throw new Error("Failed to find relevant events using AI");
  }
}

/**
 * Match relevant market titles using Gemini
 * @param userQuery User's search query
 * @param marketTitles Array of all market titles
 * @returns Array of matched market indices (sorted by relevance)
 */
export async function findRelevantMarkets(
  userQuery: string,
  marketTitles: string[]
): Promise<number[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (marketTitles.length === 0) {
    return [];
  }

  try {
    // If too many titles, only take the first 500 (to avoid token limits)
    const titlesToAnalyze = marketTitles.slice(0, 500);

    // Build prompt
    const prompt = `You are a professional market analysis assistant. A user has entered a query, and you need to find the most relevant markets from the following list of market titles.

User Query: ${userQuery}

Market Title List (Format: Index: Title):
${titlesToAnalyze.map((title, index) => `${index}: ${title}`).join("\n")}

Task: Analyze the user query and find all relevant or potentially relevant market indices.

Requirements:
1. Carefully analyze the meaning and keywords of the user query
2. Find all markets that are relevant, partially relevant, or topically related to the query (including synonyms, related concepts, contextually relevant, etc.)
3. Return numeric indices separated by commas, with no spaces
4. You MUST return at least 20 indices; if many markets are relevant, return closer to 50 indices
5. Return ONLY the numeric indices, no other text or explanation
6. Ensure indices are between 0 and ${titlesToAnalyze.length - 1}

Output Format Example (50 indices):
0,1,2,3,5,7,10,12,15,18,20,22,25,28,30,33,35,38,40,42,45,48,50,52,55,58,60,63,65,68,70,72,75,78,80,82,85,88,90,92,95,98,100,102,105,108,110,112,115,118`;

    // Call Gemini API
    console.log("Calling Gemini API for market matching...");
    const responseText = await callGeminiAPI(prompt);
    console.log("Gemini API response:", responseText.substring(0, 200));

    // Parse returned indices
    const indices = responseText
      .trim()
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((idx) => !isNaN(idx) && idx >= 0 && idx < titlesToAnalyze.length)
      .slice(0, 50); // Max 50

    console.log(`Found ${indices.length} relevant markets`);

    return indices;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to find relevant markets using AI");
  }
}

/**
 * Generate Embedding for a single text
 */
export async function embedText(text: string): Promise<number[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  const requestBody = JSON.stringify({
    model: "models/text-embedding-004",
    content: {
      parts: [{ text }]
    }
  });

  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const endpoint = `${baseUrl}/v1beta/models/text-embedding-004:embedContent`;
  const url = new URL(endpoint);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'x-goog-api-key': process.env.GEMINI_API_KEY as string
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            resolve(response.embedding.values);
          } catch (e) {
            reject(new Error(`Failed to parse embedding response: ${e}`));
          }
        } else {
          reject(new Error(`Embedding API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(requestBody);
    req.end();
  });
}

/**
 * Generate Embeddings for multiple texts in batch
 */
export async function batchEmbedText(texts: string[]): Promise<number[][]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (texts.length === 0) return [];

  // Gemini batchEmbedContents limited to 100 at a time
  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const requestBody = JSON.stringify({
      requests: batch.map(text => ({
        model: "models/text-embedding-004",
        content: { parts: [{ text }] }
      }))
    });

    const batchResults = await new Promise<number[][]>((resolve, reject) => {
      const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
      const endpoint = `${baseUrl}/v1beta/models/text-embedding-004:batchEmbedContents`;
      const url = new URL(endpoint);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'x-goog-api-key': process.env.GEMINI_API_KEY as string
        },
        timeout: 30000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              resolve(response.embeddings.map((e: any) => e.values));
            } catch (e) {
              reject(new Error(`Failed to parse batch embedding response: ${e}`));
            }
          } else {
            reject(new Error(`Batch Embedding API returned ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.write(requestBody);
      req.end();
    });

    results.push(...batchResults);
  }

  return results;
}

export interface MarketGroupResult {
  dimension: string;
  indices: number[];
}

function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  return null;
}

/**
 * Use Gemini to group market candidates into 5 semantic dimensions
 */
export async function findMarketGroups(
  userQuery: string,
  marketCandidates: Array<{ title: string; eventTitle?: string }>,
  groupCount: number = 5,
  total: number = 50
): Promise<MarketGroupResult[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (marketCandidates.length === 0) {
    return [];
  }

  const formattedCandidates = marketCandidates.map((m, idx) => {
    const eventInfo = m.eventTitle ? ` (Event: ${m.eventTitle})` : "";
    return `${idx}: ${m.title}${eventInfo}`;
  });

  const prompt = `You are a professional market analysis assistant. A user has entered a query, and you need to group related markets into 5 different semantic dimensions.\n\nUser Query: ${userQuery}\n\nCandidate Market List (Format: Index: Market Question (Optional Event)):\n${formattedCandidates.join("\n")}\n\nTask Requirements:\n1. You need to generate 5 unique semantic dimensions and select related markets for each dimension\n2. Select approximately ${total} markets in total, distributed across groups as you see fit\n3. No duplicate market indices\n4. Return JSON in the following format:\n{\n  \"groups\": [\n    { \"dimension\": \"Dimension Name 1\", \"indices\": [0,2,5] },\n    { \"dimension\": \"Dimension Name 2\", \"indices\": [1,3,7] },\n    ... 5 groups total\n  ]\n}\n5. Return ONLY JSON, no other text or explanation\n`;

  try {
    console.log("Calling Gemini API for grouped market selection...");
    const responseText = await callGeminiAPI(prompt);

    const jsonText = extractJsonFromText(responseText);
    if (!jsonText) {
      throw new Error("Gemini response does not contain JSON");
    }

    const parsed = JSON.parse(jsonText);
    const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];

    const normalized: MarketGroupResult[] = groups
      .slice(0, groupCount)
      .map((group: any, idx: number) => ({
        dimension: typeof group.dimension === "string" && group.dimension.trim()
          ? group.dimension.trim()
          : `Dimension ${idx + 1}`,
        indices: Array.isArray(group.indices) ? group.indices : [],
      }));

    // Deduplicate and validate indices
    const used = new Set<number>();
    normalized.forEach(group => {
      group.indices = group.indices
        .map((i: any) => parseInt(i, 10))
        .filter(i => !isNaN(i) && i >= 0 && i < marketCandidates.length)
        .filter(i => {
          if (used.has(i)) return false;
          used.add(i);
          return true;
        });
    });

    return normalized;
  } catch (error) {
    console.error("Error calling Gemini API for grouped markets:", error);

    // Fallback: split top total candidates equally
    const safeTotal = Math.min(total, marketCandidates.length);
    const indices = Array.from({ length: safeTotal }, (_, i) => i);
    const groups: MarketGroupResult[] = [];
    for (let g = 0; g < groupCount; g++) {
      const chunk = indices.filter((_, idx) => idx % groupCount === g);
      groups.push({
        dimension: `Dimension ${g + 1}`,
        indices: chunk,
      });
    }
    return groups;
  }
}

/**
 * Use Gemini to pick the most relevant Events from a category pool
 */
export async function pickRelevantEvents(
  userQuery: string,
  eventPool: Array<{ id: string; title: string }>,
  count: number = 30,
  dimension?: string
): Promise<Array<{ id: string; reasoning: string }>> {
  if (!process.env.GEMINI_API_KEY) throw new Error("Gemini API key is not configured");
  if (eventPool.length === 0) return [];

  const titles = eventPool.map((e, idx) => `${idx}: ${e.title}`);
  const dimensionHint = dimension ? `The current dimension being filtered is: [${dimension}]. Ensure that the selected events both match the user's query and strongly belong to the [${dimension}] category.` : "";
  
  const prompt = `You are a professional market filtering assistant.
User Query: ${userQuery}
${dimensionHint}

Please pick the ${count} most relevant events from the following list of market events.
You MUST pick exactly ${count} events (if the list is long enough), sorted by relevance.

Output Requirements:
1. Return ONLY JSON format, no other text or explanation.
2. Format as follows:
{
  "picks": [
    { "index": 0, "reason": "Short recommendation reason explaining why this event is relevant to the query" },
    { "index": 5, "reason": "Short recommendation reason..." }
  ]
}
3. Ensure index corresponds to the input list.

Event List:
${titles.join("\n")}`;

  try {
    // Use flash-lite model for fast selection
    const result = await callGeminiAPI(prompt);
    const jsonText = extractJsonFromText(result);
    if (!jsonText) throw new Error("Gemini response does not contain JSON");
    
    const parsed = JSON.parse(jsonText);
    const picks = Array.isArray(parsed?.picks) ? parsed.picks : [];
    
    return picks
      .map((p: any) => {
        const idx = parseInt(p.index, 10);
        if (!isNaN(idx) && idx >= 0 && idx < eventPool.length) {
          return {
            id: eventPool[idx].id,
            reasoning: String(p.reason || "AI matched result")
          };
        }
        return null;
      })
      .filter((p: any): p is { id: string; reasoning: string } => p !== null)
      .slice(0, count);
  } catch (error) {
    console.error(`❌ Failed to pick relevant events (${dimension || 'unknown'}):`, error);
    return eventPool.slice(0, count).map(e => ({ id: e.id, reasoning: "Matched based on semantic relevance" }));
  }
}

/**
 * Use AI to infer causal logic between market pairs
 */
export async function inferCausalRelations(
  userQuery: string,
  pairs: Array<{ 
    a: { title: string; price: number; eventTitle?: string }; 
    b: { title: string; price: number; eventTitle?: string }; 
    correlation: number;
    relationType?: 'intra-event' | 'inter-event'
  }>
): Promise<Array<{ cause: string; effect: string; confidence: number; reason: string }>> {
  if (!process.env.GEMINI_API_KEY) throw new Error("Gemini API key is not configured");
  if (pairs.length === 0) return [];

  const pairsText = pairs.map((p, i) => `
Pair ${i}:
- Market A: "${p.a.title}" (Current Prob: ${p.a.price}%) ${p.a.eventTitle ? `[Event: ${p.a.eventTitle}]` : ''}
- Market B: "${p.b.title}" (Current Prob: ${p.b.price}%) ${p.b.eventTitle ? `[Event: ${p.b.eventTitle}]` : ''}
- Relation Type: ${p.relationType === 'intra-event' ? 'Different options same event' : 'Cross-event association'}
- Hist Price Correlation: ${p.correlation.toFixed(2)}
`).join('\n');

  const prompt = `You are a professional macroeconomic and political analyst.
Based on the user query "${userQuery}", I have found several pairs of prediction markets with significant historical price correlation.

Please analyze these market pairs and determine if there is a logical causal relationship, mutual exclusivity, or a strong associational explanation between them.

Special attention:
1. If the relation type is "Different options same event", they are usually competitive outcomes under the same event (like different candidates in an election), and the relationship is mutually exclusive or complementary.
2. If the relation type is "Cross-event association", there may be a macroeconomic causal driver (e.g., event A occurring will lead to an increased probability of event B).

List of related market pairs:
${pairsText}

Please return JSON formatted results, containing only pairs with clear logical associations:
{
  "relations": [
    {
      "cause": "Title of Market A",
      "effect": "Title of Market B",
      "confidence": 0.85, // confidence index between 0-1
      "reason": "Short logical explanation. If same-event mutual exclusion, explain that these are different outcomes of the same event."
    }
  ]
}
Notes:
1. Output ONLY JSON, no other text.
2. Even negative correlation (near -1) may have causal or mutually exclusive relationships.
3. If no clear association, return an empty array.
`;

  try {
    const responseText = await callGeminiAPI(prompt);
    const jsonText = extractJsonFromText(responseText);
    if (!jsonText) return [];
    
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed?.relations) ? parsed.relations : [];
  } catch (error) {
    console.error("❌ Failed to infer causal relations:", error);
    return [];
  }
}

export interface EventCategoryAssignment {
  index: number;
  category: string;
}

/**
 * Use Gemini to classify event titles into fixed categories
 */
export async function classifyEventsByCategory(
  userQuery: string,
  eventTitles: string[],
  categories: string[],
  batchSize: number = 200
): Promise<EventCategoryAssignment[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (eventTitles.length === 0) {
    return [];
  }

  const results: EventCategoryAssignment[] = [];

  for (let start = 0; start < eventTitles.length; start += batchSize) {
    const batch = eventTitles.slice(start, start + batchSize);
    const lines = batch.map((title, idx) => `${start + idx}: ${title}`);

    const prompt = `You are a professional market analysis assistant. User Query: ${userQuery}\n\nPlease classify the following event titles into one of these fixed categories: ${categories.join(" / ")}.\n\nEvent List (Format: Index: Title):\n${lines.join("\n")}\n\nOutput Requirements:\n1. Return ONLY JSON, no extra explanation\n2. Format as follows:\n{\n  \"assignments\": [\n    { \"index\": 0, \"category\": \"Economy\" },\n    { \"index\": 1, \"category\": \"Politics\" }\n  ]\n}\n3. category MUST be one of the given categories\n`;

    try {
      const responseText = await callGeminiAPI(prompt);
      const jsonText = extractJsonFromText(responseText);
      if (!jsonText) {
        continue;
      }
      const parsed = JSON.parse(jsonText);
      const assignments = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
      assignments.forEach((item: any) => {
        const index = parseInt(item.index, 10);
        const category = String(item.category || "").trim();
        if (!isNaN(index) && index >= 0 && index < eventTitles.length && categories.includes(category)) {
          results.push({ index, category });
        }
      });
    } catch (error) {
      console.error("Error classifying events batch:", error);
    }
  }

  if (results.length > 0) {
    return results;
  }

  // Fallback: simple keyword classification
  const keywordMap: Record<string, RegExp> = {
    [categories[0]]: /(gdp|inflation|rate|fed|econom|債|利率|通胀|就业|经济|Economy)/i,
    [categories[1]]: /(election|vote|politic|senate|congress|president|选举|总统|政治|国会|Politics)/i,
    [categories[2]]: /(ai|tech|semiconductor|chip|openai|nvidia|microsoft|技术|科技|芯片|Tech)/i,
  };

  return eventTitles.map((title, index) => {
    const matchedCategory =
      categories.find((cat) => keywordMap[cat]?.test(title)) || categories[0];
    return { index, category: matchedCategory };
  });
}