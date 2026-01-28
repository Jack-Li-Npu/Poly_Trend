# PolyMacro Insight

[中文版本](./README.md) | English Version

A high-value macro market intelligence dashboard that integrates Polymarket prediction data and utilizes multi-model AI for intelligent analysis and deep macro trend recommendations.

## 🎯 Features

- 🎨 **Exquisite UI Design**: Modern interface built with Aceternity UI components, featuring 3D card effects and dynamic background lines.
- 📈 **Historical Price Data Visualization**: Asynchronously fetch full historical trends via `clobTokenId` for intuitive price fluctuation analysis.
- 🧠 **Semantic Three-Dimensional Market Matching**:
  - Full crawl and localization of Polymarket active events (approx. 6,800 events).
  - Fast semantic classification using the Gemini 1.5 Flash lightweight model.
  - Smart screening of the Top 30 most relevant markets across three dimensions: **Economy, Politics, and Technology**.
- 🕸️ **PolyMacro Correlation Graph (In Development)**:
  - Quantify market linkage using the **Pearson Correlation Coefficient**.
  - Visualize event chain reactions with a **Force-directed Graph**.
  - Support for multi-curve overlay analysis to verify synchronization between different events.
  - Ongoing optimization: Improving clustering algorithms and rendering performance for large datasets.
- 🔍 **Smart Hybrid Search**:
  - **Hard Match (Market Search)**: Directly interfaces with the Polymarket API to retrieve the most accurate market data (consistent with official search results).
  - **Soft Match (Tag Search)**: Leverages Gemini AI for semantic analysis to match related market tags, providing a broader perspective.
- 🤖 **Multi-Model AI Analysis**:
  - Supports cloud models: **Gemini**, **Claude**, and **ChatGPT**.
  - Supports **MiroThinker (Local)** for deep reasoning and analysis.
- 📊 **Deep Macro Analysis**:
  - Automatically packages all relevant market data (titles, prices, volume, etc.).
  - Generates reports including core conclusions, detailed analysis, and market sentiment summaries.
- 💾 **Search Result Persistence**: All search data is automatically saved locally for historical tracking and offline AI analysis.
- 🌓 **Perfect Adaptation**: Supports dark mode and responsive design for mobile devices.

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Aceternity UI (3D Card, Background Lines, Floating Dock)
- **Animations**: Framer Motion
- **AI Integration**: Google Gemini API, OpenAI API, Anthropic API, MiroFlow Agent

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Create a `.env.local` file in the project root and configure the necessary API keys:

```bash
# Gemini API Key (Required for semantic search)
GEMINI_API_KEY=your_gemini_api_key_here

# HTTP Proxy (If needed)
HTTP_PROXY=http://127.0.0.1:7890
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start using the application.

## 🤖 AI Deep Analysis Guide

### MiroThinker (Local Reasoning)
If you choose to use the local MiroThinker mode, please ensure:
1. The [MiroFlow](https://github.com/MiroMindAI/MiroFlow) API server is installed and running.
2. The API address is typically `http://localhost:8000/analyze`.
3. Deep reasoning may take between 3-10 minutes.

### Cloud Models
When selecting Gemini, Claude, or ChatGPT, you can enter the corresponding API Key directly in the UI. The key will be stored locally in your browser.

## 📁 Project Structure

- `app/`: Next.js App Router routes and API endpoints.
- `components/ui/`: Exquisite React UI components.
- `lib/`: Encapsulated business logic (AI search, cache management, data parsing).
- `types/`: TypeScript type definitions.
- `search-results/`: Automatically generated local search data records.

## 📝 Troubleshooting

1. **No Search Results**: Check if your proxy is enabled or if the `GEMINI_API_KEY` is valid.
2. **AI Analysis Timeout**: Local reasoning models may take longer; please keep the page open.
3. **Rendering Issues**: Ensure the `framer-motion` dependency is installed.

## License

MIT
