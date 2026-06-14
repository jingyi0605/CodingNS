import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownTextProps {
  content: string;
  className: string;
  paragraphClassName?: string;
}

export function MarkdownText({
  content,
  className,
  paragraphClassName
}: MarkdownTextProps) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node, className: _className, ...props }) => (
            <p
              {...props}
              className={paragraphClassName}
            />
          )
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
