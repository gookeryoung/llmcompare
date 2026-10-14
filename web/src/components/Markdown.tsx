import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CopyButton } from './ui';

function extractText(node: React.ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) return extractText((node.props as any).children);
  return '';
}

/** 统一的 Markdown 渲染（GFM + 代码高亮 + 代码块复制） */
export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ node, children: kids, ...props }: any) => (
            <div style={{ position: 'relative' }}>
              <pre {...props}>{kids}</pre>
              <div style={{ position: 'absolute', top: 6, right: 6, opacity: 0.85 }}>
                <CopyButton text={extractText(kids)} />
              </div>
            </div>
          ),
          a: ({ node, ...props }: any) => <a {...props} target="_blank" rel="noreferrer noopener" />,
          table: ({ node, ...props }: any) => (
            <div style={{ overflowX: 'auto' }}>
              <table {...props} />
            </div>
          ),
        }}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
