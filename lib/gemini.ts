/**
 * Gemini AI Service
 * 使用 Gemini API 进行语义搜索和匹配
 */

import https from 'https';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set. Gemini AI features will not work.");
}

/**
 * 直接调用 Gemini API（使用 https 模块以支持代理）
 */
async function callGeminiAPI(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
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
      path: `/v1beta/models/gemini-flash-lite-latest:generateContent?key=${GEMINI_API_KEY}`,
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
  if (!GEMINI_API_KEY) {
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
  if (!GEMINI_API_KEY) {
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
  if (!GEMINI_API_KEY) {
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
