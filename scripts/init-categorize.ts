import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from "node-fetch";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

if (!GEMINI_API_KEY) {
  console.error("❌ 错误: 未设置 GEMINI_API_KEY 环境变量");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

async function getAllActiveEvents() {
  console.log("🔄 开始拉取所有活跃事件...");
  const limit = 500;
  let offset = 0;
  const allEvents: any[] = [];

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      active: "true",
      closed: "false",
      limit: limit.toString(),
      offset: offset.toString(),
      sort: "volume",
    });

    const response = await fetch(`${GAMMA_API_BASE}/events?${params.toString()}`);
    if (!response.ok) throw new Error(`Gamma API error: ${response.status}`);

    const data: any = await response.json();
    const results = Array.isArray(data) ? data : (data.results || []);

    if (results.length === 0) break;
    allEvents.push(...results);
    if (results.length < limit) break;
    offset += results.length;
  }

  console.log(`✅ 共拉取到 ${allEvents.length} 个活跃事件`);
  return allEvents;
}

function formatVolume(volume: any): string {
  const vol = typeof volume === 'string' ? parseFloat(volume) : (volume || 0);
  if (vol >= 1000000) return `$${(vol / 1000000).toFixed(1)}M`;
  if (vol >= 1000) return `$${(vol / 1000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

async function categorizeBatch(events: any[], userQuery: string = "通用市场分类") {
  const titles = events.map((e, idx) => `${idx}: ${e.title}`);
  
  const prompt = `你是一个专业的市场分析助手。
请把下列事件标题分类到以下固定类别之一：经济 / 政治 / 技术 / 不相关。

分类标准：
- 经济：涉及宏观经济、利率、通胀、加密货币价格预测、股市、大宗商品等。
- 政治：涉及选举、立法、政府政策、国际关系、战争等。
- 技术：涉及 AI、半导体、航天、科学发现、互联网公司重大动向等。
- 不相关：体育、娱乐、流行文化、天气等其他不属于上述三类的。

事件列表：
${titles.join("\n")}

输出要求：
1. 只返回 JSON 格式，不要有任何额外说明。
2. 格式如下：
{
  "assignments": [
    { "index": 0, "category": "经济" },
    { "index": 1, "category": "政治" }
  ]
}
3. 确保 index 与输入对应。
4. 排除标记为“不相关”的项。`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("未找到 JSON 响应");
    
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.assignments || [];
  } catch (error) {
    console.error(`❌ 批次分类失败:`, error);
    return [];
  }
}

async function main() {
  try {
    const events = await getAllActiveEvents();
    const categorizedEvents: any[] = [];
    const BATCH_SIZE = 100;

    console.log(`🤖 开始使用 Gemini 2.0 分类，每批 ${BATCH_SIZE} 个...`);

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      console.log(`⏳ 正在处理第 ${Math.floor(i / BATCH_SIZE) + 1} 批 (${i}-${i + batch.length})...`);
      
      const assignments = await categorizeBatch(batch);
      
      assignments.forEach((asn: any) => {
        const event = batch[asn.index];
        if (!event) return;

        // 挑选成交量最大的市场
        let topMarket = null;
        if (event.markets && Array.isArray(event.markets)) {
          const validMarkets = event.markets.filter((m: any) => m.active && !m.closed && m.enableOrderBook);
          if (validMarkets.length > 0) {
            topMarket = validMarkets.sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))[0];
          }
        }

        if (topMarket) {
          categorizedEvents.push({
            id: event.id,
            title: event.title,
            category: asn.category,
            eventSlug: event.slug,
            topMarket: {
              id: topMarket.id,
              question: topMarket.question,
              slug: topMarket.slug,
              volume: formatVolume(topMarket.volume),
              image: topMarket.image,
              clobTokenIds: topMarket.clobTokenIds,
              outcomes: topMarket.outcomes ? JSON.parse(topMarket.outcomes) : ["Yes", "No"]
            }
          });
        }
      });
      
      // 稍微停顿一下避免触发速率限制
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const dataPath = path.join(process.cwd(), 'data', 'categorized-events.json');
    fs.writeFileSync(dataPath, JSON.stringify(categorizedEvents, null, 2), 'utf-8');
    
    console.log(`\n✨ 分类完成！`);
    console.log(`统计:`);
    console.log(`- 经济: ${categorizedEvents.filter(e => e.category === '经济').length}`);
    console.log(`- 政治: ${categorizedEvents.filter(e => e.category === '政治').length}`);
    console.log(`- 技术: ${categorizedEvents.filter(e => e.category === '技术').length}`);
    console.log(`📦 数据已保存至: ${dataPath}`);

  } catch (error) {
    console.error("💥 脚本运行失败:", error);
  }
}

main();
