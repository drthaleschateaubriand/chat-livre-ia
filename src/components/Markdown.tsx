import { memo, useRef, useState, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { copyText } from '../lib/clipboard'

function Pre(props: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [ok, setOk] = useState(false)
  const lang = /language-([\w-]+)/.exec((props.children as any)?.props?.className ?? '')?.[1] ?? 'código'
  return (
    <div className="not-prose my-3 overflow-hidden rounded-lg border border-zinc-700 bg-[#0d1117]">
      <div className="flex items-center justify-between bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300">
        <span>{lang}</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-zinc-700"
          onClick={async () => { await copyText(ref.current?.innerText ?? ''); setOk(true); setTimeout(() => setOk(false), 1500) }}
        >
          {ok ? 'Copiado ✓' : 'Copiar código'}
        </button>
      </div>
      <pre ref={ref} className="scroll-thin m-0 overflow-x-auto text-sm leading-relaxed">{props.children}</pre>
    </div>
  )
}

function Table(props: ComponentProps<'table'>) {
  return <div className="scroll-thin my-3 overflow-x-auto"><table {...props} /></div>
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-zinc msg-text max-w-none break-words dark:prose-invert prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: Pre, table: Table, a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
