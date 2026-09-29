import { useEffect, useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

function State({ children }) {
  return jsx('div', { style: { padding: 28, textAlign: 'center', color: 'var(--muted-foreground)' }, children })
}

const portalProgressSeen = new Set()

export function PortalDialog({ open, onOpenChange, title, kind, ids, useApi, postApi, host }) {
  const { data, isLoading, error } = useApi(
    open ? (kind === 'session' ? `/sessions/${ids.sessionId}/portal` : `/courses/${ids.courseId}/lessons/${ids.lessonId}/portal`) : null,
    ['portal', kind, ids.sessionId || `${ids.courseId}/${ids.lessonId}`],
    { enabled: Boolean(open) },
  )
  const html = data && typeof data === 'object' && 'html' in data ? data.html : (typeof data === 'string' ? data : null)
  const dataUrl = html ? `data:text/html;base64,${btoa(unescape(encodeURIComponent(html)))}` : null
  const portalUrl = data && typeof data === 'object' && typeof data.portal_url === 'string' && data.portal_url ? data.portal_url : null
  const frameUrl = portalUrl || dataUrl
  const frameRef = useRef(null)
  const closeButtonRef = useRef(null)
  const previousFocusRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    previousFocusRef.current = document.activeElement
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    const onKey = (event) => { if (event.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKey)
      previousFocusRef.current?.focus?.()
    }
  }, [open, onOpenChange])
  const portalOrigin = (() => {
    try { return portalUrl ? new URL(portalUrl).origin : '' } catch { return '' }
  })()
  useEffect(() => {
    if (!open) return undefined
    portalProgressSeen.clear()
    const onMessage = (event) => {
      if (portalOrigin && event.origin !== portalOrigin) return
      if (event.source !== frameRef.current?.contentWindow) return
      const message = event && event.data
      if (!message || message.type !== 'gnos:lesson-progress') return
      if (!message.courseId || !message.lessonId) return
      const key = `${message.lessonId}:${message.state}`
      if (portalProgressSeen.has(key)) return
      portalProgressSeen.add(key)
      postApi(`/courses/${message.courseId}/lessons/${message.lessonId}/progress`, { state: message.state, source: 'portal-viewer' })
        .then(() => {
          if (message.state === 'completed') host.toast?.(`Aula “${message.lessonTitle || message.lessonId}” registrada como concluída.`, 'success')
        })
        .catch((err) => host.toast?.(String(err?.message || err), 'error'))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open, portalOrigin, postApi, host])
  if (!open) return null
  return jsx('div', {
    className: 'gnos-portal-overlay',
    style: { position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(6,8,12,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw' },
    onClick: (event) => { if (event.target === event.currentTarget) onOpenChange(false) },
    children: jsxs('div', {
      className: 'gnos-portal-dialog',
      role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'gnos-portal-title',
      style: { width: '92vw', maxWidth: 1200, height: '92vh', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 30px 90px rgba(0,0,0,.5)' },
      children: [
        jsxs('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
          children: [
            jsx('strong', { id: 'gnos-portal-title', style: { fontSize: 16 }, children: title || 'Aula completa' }),
            jsx('button', { ref: closeButtonRef, type: 'button', className: 'gnos-action', onClick: () => onOpenChange(false), 'aria-label': 'Fechar', style: { border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16 }, children: '\u2715' }),
          ],
        }),
        jsx('div', {
          style: { flex: 1, minHeight: 0, padding: '12px 20px 20px' },
          children: isLoading
            ? jsx(State, { children: 'Carregando conteúdo da aula…' })
            : error
              ? jsx(State, { children: `Não foi possível carregar conteúdo da aula: ${String(error?.message || error)}` })
              : frameUrl
                ? jsx('iframe', { ref: frameRef, key: frameUrl, src: frameUrl, title: title || 'Aula completa', className: 'gnos-portal-frame', sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms', referrerPolicy: 'strict-origin-when-cross-origin', style: { width: '100%', height: '100%', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)' } })
                : jsx(State, { children: 'Nada em conteúdo renderizado ainda.' }),
        }),
      ],
    }),
  })
}
