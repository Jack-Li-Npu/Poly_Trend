/**
 * Gemini AI Service
 * 使用 Gemini API 进行语义搜索和匹配
 */

import https from 'https';

/**
 * 直接调用 Gemini API（使用 https 模块以支持代理）
 */
async function callGeminiAPI(prompt: string): Promise<string> {
  const currentKey = process.env.process.env.GEMINI_API_KEY;
  
  if (!currentKey) {
    throw new Error("Gemini API key is not configured. Please set it in the UI.");
  }

  const requestBody = JSON.stringify({
    contents: [{
      parts: [{
        text: prompt
      }]
    }]
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/gemini-flash-lite-latest:generateContent?key=${currentKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 30000 // 30秒超时
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
 * 使用 Gemini 匹配相关的标签
 * @param userQuery 用户输入的查询
 * @param tags 标签数组，每个标签包含 label 和 slug
 * @param topN 返回最相关的标签数量，默认5个
 * @returns 匹配的标签索引数组（按相关性排序）
 */
export async function findRelevantTags(
  userQuery: string,
  tags: Array<{ label: string; slug?: string }>,
  topN: number = 5
): Promise<number[]> {
  if (!process.env.process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (tags.length === 0) {
    return [];
  }

  try {
    // 构建标签文本列表（使用 label 和 slug）
    const tagTexts = tags.map((tag, index) => {
      const text = tag.slug ? `${tag.label} (${tag.slug})` : tag.label;
      return `${index}: ${text}`;
    });

    // 构建提示词
    const prompt = `你是一个专业的市场分析助手。用户输入了一个查询，需要从以下标签中找到最相关的前${topN}个标签。

用户查询：${userQuery}

标签列表（格式：索引:标签名称）：
${tagTexts.join("\n")}

要求：
1. 仔细分析用户查询的意图和关键词
2. 找出与查询最相关的标签（考虑同义词、相关概念等）
3. 返回数字索引用逗号分隔，不要有空格
4. 只返回最相关的${topN}个标签索引
5. 只返回数字索引，不要有任何其他文字说明
6. 确保索引在0到${tags.length - 1}之间

输出格式示例（${topN}个索引）：
0,3,5,12,15`;

    // 调用 Gemini API
    console.log(`Calling Gemini API for tag matching (top ${topN})...`);
    const responseText = await callGeminiAPI(prompt);
    console.log("Gemini tag response:", responseText.substring(0, 200));

    // 解析返回的索引
    const indices = responseText
      .trim()
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((idx) => !isNaN(idx) && idx >= 0 && idx < tags.length)
      .slice(0, topN); // 最多topN个

    console.log(`Found ${indices.length} relevant tags`);

    return indices;
  } catch (error) {
    console.error("Error calling Gemini API for tags:", error);
    throw new Error("Failed to find relevant tags using AI");
  }
}

/**
 * 使用 Gemini 匹配相关的事件标题
 * @param userQuery 用户输入的查询
 * @param eventTitles 事件标题数组
 * @param topN 返回最相关的事件数量，默认20个
 * @returns 匹配的事件索引数组（按相关性排序）
 */
export async function findRelevantEvents(
  userQuery: string,
  eventTitles: string[],
  topN: number = 20
): Promise<number[]> {
  if (!process.env.process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (eventTitles.length === 0) {
    return [];
  }

  try {
    // 如果标题太多，只取前200个（避免token限制）
    const titlesToAnalyze = eventTitles.slice(0, 200);

    // 构建提示词
    const prompt = `你是一个专业的市场分析助手。用户输入了一个查询，需要从以下事件标题中找到最相关的前${topN}个事件。

用户查询：${userQuery}

事件标题列表（格式：索引:标题）：
${titlesToAnalyze.map((title, index) => `${index}: ${title}`).join("\n")}

要求：
1. 仔细分析用户查询的意图和关键词
2. 找出与查询最相关的事件标题
3. 返回数字索引用逗号分隔，不要有空格
4. 只返回最相关的${topN}个事件索引
5. 只返回数字索引，不要有任何其他文字说明
6. 确保索引在0到${titlesToAnalyze.length - 1}之间

输出格式示例（${topN}个索引）：
0,2,5,8,12,15,18,22,25,28,30,33,35,38,40,42,45,48,50,52`;

    // 调用 Gemini API
    console.log(`Calling Gemini API for event matching (top ${topN})...`);
    const responseText = await callGeminiAPI(prompt);
    console.log("Gemini event response:", responseText.substring(0, 200));

    // 解析返回的索引
    const indices = responseText
      .trim()
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((idx) => !isNaN(idx) && idx >= 0 && idx < titlesToAnalyze.length)
      .slice(0, topN); // 最多topN个

    console.log(`Found ${indices.length} relevant events`);

    return indices;
  } catch (error) {
    console.error("Error calling Gemini API for events:", error);
    throw new Error("Failed to find relevant events using AI");
  }
}

/**
 * 使用 Gemini 匹配相关的市场标题
 * @param userQuery 用户输入的查询
 * @param marketTitles 所有市场的标题数组
 * @returns 匹配的市场索引数组（按相关性排序）
 */
export async function findRelevantMarkets(
  userQuery: string,
  marketTitles: string[]
): Promise<number[]> {
  if (!process.env.process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (marketTitles.length === 0) {
    return [];
  }

  try {
    // 如果标题太多，只取前500个（避免token限制）
    const titlesToAnalyze = marketTitles.slice(0, 500);

    // 构建提示词
    const prompt = `你是一个专业的市场分析助手。用户输入了一个查询，需要从以下市场标题中找到最相关的市场。

用户查询：${userQuery}

市场标题列表（格式：索引:标题）：
${titlesToAnalyze.map((title, index) => `${index}: ${title}`).join("\n")}

任务：分析用户查询，找出所有相关或可能相关的市场索引。

要求：
1. 仔细分析用户查询的含义和关键词
2. 找出所有与查询相关、部分相关或主题相关的市场（包括同义词、相关概念、上下文相关等）
3. 返回数字索引用逗号分隔，不要有空格
4. 必须返回至少20个索引，如果相关市场较多，应返回接近50个索引
5. 只返回数字索引，不要有任何其他文字说明
6. 确保索引在0到${titlesToAnalyze.length - 1}之间

输出格式示例（50个索引）：
0,1,2,3,5,7,10,12,15,18,20,22,25,28,30,33,35,38,40,42,45,48,50,52,55,58,60,63,65,68,70,72,75,78,80,82,85,88,90,92,95,98,100,102,105,108,110,112,115,118`;

    // 调用 Gemini API
    console.log("Calling Gemini API for market matching...");
    const responseText = await callGeminiAPI(prompt);
    console.log("Gemini API response:", responseText.substring(0, 200));

    // 解析返回的索引
    const indices = responseText
      .trim()
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((idx) => !isNaN(idx) && idx >= 0 && idx < titlesToAnalyze.length)
      .slice(0, 50); // 最多50个

    console.log(`Found ${indices.length} relevant markets`);

    return indices;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to find relevant markets using AI");
  }
}

/**
 * 为单个文本生成 Embedding
 */
export async function embedText(text: string): Promise<number[]> {
  if (!process.env.process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  const requestBody = JSON.stringify({
    model: "models/text-embedding-004",
    content: {
      parts: [{ text }]
    }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/text-embedding-004:embedContent?key=${process.env.process.env.GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
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
 * 批量为多个文本生成 Embedding
 */
export async function batchEmbedText(texts: string[]): Promise<number[][]> {
  if (!process.env.process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  if (texts.length === 0) return [];

  // Gemini batchEmbedContents 限制一次最多 100 个
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
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models/text-embedding-004:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
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
 * 使用 Gemini 将市场候选分为 5 个维度分组
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

  const prompt = `你是一个专业的市场分析助手。用户输入了一个查询，需要你将相关市场按 5 个不同的语义维度分组。\n\n用户查询：${userQuery}\n\n候选市场列表（格式：索引: 市场问题 (可选Event)）：\n${formattedCandidates.join("\n")}\n\n任务要求：\n1. 你需要自行生成 5 个互不重复的语义维度，并为每个维度挑选相关市场\n2. 总共挑选约 ${total} 个市场，数量可自行分配到各组\n3. 不能有重复市场索引\n4. 返回 JSON，格式如下：\n{\n  \"groups\": [\n    { \"dimension\": \"维度名称1\", \"indices\": [0,2,5] },\n    { \"dimension\": \"维度名称2\", \"indices\": [1,3,7] },\n    ... 共5组\n  ]\n}\n5. 只返回 JSON，不要有任何额外说明\n`;

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
          : `维度 ${idx + 1}`,
        indices: Array.isArray(group.indices) ? group.indices : [],
      }));

    // 去重和合法化索引
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

    // 回退方案：均分前 total 个候选
    const safeTotal = Math.min(total, marketCandidates.length);
    const indices = Array.from({ length: safeTotal }, (_, i) => i);
    const groups: MarketGroupResult[] = [];
    for (let g = 0; g < groupCount; g++) {
      const chunk = indices.filter((_, idx) => idx % groupCount === g);
      groups.push({
        dimension: `维度 ${g + 1}`,
        indices: chunk,
      });
    }
    return groups;
  }
}

/**
 * 使用 Gemini 从分类池中挑选与 Query 最相关的 Event
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
  const dimensionHint = dimension ? `当前正在筛选的维度是：[${dimension}]。请确保挑选出的事件既符合用户的查询，又强烈属于[${dimension}]这一类别。` : "";
  
  const prompt = `你是一个专业的市场筛选助手。
用户查询：${userQuery}
${dimensionHint}

请从下列市场事件列表中，挑选出最相关的 ${count} 个事件。
必须挑选正好 ${count} 个事件（如果列表够长），按相关性排序。

输出要求：
1. 只返回 JSON 格式，不要有任何额外说明。
2. 格式如下：
{
  "picks": [
    { "index": 0, "reason": "简短的推荐理由，说明为什么这个事件与查询相关" },
    { "index": 5, "reason": "简短的推荐理由..." }
  ]
}
3. 确保 index 与输入列表对应。

事件列表：
${titles.join("\n")}`;

  try {
    // 使用 flash-lite 模型进行快速挑选
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
            reasoning: String(p.reason || "AI 匹配结果")
          };
        }
        return null;
      })
      .filter((p: any): p is { id: string; reasoning: string } => p !== null)
      .slice(0, count);
  } catch (error) {
    console.error(`❌ 挑选相关事件失败 (${dimension || 'unknown'}):`, error);
    return eventPool.slice(0, count).map(e => ({ id: e.id, reasoning: "基于语义相关性匹配" }));
  }
}

/**
 * 使用 AI 推断市场对之间的因果逻辑关系
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
- 市场 A: "${p.a.title}" (当前概率: ${p.a.price}%) ${p.a.eventTitle ? `[所属事件: ${p.a.eventTitle}]` : ''}
- 市场 B: "${p.b.title}" (当前概率: ${p.b.price}%) ${p.b.eventTitle ? `[所属事件: ${p.b.eventTitle}]` : ''}
- 关系类型: ${p.relationType === 'intra-event' ? '同事件不同选项' : '跨事件关联'}
- 历史价格相关性: ${p.correlation.toFixed(2)}
`).join('\n');

  const prompt = `你是一个专业的宏观经济和政治分析师。
针对用户的查询 "${userQuery}"，我找到了几对在价格走势上具有显著相关性的预测市场。

请分析这些市场对，判断它们之间是否存在逻辑上的因果关系、互斥关系或强关联解释。

特别注意：
1. 如果关系类型是 "同事件不同选项"，它们通常是同一个预测事件下的竞争性结果（如选举中的不同候选人），这种关系是互斥或互补的。
2. 如果关系类型是 "跨事件关联"，则可能存在宏观上的因果驱动（如：A 事件的发生会导致 B 事件概率增加）。

相关市场对列表：
${pairsText}

请返回 JSON 格式的结果，只包含具有明确逻辑关联的对：
{
  "relations": [
    {
      "cause": "市场 A 的标题",
      "effect": "市场 B 的标题",
      "confidence": 0.85, // 0-1 之间的信心指数
      "reason": "简短的逻辑解释。如果是同事件互斥，请说明这是同一事件的不同结果。"
    }
  ]
}
注意：
1. 只输出 JSON，不要有其他文字。
2. 即使是负相关（相关性接近 -1），也可能存在因果或互斥关系。
3. 如果没有明确关联，返回空数组。
`;

  try {
    const responseText = await callGeminiAPI(prompt);
    const jsonText = extractJsonFromText(responseText);
    if (!jsonText) return [];
    
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed?.relations) ? parsed.relations : [];
  } catch (error) {
    console.error("❌ 推断因果关系失败:", error);
    return [];
  }
}

export interface EventCategoryAssignment {
  index: number;
  category: string;
}

/**
 * 使用 Gemini 将事件标题分类到固定类别
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

    const prompt = `你是一个专业的市场分析助手。用户查询：${userQuery}\n\n请把下列事件标题分类到以下固定类别之一：${categories.join(" / ")}。\n\n事件列表（格式：索引:标题）：\n${lines.join("\n")}\n\n输出要求：\n1. 只返回 JSON，不要有额外说明\n2. 格式如下：\n{\n  \"assignments\": [\n    { \"index\": 0, \"category\": \"经济\" },\n    { \"index\": 1, \"category\": \"政治\" }\n  ]\n}\n3. category 必须是给定类别之一\n`;

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

  // 回退：简单关键词分类
  const keywordMap: Record<string, RegExp> = {
    [categories[0]]: /(gdp|inflation|rate|fed|econom|债|利率|通胀|就业|经济)/i,
    [categories[1]]: /(election|vote|politic|senate|congress|president|选举|总统|政治|国会)/i,
    [categories[2]]: /(ai|tech|semiconductor|chip|openai|nvidia|microsoft|技术|科技|芯片)/i,
  };

  return eventTitles.map((title, index) => {
    const matchedCategory =
      categories.find((cat) => keywordMap[cat]?.test(title)) || categories[0];
    return { index, category: matchedCategory };
  });
}
