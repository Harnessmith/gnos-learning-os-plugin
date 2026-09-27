import { jsx, jsxs } from 'react/jsx-runtime'

export function inlineMarkdown(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((part) => part !== '')
  return parts.map((part, index) => part.startsWith('**') && part.endsWith('**') && part.length > 3
    ? jsx('strong', { children: part.slice(2, -2) }, index)
    : jsx('span', { children: part }, index))
}

export function RichText({ text }) {
  const raw = text == null ? '' : String(text)
  if (!raw.trim()) return null
  const paragraphs = raw.split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean)
  return jsx('div', {
    style: { display: 'grid', gap: 12 },
    children: paragraphs.map((paragraph, pIndex) => {
      const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean)
      const isList = lines.length > 0 && lines.every((line) => /^[-•]\s+/.test(line))
      if (isList) {
        return jsx('ul', {
          style: { margin: 0, paddingLeft: 20, display: 'grid', gap: 6 },
          children: lines.map((line, lIndex) => jsx('li', { style: { lineHeight: 1.65, fontSize: 14 }, children: inlineMarkdown(line.replace(/^[-•]\s+/, '')) }, lIndex))
        }, pIndex)
      }
      return jsx('p', {
        style: { margin: 0, lineHeight: 1.7, fontSize: 14 },
        children: lines.map((line, lIndex) => jsxs('span', { children: [inlineMarkdown(line), lIndex < lines.length - 1 ? jsx('br', {}) : null] }, lIndex))
      }, pIndex)
    })
  })
}
