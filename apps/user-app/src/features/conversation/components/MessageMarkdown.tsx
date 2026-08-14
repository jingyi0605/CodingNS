import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownTextProps {
  content: string;
  className: string;
  paragraphClassName?: string;
  inline?: boolean;
}

export function MarkdownText({
  content,
  className,
  paragraphClassName,
  inline = false
}: MarkdownTextProps) {
  const RootTag = inline ? "span" : "div";

  return (
    <RootTag className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node, className: _className, ...props }) => (
            inline ? (
              <span
                {...props}
                className={paragraphClassName}
              />
            ) : (
              <p
                {...props}
                className={paragraphClassName}
              />
            )
          ),
          ...(inline
            ? {
                ul: ({ node, className: _className, ...props }) => (
                  <span {...props} />
                ),
                ol: ({ node, className: _className, ...props }) => (
                  <span {...props} />
                ),
                li: ({ node, className: _className, children, ...props }) => (
                  <span {...props}>{children}</span>
                )
              }
            : {})
        }}
      >
        {content}
      </Markdown>
    </RootTag>
  );
}
