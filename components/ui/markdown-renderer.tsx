"use client";

/**
 * 简单的 Markdown 渲染器
 * 支持基本的 Markdown 语法，无需外部依赖
 */
export function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  // 处理 Markdown 格式
  const renderMarkdown = (text: string) => {
    // 1. 处理粗体 **text** 或 __text__
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong class="font-bold">$1</strong>');
    
    // 2. 处理斜体 *text* 或 _text_
    text = text.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>');
    text = text.replace(/_(.+?)_/g, '<em class="italic">$1</em>');
    
    // 3. 处理代码 `code`
    text = text.replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-sm font-mono">$1</code>');
    
    // 4. 处理链接 [text](url)
    text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>');
    
    return text;
  };

  // 按行分割并处理
  const lines = content.split('\n');
  const elements: JSX.Element[] = [];
  let listItems: string[] = [];
  let tableRows: string[][] = [];
  let inList = false;
  let inTable = false;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-1 my-2">
          {listItems.map((item, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: renderMarkdown(item) }} />
          ))}
        </ul>
      );
      listItems = [];
    }
    inList = false;
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      // 过滤掉分隔行 (比如 | --- | --- |)
      const rows = tableRows.filter(row => !row.every(cell => /^[ \t\-\:]+$/.test(cell)));
      
      if (rows.length > 0) {
        elements.push(
          <div key={`table-wrapper-${elements.length}`} className="overflow-x-auto my-4 rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {rows[0].map((cell, idx) => (
                    <th key={idx} className="px-4 py-2 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider" dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.trim()) }} />
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-black divide-y divide-gray-200 dark:divide-gray-800">
                {rows.slice(1).map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap" dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.trim()) }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      tableRows = [];
    }
    inTable = false;
  };

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    // 表格行判断: 以 | 开头且包含 |
    if (trimmedLine.startsWith('|') && trimmedLine.includes('|', 1)) {
      flushList();
      inTable = true;
      // 分割单元格并移除首尾的空部分
      const cells = line.split('|').map(c => c.trim()).filter((_, i, arr) => {
        if (i === 0 && line.startsWith('|')) return false;
        if (i === arr.length - 1 && line.endsWith('|')) return false;
        return true;
      });
      tableRows.push(cells);
      return;
    } 
    
    // 如果不是表格行了，刷新表格内容
    if (inTable) {
      flushTable();
    }

    // 空行
    if (!trimmedLine) {
      flushList();
      return;
    }

    // 标题 ## Heading
    if (trimmedLine.startsWith('###')) {
      flushList();
      flushTable();
      const text = trimmedLine.replace(/^###\s*/, '');
      elements.push(
        <h3 key={`h3-${index}`} className="text-lg font-bold mt-4 mb-2" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      );
    } else if (trimmedLine.startsWith('##')) {
      flushList();
      flushTable();
      const text = trimmedLine.replace(/^##\s*/, '');
      elements.push(
        <h2 key={`h2-${index}`} className="text-xl font-bold mt-4 mb-2" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      );
    } else if (trimmedLine.startsWith('#')) {
      flushList();
      flushTable();
      const text = trimmedLine.replace(/^#\s*/, '');
      elements.push(
        <h1 key={`h1-${index}`} className="text-2xl font-bold mt-4 mb-2" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      );
    }
    // 引用 > quote
    else if (trimmedLine.startsWith('>')) {
      flushList();
      flushTable();
      const text = trimmedLine.replace(/^>\s*/, '');
      elements.push(
        <blockquote key={`quote-${index}`} className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 py-1 my-2 text-gray-600 dark:text-gray-400 italic">
          <p dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        </blockquote>
      );
    }
    // 分隔线 ---
    else if (trimmedLine === '---' || trimmedLine === '***' || trimmedLine === '___') {
      flushList();
      flushTable();
      elements.push(<hr key={`hr-${index}`} className="my-6 border-t border-gray-200 dark:border-gray-800" />);
    }
    // 列表项 - item 或 * item
    else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      inList = true;
      flushTable();
      const text = trimmedLine.replace(/^[-*]\s*/, '');
      listItems.push(text);
    }
    // 普通段落
    else {
      flushList();
      flushTable();
      elements.push(
        <p key={`p-${index}`} className="my-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(trimmedLine) }} />
      );
    }
  });

  // 处理剩余的列表项和表格
  flushList();
  flushTable();

  return <div className="markdown-content">{elements}</div>;
}
