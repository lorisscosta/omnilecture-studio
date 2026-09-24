'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Info, AlertTriangle, AlertCircle, Lightbulb, CheckCircle2, Bookmark } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Helper to parse Obsidian callout syntax: > [!type] Title
function parseCallout(text: string) {
  const match = text.match(/^\[!([a-zA-Z0-9_-]+)\][ \t]*(.*)/);
  if (match) {
    return {
      type: match[1].toLowerCase(),
      title: match[2].trim(),
    };
  }
  return null;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  return (
    <div className={`academic-markdown prose prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          // Custom Blockquote for Obsidian Callouts
          blockquote({ children, node }) {
            // Check if first child paragraph starts with [!type]
            let calloutType = 'note';
            let calloutTitle = '';
            let isCallout = false;

            // Inspect children elements to detect callout
            const childrenArray = React.Children.toArray(children);
            const firstChild = childrenArray[0];

            if (React.isValidElement(firstChild) && (firstChild.props as any)?.children) {
              const innerChildren = React.Children.toArray((firstChild.props as any).children);
              const firstGrandChild = innerChildren[0];

              if (typeof firstGrandChild === 'string') {
                const parsed = parseCallout(firstGrandChild);
                if (parsed) {
                  isCallout = true;
                  calloutType = parsed.type;
                  calloutTitle = parsed.title || parsed.type.toUpperCase();
                }
              }
            }

            if (isCallout) {
              let icon = <Bookmark className="w-5 h-5 text-indigo-400" />;
              let borderColor = 'border-indigo-500';
              let bgColor = 'bg-indigo-950/20';
              let headerColor = 'text-indigo-300';

              if (calloutType === 'important' || calloutType === 'danger') {
                icon = <AlertCircle className="w-5 h-5 text-rose-400" />;
                borderColor = 'border-rose-500';
                bgColor = 'bg-rose-950/20';
                headerColor = 'text-rose-300';
              } else if (calloutType === 'warning') {
                icon = <AlertTriangle className="w-5 h-5 text-amber-400" />;
                borderColor = 'border-amber-500';
                bgColor = 'bg-amber-950/20';
                headerColor = 'text-amber-300';
              } else if (calloutType === 'tip' || calloutType === 'example') {
                icon = <Lightbulb className="w-5 h-5 text-emerald-400" />;
                borderColor = 'border-emerald-500';
                bgColor = 'bg-emerald-950/20';
                headerColor = 'text-emerald-300';
              } else if (calloutType === 'info') {
                icon = <Info className="w-5 h-5 text-sky-400" />;
                borderColor = 'border-sky-500';
                bgColor = 'bg-sky-950/20';
                headerColor = 'text-sky-300';
              }

              return (
                <div className={`my-4 rounded-lg border-l-4 ${borderColor} ${bgColor} p-4 text-obsidian-textBase shadow-md`}>
                  <div className={`flex items-center gap-2 font-semibold ${headerColor} mb-2`}>
                    {icon}
                    <span>{calloutTitle}</span>
                  </div>
                  <div className="text-sm leading-relaxed text-zinc-300">
                    {children}
                  </div>
                </div>
              );
            }

            return (
              <blockquote className="border-l-4 border-obsidian-border pl-4 my-3 italic text-zinc-400">
                {children}
              </blockquote>
            );
          },
          // Custom Code blocks
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && typeof children === 'string' && !children.includes('\n');
            if (isInline) {
              return (
                <code className="bg-zinc-800 text-purple-300 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          // Custom Tables
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-lg border border-obsidian-border">
                <table className="w-full text-left text-sm text-zinc-300 divide-y divide-obsidian-border">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-zinc-900 text-zinc-200 uppercase text-xs tracking-wider">{children}</thead>;
          },
          th({ children }) {
            return <th className="px-4 py-3 font-semibold">{children}</th>;
          },
          td({ children }) {
            return <td className="px-4 py-3 border-t border-zinc-800/80">{children}</td>;
          },
          // Headings
          h1({ children }) {
            return <h1 className="text-2xl font-bold text-zinc-100 mt-6 mb-3 border-b border-zinc-800 pb-2">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-xl font-semibold text-purple-300 mt-5 mb-2">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-lg font-medium text-zinc-200 mt-4 mb-2">{children}</h3>;
          },
          p({ children }) {
            return <p className="text-zinc-300 leading-relaxed mb-3">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 space-y-1 mb-3 text-zinc-300">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 space-y-1 mb-3 text-zinc-300">{children}</ol>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
