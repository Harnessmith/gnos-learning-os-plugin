import { useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

function State({ children }) {
  return jsx('div', { style: { padding: 28, textAlign: 'center', color: 'var(--muted-foreground)' }, children })
}

export function PortalDialog({ open, onOpenChange, title, kind, ids, useApi }) {
  const { data, isLoading, error } = useApi(
    open ? (kind === 'session' ? `/sessions/${ids.sessionId}/portal` : `/courses/${ids.courseId}/lessons/${ids.lessonId}/portal`) : null,
    ['portal', kind, ids.sessionId || `${ids.courseId}/${ids.lessonId}`],
    { enabled: Boolean(open) },
  )
  const html = data && typeof data === 'object' && 'html' in data ? data.html : (typeof data === 'string' ? data : null)
  const dataUrl = html ? `data:text/html;base64,${btoa(unescape(encodeURIComponent(html)))}` : null
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])
  if (!open) return null
  return jsx('div', {
    className: 'gnos-portal-overlay',
    style: { position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(6,8,12,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw' },
    onClick: (event) => { if (event.target === event.currentTarget) onOpenChange(false) },
    children: jsxs('div', {
      className: 'gnos-portal-dialog',
      style: { width: '92vw', maxWidth: 1200, height: '92vh', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 30px 90px rgba(0,0,0,.5)' },
      children: [
        jsxs('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
          children: [
            jsx('strong', { style: { fontSize: 16 }, children: title || 'Aula completa' }),
            jsx('button', { type: 'button', className: 'gnos-action', onClick: () => onOpenChange(false), 'aria-label': 'Fechar', style: { border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16 }, children: '\u2715' }),
          ],
        }),
        jsx('div', {
          style: { flex: 1, minHeight: 0, padding: '12px 20px 20px' },
          children: isLoading
            ? jsx(State, { children: 'Carregando conteúdo da aula…' })
            : error
              ? jsx(State, { children: `Não foi possível carregar conteúdo da aula: ${String(error?.message || error)}` })
              : dataUrl
                ? jsx('iframe', { src: dataUrl, title: title || 'Aula completa', className: 'gnos-portal-frame', sandbox: 'allow-scripts allow-popups', referrerPolicy: 'no-referrer', style: { width: '100%', height: '100%', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)' } })
                : jsx(State, { children: 'Nada em conteúdo renderizado ainda.' }),
        }),
      ],
    }),
  })
}
