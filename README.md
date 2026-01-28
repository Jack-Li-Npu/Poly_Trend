# PolyMacro Insight

中文版本 | [English Version](./README_EN.md)

一个宏观市场情报仪表盘，通过整合 Polymarket 预测数据，利用多模型 AI 进行智能分析与深度宏观趋势建议。

## 🎯 功能特性

- 🎨 **UI 设计**：使用 Aceternity UI 组件库构建现代化界面，包含 3D 卡片效果与动态背景。
- 📈 **历史价格数据可视化**：通过 `clobTokenId` 异步拉取全量历史走势数据，提供直观的价格波动分析。
- 🧠 **语义三维市场匹配**：
  - 全量爬取 Polymarket 活跃事件（约 6800 条 active events）并进行本地化存储。
  - 使用 Gemini 1.5 Flash 轻量级模型进行快速语义分类。
  - 智能筛选 **经济、政治、技术** 三个维度中各前 30 个最相关的市场进行输出。
- 🕸️ **PolyMacro 关联图谱 (开发中)**：
  - 利用 **皮尔逊相关系数 (Pearson Correlation)** 量化市场间的联动性。
  - 使用 **力导向图谱 (Force-directed Graph)** 可视化展示事件间的连锁反应。
  - 支持多曲线叠加分析，验证不同事件之间的同步率。
  - 持续优化中：聚类算法改进与大数据量下的渲染性能提升。
- 🔍 **智能混合搜索**：
  - **硬匹配 (Market Search)**：直接对接 Polymarket API，获取最精准的市场数据（与官方搜索结果一致）。
  - **软匹配 (Tag Search)**：利用 Gemini AI 进行语义分析，匹配相关联的市场标签，提供更广阔的视野。
- 🤖 **多模型 AI 分析**：
  - 支持 **Gemini**, **Claude**, **ChatGPT** 云端模型。
  - 支持 **MiroThinker (Local)** 本地深度推理分析。
- 📊 **深度宏观分析**：
  - 自动打包所有相关市场数据（标题、价格、成交量等）。
  - 生成包含核心结论、详细分析与市场情绪摘要的报告。
- 💾 **搜索结果持久化**：所有搜索数据自动保存至本地，便于历史追溯与 AI 离线分析。
- 🌓 **完美适配**：支持暗色模式，响应式设计适配移动端。

## 🛠️ 技术栈

- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **UI 组件**: Aceternity UI (3D Card, Background Lines, Floating Dock)
- **动画**: Framer Motion
- **AI 集成**: Google Gemini API, OpenAI API, Anthropic API, MiroFlow Agent

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 环境配置

在项目根目录创建 `.env.local` 文件，配置相关 API Key：

```bash
# Gemini API Key (必需，用于语义搜索)
GEMINI_API_KEY=your_gemini_api_key_here

# 代理配置 (如果需要)
HTTP_PROXY=http://127.0.0.1:7890
```

### 3. 运行开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可开始使用。

## 🤖 AI 深度分析说明

### MiroThinker (本地推理)
如果您选择使用本地的 MiroThinker 模式，请确保：
1. 已安装并启动 [MiroFlow](https://github.com/MiroMindAI/MiroFlow) API 服务器。
2. API 地址通常为 `http://localhost:8000/analyze`。
3. 深度推理可能需要 3-10 分钟。

![前端页面1](https://fastly.jsdelivr.net/gh/Jack-Li-Npu/ImgStg@master/image/20260119101713052.png)


![前端页面2](https://fastly.jsdelivr.net/gh/Jack-Li-Npu/ImgStg@master/image/20260119101858303.png)


![推理结果](https://fastly.jsdelivr.net/gh/Jack-Låi-Npu/ImgStg@master/image/20260119102258143.png)

### 云端模型
选择 Gemini、Claude 或 ChatGPT 时，您可以在 UI 界面中直接输入相应的 API Key，该 Key 将保存在浏览器本地。

## 📁 项目结构

- `app/`: Next.js App Router 路由与 API 接口。
- `components/ui/`: 精美的 React UI 组件。
- `lib/`: 封装的各种业务逻辑（AI 搜索、缓存管理、数据解析）。
- `types/`: TypeScript 类型定义。
- `search-results/`: 自动生成的本地搜索数据记录。

## 📝 故障排除

1. **搜索无结果**：检查代理是否正常开启，或检查 `GEMINI_API_KEY` 是否有效。
2. **AI 分析超时**：本地推理模型可能需要较长时间，请保持页面开启。
3. **渲染问题**：确保已安装 `framer-motion` 依赖。

## License

MIT
