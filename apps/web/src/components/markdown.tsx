import * as React from 'react';
import { cn } from '@allingo/ui';
import { parseMarkdown, type Inline } from '@/lib/markdown';

function renderInline(nodes: Inline[]): React.ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return <React.Fragment key={i}>{n.text}</React.Fragment>;
      case 'br':
        return <br key={i} />;
      case 'code':
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {n.text}
          </code>
        );
      case 'strong':
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(n.children)}</em>;
      case 'link':
        return (
          <a
            key={i}
            href={n.href}
            target={n.href.startsWith('/') ? undefined : '_blank'}
            rel="noopener noreferrer nofollow"
            className="font-medium text-primary underline underline-offset-2"
          >
            {renderInline(n.children)}
          </a>
        );
      default:
        return null;
    }
  });
}

/** Hiển thị Markdown ngắn đã parse thành phần tử React (không HTML thô) – xem lib/markdown.ts */
export function Markdown({
  source,
  className,
  ...props
}: { source: string; className?: string } & Omit<React.ComponentProps<'div'>, 'children'>) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className={cn('space-y-2 break-words', className)} {...props}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'p':
            return <p key={i}>{renderInline(b.inline)}</p>;
          case 'heading':
            return (
              <p key={i} className={cn('font-semibold', b.level === 1 && 'text-base')}>
                {renderInline(b.inline)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} start={b.start} className="list-decimal space-y-1 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote key={i} className="border-l-4 border-accent/70 pl-3 text-muted-foreground">
                {renderInline(b.inline)}
              </blockquote>
            );
          case 'code':
            return (
              <pre key={i} className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                {b.text}
              </pre>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
