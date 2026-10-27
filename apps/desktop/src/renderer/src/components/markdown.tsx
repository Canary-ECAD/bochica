import { Check, Copy } from "lucide-react";
import { type ComponentProps, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

// Raw HTML in model output is never rendered (react-markdown's default). Links open in the
// system browser via the main process' window-open handler.

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{ pre: CodeBlock, a: ExternalLink }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function ExternalLink({ node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noreferrer" />;
}

function CodeBlock({
  node: _node,
  children,
  ...props
}: ComponentProps<"pre"> & { node?: unknown }) {
  const { t } = useTranslation();
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard.writeText(pre.current?.innerText ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        aria-label={t("chat.copyCode")}
        className="absolute top-2 right-2 rounded-md border bg-background/80 p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <pre ref={pre} {...props} className="rounded-lg border font-mono text-[13px]">
        {children}
      </pre>
    </div>
  );
}
