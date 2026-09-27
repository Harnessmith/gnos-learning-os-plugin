import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function LessonPage({ useApi, postApi, host, BASE, Page, Loading, Empty, Card, Badge, Navigate, css, SharedRichText, PortalDialog }) {
  const { data: today, isLoading: isLoadingToday } = useApi('/today', ['today'])
  const { data: sessionsData, isLoading: isLoadingSessions } = useApi('/sessions', ['sessions'])
  const sessions = sessionsData?.sessions || []
  const [selectedId, setSelectedId] = useState(null)
  const sessionId = selectedId || today?.session_id
  const { data: session, isLoading: isLoadingSession } = useApi(sessionId ? `/sessions/${sessionId}` : null, ['session', sessionId])
  const [busy, setBusy] = useState(false)
  const [portalOpen, setPortalOpen] = useState(false)
  const changeStatus = async (kind) => {
    setBusy(true)
    try {
      if (kind === 'start') await postApi(`/sessions/${sessionId}/start`)
      else await postApi(`/sessions/${sessionId}/complete`, { actual_topic: session.actual_topic || session.planned_topic, actual_duration: session.planned_duration, next_step: session.next_step })
      host.toast?.(kind === 'start' ? 'Aula iniciada.' : 'Aula concluída.', 'success')
    } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  if (isLoadingToday || isLoadingSessions || isLoadingSession) return jsx(Page, { label: '…', title: 'Aula', children: jsx(Loading, { label: 'aula' }) })
  if (!session) return jsx(Page, { label: 'Aula', title: 'Aula', children: jsx(Empty, { label: 'aula' }) })
  const picker = sessions.length > 1 && jsx('label', {
    style: { display: 'grid', gap: 4, color: 'var(--muted-foreground)', fontSize: 12, minWidth: 260 },
    children: [
      'Aula de hoje',
      jsx('select', {
        className: 'gnos-select', value: sessionId || '', style: { ...css.ghost, width: '100%' },
        onChange: (event) => setSelectedId(event.target.value),
        children: sessions.map((s) => jsx('option', {
          value: s.id,
          children: `${s.track_title ? s.track_title + ' · ' : ''}${s.actual_topic || s.planned_topic}${s.status === 'completed' ? ' (concluída)' : ''}`
        }, s.id))
      })
    ]
  })
  const actions = jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }, children: [
    picker,
    session.status === 'planned' && jsx(Navigate, { primary: true, icon: 'play', onClick: () => changeStatus('start'), children: busy ? 'Iniciando…' : 'Iniciar aula' }),
    session.status === 'in_progress' && jsx(Navigate, { primary: true, icon: 'check', onClick: () => changeStatus('complete'), children: busy ? 'Concluindo…' : 'Concluir aula' }),
    session.portal_path && jsx(Navigate, {
      icon: 'browser', onClick: () => setPortalOpen(true), children: 'Ver conteúdo completo'
    }),
    jsx(Navigate, { path: `${BASE}/lab`, icon: 'beaker', children: 'Abrir laboratório' })
  ] })
  return jsxs('div', { children: [
    jsx(Page, {
      label: session.teacher, title: session.actual_topic || session.planned_topic, subtitle: session.objective, actions,
      children: jsxs('div', { className: 'gnos-two-col', style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 286px', gap: 16 }, children: [
        jsx('section', { style: { display: 'grid', gap: 14 }, children: (session.blocks || []).map(([type, body], index) => {
          const isMedia = ['Diagrama', 'Vídeo', 'Simulação'].includes(type)
          const isCode = ['Código', 'Equação'].includes(type)
          if (isMedia) {
            const clickable = Boolean(session.portal_path)
            return jsx(Card, {
              title: type, icon: blockIcon[type] || 'symbol-misc',
              children: jsxs('button', {
                type: 'button', disabled: !clickable, onClick: () => clickable && setPortalOpen(true),
                style: {
                  width: '100%', textAlign: 'left', border: 'none', borderRadius: 9, padding: 14,
                  fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6,
                  background: 'color-mix(in srgb, var(--foreground) 4%, transparent)',
                  color: clickable ? 'var(--accent-2, var(--accent))' : 'var(--muted-foreground)',
                  cursor: clickable ? 'pointer' : 'default', display: 'flex',
                  alignItems: 'center', justifyContent: 'space-between', gap: 10
                },
                children: [body, clickable && jsx('span', { style: { fontSize: 12, opacity: .85, whiteSpace: 'nowrap' }, children: 'Abrir →' })]
              })
            }, `${type}-${index}`)
          }
          return jsx(Card, {
            title: type, icon: blockIcon[type] || 'symbol-misc',
            children: isCode ? jsx('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 13, background: 'color-mix(in srgb, var(--foreground) 4%, transparent)', padding: 14, borderRadius: 9, lineHeight: 1.6 }, children: body }) : jsx(SharedRichText, { text: body })
          }, `${type}-${index}`)
        }) }),
        jsx('aside', { children: jsxs('div', { style: { position: 'sticky', top: 16, display: 'grid', gap: 14 }, children: [
          jsx(Card, { title: 'Estado da sessão', icon: 'pulse', children: jsxs('div', { children: [jsx(Badge, { state: session.status, children: session.status }), jsx('p', { style: { ...css.subtitle, marginBottom: 0 }, children: `${session.planned_duration || '—'} minutos planejados` })] }) }),
          jsx(Card, { title: 'Próximo passo', icon: 'arrow-swap', children: jsx('p', { style: { margin: 0, lineHeight: 1.55, color: 'var(--muted-foreground)' }, children: session.next_step || 'Aguardando conclusão da aula' }) }),
          jsx(Navigate, { path: `${BASE}/resources`, icon: 'references', children: 'Recursos da sessão' })
        ] }) })
      ] })
    }),
    portalOpen && jsx(PortalDialog, {
      open: portalOpen,
      onOpenChange: setPortalOpen,
      title: session.actual_topic || session.planned_topic,
      kind: 'session',
      ids: { sessionId },
      useApi,
    })
  ] })
}
function TerminalChrome({ children }) {
  return jsxs('div', {
    style: { borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', margin: '14px 0' }, children: [
      jsxs('div', {
        style: { display: 'flex', gap: 6, padding: '9px 12px', background: 'color-mix(in srgb, var(--foreground) 6%, transparent)', borderBottom: '1px solid var(--border)' }, children: [
          jsx('span', { style: { width: 10, height: 10, borderRadius: 999, background: '#e5484d' } }),
          jsx('span', { style: { width: 10, height: 10, borderRadius: 999, background: '#c2760c' } }),
          jsx('span', { style: { width: 10, height: 10, borderRadius: 999, background: '#1a9c5c' } })
        ]
      }),
      jsx('pre', { style: { margin: 0, padding: 14, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, background: 'color-mix(in srgb, var(--foreground) 3%, transparent)' }, children })
    ]
  })
}
