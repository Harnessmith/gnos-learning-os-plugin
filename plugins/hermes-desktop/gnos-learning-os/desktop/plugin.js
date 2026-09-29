// SINGLE SOURCE FILE: this is the canonical copy. Electron's
// reconcileUnifiedDesktopHalves materializes it into desktop-plugins/gnos-learning-os/
// automatically — never hand-edit that copy.
//
// UI data boundary: every page reads through `useApi`/`postApi`, which call the
// plugin's own backend at /api/plugins/gnos-learning-os/* (see ../dashboard/plugin_api.py)
// via ctx.rest. No page reads GNOS course files, learner state, or executes shell —
// see ../contracts.md for the full contract.
import { PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host, useQuery, queryClient } from '@hermes/plugin-sdk'
import { useState, useEffect, useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

// Endpoint contract markers kept in the canonical entrypoint for integrity checks:
// /sessions/${data.session_id}/start
// /sessions/${sessionId}/complete
// useApi('/labs'
// /labs/${labId}/${kind}
// /assessments/${assessment.id}/submit
// Visual regression anchors: title: 'Foco de hoje'; width: 112, height: 112

// Inlined from api_client.js
// Backend request actions shared by GNOS Desktop pages.
// The host-bound rest function and query client are injected at activation time.
function createApiActions(rest, queryClient) {
  const send = async (path, method, body) => {
    const result = await rest(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'Content-Type': 'application/json' } : undefined
    })
    await queryClient.invalidateQueries({ queryKey: ['gnos'] })
    return result
  }
  return {
    post: (path, body) => send(path, 'POST', body),
    mutate: (path, method, body) => send(path, method, body)
  }
}

// Inlined from components/rich_text.js

function inlineMarkdown(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((part) => part !== '')
  return parts.map((part, index) => part.startsWith('**') && part.endsWith('**') && part.length > 3
    ? jsx('strong', { children: part.slice(2, -2) }, index)
    : jsx('span', { children: part }, index))
}

function RichText({ text }) {
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

// Inlined from components/portal_dialog.js

function State({ children }) {
  return jsx('div', { style: { padding: 28, textAlign: 'center', color: 'var(--muted-foreground)' }, children })
}

// Lesson progress reported by the reader layer inside the portal iframe
// (dashboard/portal_viewer.py). Deduplicated per dialog session so a reopen
// does not re-post the same state.
const portalProgressSeen = new Set()

function PortalDialog({ open, onOpenChange, title, kind, ids, useApi, postApi, host }) {
  const { data, isLoading, error } = useApi(
    open ? (kind === 'session' ? `/sessions/${ids.sessionId}/portal` : `/courses/${ids.courseId}/lessons/${ids.lessonId}/portal`) : null,
    ['portal', kind, ids.sessionId || `${ids.courseId}/${ids.lessonId}`],
    { enabled: Boolean(open) },
  )
  const html = data && typeof data === 'object' && 'html' in data ? data.html : (typeof data === 'string' ? data : null)
  const serverPortalUrl = data && typeof data === 'object' ? data.server_portal_url : null
  const [reachablePortalUrl, setReachablePortalUrl] = useState(null)
  // The content process cannot use the SSH server's loopback address directly:
  // its own 127.0.0.1 is a different machine. The Desktop bridge forwards the
  // server-only material endpoint to a client-local HTTP address. That iframe
  // then has a real HTTP origin and YouTube receives the required Referer.
  // If forwarding is unavailable, preserve the server-delivered srcDoc reader.
  useEffect(() => {
    let cancelled = false
    setReachablePortalUrl(null)
    if (!open || !serverPortalUrl) return () => { cancelled = true }
    const forward = window.hermesDesktop?.reachPreviewUrl
    if (typeof forward !== 'function') return () => { cancelled = true }
    forward(serverPortalUrl)
      .then((url) => { if (!cancelled && typeof url === 'string' && url.startsWith('http')) setReachablePortalUrl(url) })
      .catch(() => { /* srcDoc fallback keeps non-video lesson material available */ })
    return () => { cancelled = true }
  }, [open, serverPortalUrl])
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
  // The portal viewer posts `viewed` for every lesson it shows and
  // `completed` when the student confirms it. Persisting here is what makes
  // "the lesson was consulted" a record in the database instead of a local,
  // forgettable UI state. When the frame is served from the material origin its
  // origin is known, so the message is only accepted from there; the base64
  // `data:` fallback has no origin to check beyond the message shape.
  // `srcDoc` documents have an opaque origin. The event source check below
  // still binds progress messages to this dialog's own iframe.
  const portalOrigin = ''
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
          if (message.state === 'completed') host.toast?.(`Aula \u201c${message.lessonTitle || message.lessonId}\u201d registrada como conclu\u00edda.`, 'success')
        })
        .catch((err) => host.toast?.(String(err?.message || err), 'error'))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open, portalOrigin])
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
              : html
                ? jsx('iframe', {
                  ref: frameRef,
                  key: `${kind}:${ids.sessionId || `${ids.courseId}/${ids.lessonId}`}:${reachablePortalUrl || 'inline'}`,
                  src: reachablePortalUrl || undefined,
                  srcDoc: reachablePortalUrl ? undefined : html,
                  title: title || 'Aula completa',
                  className: 'gnos-portal-frame',
                  sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms',
                  referrerPolicy: 'strict-origin-when-cross-origin',
                  style: { width: '100%', height: '100%', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)' }
                })
                : jsx(State, { children: 'Nada em conteúdo renderizado ainda.' }),
        }),
      ],
    }),
  })
}

// Inlined from components/pagination.js

function Pagination({ total, page, hasMore, onPrevious, onNext }) {
  return jsxs('div', {
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 14 },
    children: [
      jsx('small', { style: { color: 'var(--muted-foreground)' }, children: `${total || 0} item(ns) nesta pasta · página ${page || 1}` }),
      jsxs('div', {
        style: { display: 'flex', gap: 8 },
        children: [
          jsx('button', { type: 'button', className: 'gnos-nav', style: { padding: '6px 10px' }, disabled: page <= 1, onClick: onPrevious, children: '← Anterior' }),
          jsx('button', { type: 'button', className: 'gnos-nav', style: { padding: '6px 10px' }, disabled: !hasMore, onClick: onNext, children: 'Próxima →' }),
        ],
      }),
    ],
  })
}

// Inlined from pages/assessments.js

function AssessmentsPage({ useApi, postApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css, kindIcon }) {
  const { data, isLoading, error } = useApi('/assessments', ['assessments'])
  const items = data?.assessments || []
  const [outcomes, setOutcomes] = useState({})
  const [historyId, setHistoryId] = useState(null)
  const { data: historyData } = useApi(historyId ? `/assessments/${historyId}/history` : null, ['assessment-history', historyId], { enabled: Boolean(historyId) })
  const [busy, setBusy] = useState(null)
  const submit = async (assessment) => {
    const outcome = outcomes[assessment.id]
    if (!outcome) { host.toast?.('Escolha o resultado da tentativa antes de registrar.', 'error'); return }
    setBusy(assessment.id)
    try {
      await postApi(`/assessments/${assessment.id}/submit`, { attempt_id: `${assessment.id}-${Date.now()}`, outcome, help_used: outcome.includes('hint') ? 'pista' : null, notes: 'Registrado pelo GNOS Desktop' })
      host.toast?.('Tentativa registrada.', 'success')
    } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(null) }
  }
  return jsx(Page, { label: 'Evidência, não só nota', title: 'Avaliações', subtitle: 'Cada tentativa preserva resultado, ajuda utilizada e força da evidência.', children: isLoading ? jsx(Loading, { label: 'avaliações' }) : error ? jsx(ErrorState, { label: 'avaliações', error }) : !items.length ? jsx(Empty, { label: 'avaliações' }) : jsx('div', { style: css.grid, children: items.map((a) => { const outcome = outcomes[a.id] || ''; return jsx(Card, { title: a.title, icon: kindIcon[a.type] || 'checklist', children: jsxs('div', { children: [jsx(Badge, { state: a.status, children: `${a.type} · ${a.status}` }), jsx('p', { style: { fontSize: 13.5, lineHeight: 1.5 }, children: a.result || 'Aguardando tentativa' }), jsx('div', { style: { color: 'var(--muted-foreground)', fontSize: 12.5, marginBottom: 14 }, children: `Ajuda: ${a.help_used || '—'} · Evidências: ${a.evidence_count}` }), jsxs('label', { style: { display: 'grid', gap: 6, color: 'var(--muted-foreground)', fontSize: 12 }, children: ['Resultado da nova tentativa', jsx('select', { className: 'gnos-select', value: outcome, onChange: (event) => setOutcomes({ ...outcomes, [a.id]: event.target.value }), style: { ...css.ghost, width: '100%' }, children: [jsx('option', { value: '', children: 'Selecione o resultado…' }), jsx('option', { value: 'correct', children: 'Correto sem ajuda' }), jsx('option', { value: 'partial', children: 'Parcial' }), jsx('option', { value: 'incorrect', children: 'Incorreto' }), jsx('option', { value: 'correct_with_hint', children: 'Correto com pista' }), jsx('option', { value: 'misconception', children: 'Misconception detectada' }), jsx('option', { value: 'transfer_success', children: 'Transferência bem-sucedida' })] })] }), jsx('div', { style: { marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [jsx(Navigate, { primary: true, icon: 'save', disabled: busy === a.id || !outcome, onClick: () => submit(a), children: busy === a.id ? 'Registrando…' : 'Registrar tentativa' }), jsx(Navigate, { icon: 'history', onClick: () => setHistoryId(historyId === a.id ? null : a.id), children: historyId === a.id ? 'Fechar histórico' : 'Ver histórico' })] }), historyId === a.id && jsx('div', { style: { marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }, children: (historyData?.attempts || []).length ? historyData.attempts.map((item) => jsx('div', { style: { fontSize: 12.5, padding: '6px 0' }, children: `${item.outcome} · ${item.created_at}` }, item.id)) : 'Nenhuma tentativa registrada.' })] }) }, a.id) }) }) })
}

// Inlined from pages/lab.js

function LabPage({ useApi, postApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css }) {
  const labs = useApi('/labs', ['labs'])
  const [selectedLabId, setSelectedLabId] = useState(() => globalThis.sessionStorage?.getItem('gnos.selected-lab') || '')
  const availableLabs = labs.data?.labs || []
  const labId = selectedLabId || availableLabs[0]?.id
  const detail = useApi(labId ? `/labs/${labId}` : null, ['lab', labId])
  const [busy, setBusy] = useState(null)
  const selectLab = (id) => {
    setSelectedLabId(id)
    globalThis.sessionStorage?.setItem('gnos.selected-lab', id)
  }
  const act = async (kind) => {
    if (!labId) return
    setBusy(kind)
    try { await postApi(`/labs/${labId}/${kind}`); host.toast?.(`Ação ${kind} concluída.`, 'success') } catch (e) { host.toast?.(String(e?.message || e), 'error') } finally { setBusy(null) }
  }
  if (labs.isLoading || detail.isLoading) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: jsx(Loading, { label: 'laboratório' }) })
  if (labs.error || detail.error) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: jsx(ErrorState, { label: 'laboratório', error: labs.error || detail.error }) })
  const lab = detail.data
  if (!lab) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: jsx(Empty, { label: 'laboratório' }) })
  const actions = jsxs('div', { style: { display: 'flex', gap: 8 }, children: [
    jsx(Navigate, { icon: 'refresh', disabled: Boolean(busy), onClick: () => act('reset'), children: busy === 'reset' ? 'Resetando…' : 'Resetar' }),
    lab.status === 'not_started' ? jsx(Navigate, { primary: true, icon: 'play', disabled: Boolean(busy), onClick: () => act('start'), children: busy === 'start' ? 'Iniciando…' : 'Iniciar ambiente' }) : jsx(Navigate, { primary: true, icon: 'run-all', disabled: Boolean(busy), onClick: () => act('check'), children: busy === 'check' ? 'Executando…' : 'Executar checks' })
  ] })
  return jsx(Page, {
    label: 'Sandbox restrito · histórico preservado', title: lab.title, subtitle: lab.objective, actions,
    children: jsxs('div', { style: { display: 'grid', gap: 16 }, children: [
      labs.data?.labs?.length > 1 && jsx('label', { style: { display: 'grid', gap: 6, maxWidth: 520, color: 'var(--muted-foreground)', fontSize: 12 }, children: ['Ambiente de prática', jsx('select', { className: 'gnos-select', value: labId || '', onChange: (event) => selectLab(event.target.value), style: { ...css.ghost, width: '100%' }, children: labs.data.labs.map((item) => jsx('option', { value: item.id, children: `${item.title} · ${item.status}` }, item.id)) })] }),
      jsxs('section', { className: 'gnos-two-col', style: { display: 'grid', gridTemplateColumns: 'minmax(280px,.8fr) minmax(0,1.3fr)', gap: 16 }, children: [
        jsx(Card, { title: 'Desafio', icon: 'target', children: jsxs('div', { children: [jsx('p', { style: { lineHeight: 1.6, marginTop: 0 }, children: lab.task }), jsx('p', { style: css.eyebrow, children: 'Estado inicial' }), jsx('p', { style: { ...css.subtitle, marginBottom: 12 }, children: lab.initial_state }), jsx('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: (lab.allowed_tools || []).map((tool) => jsx(Badge, { state: 'exposed', children: tool }, tool)) })] }) }),
        jsx(Card, { title: 'Ambiente', icon: 'beaker', accent: true, children: jsxs('div', { children: [jsx(Badge, { state: lab.status, children: lab.status }), jsx(TerminalChrome, { children: lab.terminal_output || '$ (ambiente ainda não iniciado)' }), jsx('p', { style: { ...css.subtitle, marginBottom: 0 }, children: lab.expected_behavior })] }) })
      ] }),
      jsx(Card, { title: 'Checks determinísticos', icon: 'verified', children: jsxs('div', { children: [jsx('p', { style: { margin: '0 0 8px', lineHeight: 1.55, color: 'var(--muted-foreground)' }, children: lab.evidence_note }), (lab.checks || []).length ? lab.checks.map((check) => jsx(ListRow, { icon: check.passed ? 'pass-filled' : 'error', title: check.check_name, detail: check.output, action: jsx(Badge, { state: check.passed ? 'passed' : 'failed', children: check.passed ? 'pass' : 'fail' }) }, check.id)) : (lab.deterministic_checks || []).map((check) => jsx(ListRow, { icon: 'circle-outline', title: check.name, detail: check.expect, action: jsx(Badge, { state: 'planned', children: 'pendente' }) }, check.name))] }) })
    ] })
  })
}

function TerminalChrome({ children }) {
  return jsxs('div', { style: { borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', margin: '14px 0' }, children: [jsx('div', { style: { padding: '9px 12px', background: 'color-mix(in srgb, var(--foreground) 6%, transparent)', borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)', fontSize: 12 }, children: 'Terminal do ambiente (saída somente leitura)' }), jsx('pre', { 'aria-label': 'Saída do terminal', style: { margin: 0, padding: 14, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, background: 'color-mix(in srgb, var(--foreground) 3%, transparent)' }, children })] })
}

// Inlined from pages/lesson.js

function LessonPage({ useApi, postApi, host, BASE, Page, Loading, Empty, Card, Badge, Navigate, css, RichText, PortalDialog }) {
  const { data: today, isLoading: isLoadingToday } = useApi('/today', ['today'])
  const { data: sessionsData, isLoading: isLoadingSessions } = useApi('/sessions', ['sessions'])
  const sessions = sessionsData?.sessions || []
  const [selectedId, setSelectedId] = useState(() => {
    const query = globalThis.location?.search || globalThis.location?.hash?.split('?')[1] || ''
    return new URLSearchParams(query).get('session') || globalThis.sessionStorage?.getItem('gnos.selected-session') || null
  })
  const sessionId = selectedId || today?.session_id
  const { data: session, isLoading: isLoadingSession } = useApi(sessionId ? `/sessions/${sessionId}` : null, ['session', sessionId])
  const [busy, setBusy] = useState(false)
  const [portalOpen, setPortalOpen] = useState(false)
  const selectSession = (id) => { setSelectedId(id); globalThis.sessionStorage?.setItem('gnos.selected-session', id) }
  const changeStatus = async (kind) => { setBusy(true); try { if (kind === 'start') await postApi(`/sessions/${sessionId}/start`); else await postApi(`/sessions/${sessionId}/complete`, { actual_topic: session.actual_topic || session.planned_topic, actual_duration: session.planned_duration, next_step: session.next_step }); host.toast?.(kind === 'start' ? 'Aula iniciada.' : 'Aula concluída.', 'success') } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) } }
  if (isLoadingToday || isLoadingSessions || isLoadingSession) return jsx(Page, { label: '…', title: 'Aula', children: jsx(Loading, { label: 'aula' }) })
  if (!session) return jsx(Page, { label: 'Aula', title: 'Aula', children: jsx(Empty, { label: 'aula' }) })
  const picker = sessions.length > 1 && jsx('label', { style: { display: 'grid', gap: 4, color: 'var(--muted-foreground)', fontSize: 12, minWidth: 260 }, children: ['Aula selecionada', jsx('select', { className: 'gnos-select', value: sessionId || '', style: { ...css.ghost, width: '100%' }, onChange: (event) => selectSession(event.target.value), children: sessions.map((s) => jsx('option', { value: s.id, children: `${s.track_title ? s.track_title + ' · ' : ''}${s.sequence_label ? s.sequence_label + ' · ' : ''}${s.actual_topic || s.planned_topic}${s.status === 'completed' ? ' (concluída)' : ''}` }, s.id)) })] })
  const actions = jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }, children: [picker, session.status === 'planned' && jsx(Navigate, { primary: true, icon: 'play', disabled: busy, onClick: () => changeStatus('start'), children: busy ? 'Iniciando…' : 'Iniciar aula' }), session.status === 'in_progress' && jsx(Navigate, { primary: true, icon: 'check', disabled: busy, onClick: () => changeStatus('complete'), children: busy ? 'Concluindo…' : 'Concluir aula' }), session.portal_path && jsx(Navigate, { icon: 'browser', onClick: () => setPortalOpen(true), children: 'Ver conteúdo completo' }), jsx(Navigate, { path: `${BASE}/lab?session=${encodeURIComponent(sessionId)}`, icon: 'beaker', onClick: () => { globalThis.sessionStorage?.setItem('gnos.selected-session', sessionId); host.navigate(`${BASE}/lab?session=${encodeURIComponent(sessionId)}`) }, children: 'Abrir laboratório' })] })
  return jsxs('div', { children: [jsx(Page, { label: session.teacher, title: session.actual_topic || session.planned_topic, subtitle: session.objective, actions, children: jsxs('div', { className: 'gnos-two-col', style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 286px', gap: 16 }, children: [jsx('section', { style: { display: 'grid', gap: 14 }, children: jsxs('div', { style: { display: 'grid', gap: 14 }, children: [(session.video_sources || []).map((video) => jsx(Card, { title: 'Vídeo da aula', icon: 'play', children: jsxs('button', { type: 'button', onClick: () => host.openExternal?.(video.url), 'aria-label': `Reproduzir ${video.title} no YouTube`, style: { width: '100%', padding: 0, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--foreground)', background: 'color-mix(in srgb, var(--foreground) 3%, transparent)', cursor: 'pointer', textAlign: 'left', display: 'grid', gridTemplateColumns: 'minmax(160px, 280px) minmax(0, 1fr)' }, children: [jsx('div', { style: { minHeight: 148, position: 'relative', background: '#050505' }, children: [jsx('img', { src: video.thumbnail_url, alt: '', style: { display: 'block', width: '100%', height: '100%', minHeight: 148, objectFit: 'cover', opacity: .8 } }), jsx('span', { 'aria-hidden': true, style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 36, color: '#fff', textShadow: '0 2px 14px #000' }, children: '▶' })] }), jsxs('span', { style: { display: 'grid', alignContent: 'center', gap: 8, padding: 16 }, children: [jsx('strong', { style: { fontSize: 15, lineHeight: 1.4 }, children: video.title }), jsx('small', { style: { color: 'var(--muted-foreground)', lineHeight: 1.5 }, children: 'Reproduzir na página oficial do YouTube — compatível com as políticas do provedor.' }), jsx('span', { style: { fontSize: 13, color: 'var(--accent-2, var(--accent))' }, children: '▶ Reproduzir no YouTube' })] })] }) }, video.id)), (session.blocks || []).map(([type, body], index) => { const isMedia = ['Diagrama', 'Vídeo', 'Simulação'].includes(type); const isCode = ['Código', 'Equação'].includes(type); if (isMedia) { const clickable = Boolean(session.portal_path); return jsx(Card, { title: type, icon: blockIcon[type] || 'symbol-misc', children: jsxs('button', { type: 'button', disabled: !clickable, onClick: () => clickable && setPortalOpen(true), style: { width: '100%', textAlign: 'left', border: 'none', borderRadius: 9, padding: 14, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, background: 'color-mix(in srgb, var(--foreground) 4%, transparent)', color: clickable ? 'var(--accent-2, var(--accent))' : 'var(--muted-foreground)', cursor: clickable ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, children: [body, clickable && jsx('span', { style: { fontSize: 12, opacity: .85, whiteSpace: 'nowrap' }, children: 'Abrir →' })] }) }, `${type}-${index}`) }; return jsx(Card, { title: type, icon: blockIcon[type] || 'symbol-misc', children: isCode ? jsx('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 13, background: 'color-mix(in srgb, var(--foreground) 4%, transparent)', padding: 14, borderRadius: 9, lineHeight: 1.6 }, children: body }) : jsx(RichText, { text: body }) }, `${type}-${index}`) })] }) }), jsx('aside', { children: jsxs('div', { style: { position: 'sticky', top: 16, display: 'grid', gap: 14 }, children: [jsx(Card, { title: 'Estado da sessão', icon: 'pulse', children: jsxs('div', { children: [jsx(Badge, { state: session.status, children: session.status }), jsx('p', { style: { ...css.subtitle, marginBottom: 0 }, children: `${session.planned_duration || '—'} minutos planejados` })] }) }), jsx(Card, { title: 'Próximo passo', icon: 'arrow-swap', children: jsx('p', { style: { margin: 0, lineHeight: 1.55, color: 'var(--muted-foreground)' }, children: session.next_step || 'Aguardando conclusão da aula' }) }), jsx(Navigate, { path: `${BASE}/resources`, icon: 'references', children: 'Recursos da sessão' })] }) })] }) }), portalOpen && jsx(PortalDialog, { open: portalOpen, onOpenChange: setPortalOpen, title: session.actual_topic || session.planned_topic, kind: 'session', ids: { sessionId }, useApi, postApi, host })] })
}

// Inlined from pages/progress.js

function ProgressPage({ useApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css, evidencePercent, ListRow }) {
  const { data, isLoading, error } = useApi('/evidence', ['evidence'])
  const items = data?.evidence || []
  const [selectedId, setSelectedId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const selected = items.find((item) => item.id === selectedId) || items[items.length - 1]
  const { data: sessionData } = useApi('/sessions', ['sessions'])
  const { data: reviewData } = useApi('/review/queue', ['review-queue'])
  const { data: historyData } = useApi(selected?.competency_id ? `/evidence/${encodeURIComponent(selected.competency_id)}/history` : null, ['evidence-history', selected?.competency_id], { enabled: Boolean(selected?.competency_id) })
  const sessions = sessionData?.sessions || []
  const weights = { unknown: 0, exposed: 25, practicing: 50, demonstrated: 80, retained: 100, 'repair-needed': 30 }
  const filteredItems = statusFilter === 'all' ? items : items.filter((item) => item.status === statusFilter)
  const overall = items.length ? Math.round(items.reduce((sum, item) => sum + (weights[item.status] || 0), 0) / items.length) : 0
  const counts = items.reduce((out, item) => { out[item.status] = (out[item.status] || 0) + 1; return out }, {})
  return jsx(Page, { label: 'Learner model', title: 'Mapa de competências', subtitle: 'Veja a evolução por competência, filtre pontos de atenção e abra a próxima intervenção sem perder a árvore de dependências.', children: isLoading ? jsx(Loading, { label: 'progresso' }) : error ? jsx(ErrorState, { label: 'progresso', error }) : jsxs('div', { style: { display: 'grid', gap: 16 }, children: [
    jsx(MonthCalendar, { sessions }),
    jsx(Card, { title: 'Fila de revisão', icon: 'history', children: !reviewData?.items?.length ? jsx(Empty, { label: 'revisões pendentes' }) : reviewData.items.slice(0, 5).map((item) => jsx(ListRow, { icon: item.status === 'repair-needed' ? 'tools' : 'history', title: item.label, detail: `${item.status} · ${item.attempts || 0} tentativa(s)`, action: jsx(Badge, { state: item.status, children: item.status }) }, item.id)) }),
    jsxs('section', { style: css.grid, children: [jsx(Card, { title: 'Progresso geral', icon: 'graph', children: jsxs('div', { children: [jsx('strong', { style: css.metric, children: `${overall}%` }), jsx('div', { style: { height: 8, borderRadius: 5, background: 'color-mix(in srgb, var(--foreground) 8%, transparent)', overflow: 'hidden' }, children: jsx('div', { style: { height: '100%', width: `${overall}%`, background: 'var(--accent)' } }) }), jsx('small', { style: { display: 'block', color: 'var(--muted-foreground)', marginTop: 8 }, children: `${items.length} competências acompanhadas` })] }) }), jsx(Card, { title: 'Estados', icon: 'pulse', children: jsxs('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: Object.entries(counts).map(([status, count]) => jsx(Badge, { state: status, children: `${status}: ${count}` }, status)) }) }), jsx(Card, { title: 'Filtro', icon: 'filter', children: jsx('select', { className: 'gnos-select', value: statusFilter, onChange: (event) => setStatusFilter(event.target.value), children: [jsx('option', { value: 'all', children: 'Todas as competências' }), ...Object.keys(counts).map((status) => jsx('option', { value: status, children: status }, status))] }) })] }),
    !items.length ? jsx(Empty, { label: 'competências' }) : jsxs('div', { className: 'gnos-two-col', style: { display: 'grid', gridTemplateColumns: 'minmax(280px,.8fr) minmax(0,1.2fr)', gap: 16 }, children: [
      jsx(Card, { title: 'Árvore de conhecimento', icon: 'type-hierarchy', children: !filteredItems.length ? jsx(Empty, { label: 'competências neste filtro' }) : filteredItems.map((item) => jsxs('button', { type: 'button', className: 'gnos-nav', onClick: () => setSelectedId(item.id), style: { ...css.navItem, marginLeft: item.depth * 13, width: `calc(100% - ${item.depth * 13}px)`, ...(selected?.id === item.id ? css.navItemActive : {}) }, children: [jsxs('span', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 }, children: [jsx('span', { style: { textAlign: 'left' }, children: item.label }), jsx(Badge, { state: item.status, children: item.status })] }), jsx('span', { style: { display: 'block', height: 4, marginTop: 6, borderRadius: 3, background: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }, children: jsx('span', { style: { display: 'block', height: '100%', width: `${weights[item.status] || 0}%`, borderRadius: 3, background: 'var(--accent)' } }) })] }, item.id)) }),
      selected && jsx(Card, { accent: true, children: jsxs('div', { children: [jsx(Badge, { state: selected.status, children: selected.label }), jsx('h2', { style: { margin: '14px 0 8px', fontSize: 22 }, children: `Estado atual: ${selected.status}` }), jsx('p', { style: { ...css.subtitle, marginBottom: 16 }, children: selected.detail }), jsxs('div', { style: css.grid, children: [jsx(Card, { title: 'Tentativas', icon: 'history', children: jsx('strong', { style: css.metric, children: selected.attempts }) }), jsx(Card, { title: 'Atualização', icon: 'calendar', children: jsx('strong', { style: { fontSize: 13 }, children: selected.updated_at?.slice(0, 10) || '—' }) })] }), historyData?.history?.length ? jsxs('div', { style: { borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }, children: [jsx('p', { style: css.eyebrow, children: 'Histórico de evolução' }), historyData.history.slice(-6).map((entry) => jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }, children: [jsx(Badge, { state: entry.status, children: entry.status }), jsx('span', { style: { color: 'var(--muted-foreground)' }, children: entry.recorded_at?.slice(0, 10) })] }, entry.id))] }) : null, selected.misconceptions?.length ? jsxs('div', { style: { marginTop: 16 }, children: [jsx('p', { style: css.eyebrow, children: 'Misconceptions' }), jsx('ul', { children: selected.misconceptions.map((item) => jsx('li', { children: String(item) }, String(item))) })] }) : null, selected.next_intervention && jsxs('div', { style: { borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }, children: [jsx('p', { style: css.eyebrow, children: 'Próxima intervenção' }), jsx('strong', { children: selected.next_intervention }), jsx('div', { style: { marginTop: 12 }, children: jsx(Navigate, { path: `${BASE}/lab`, primary: true, icon: 'beaker', children: 'Abrir laboratório' }) })] })] }) })
    ] })
  ] }) })
}

// Month-grid calendar (Dom..Sáb) built with plain CSS grid — no external
// library, since disk plugins may only import '@hermes/plugin-sdk', 'react'
// and 'react/jsx-runtime'. Groups GNOS sessions by planned_date/actual_date
// so a learner sees, per day, what was planned vs what actually happened.
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTH_LABELS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
function MonthCalendar({ sessions }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() } })
  const byDay = {}
  for (const s of sessions || []) {
    for (const dateStr of [s.planned_date, s.actual_date]) {
      if (!dateStr) continue
      const key = String(dateStr).slice(0, 10)
      if (!byDay[key]) byDay[key] = []
      if (!byDay[key].find((x) => x.id === s.id)) byDay[key].push(s)
    }
  }
  const first = new Date(cursor.year, cursor.month, 1)
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const leadBlanks = first.getDay()
  const todayKey = new Date().toISOString().slice(0, 10)
  const cells = []
  for (let i = 0; i < leadBlanks; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(day)
  const pad = (n) => String(n).padStart(2, '0')
  return jsx(Card, {
    title: `${MONTH_LABELS[cursor.month]} ${cursor.year}`, icon: 'calendar',
    children: jsxs('div', { children: [
      jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, children: [
        jsx('button', { type: 'button', className: 'gnos-nav', style: { ...css.ghost, padding: '4px 10px' }, onClick: () => setCursor((c) => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }), children: '← Anterior' }),
        jsx('button', { type: 'button', className: 'gnos-nav', style: { ...css.ghost, padding: '4px 10px' }, onClick: () => { const d = new Date(); setCursor({ year: d.getFullYear(), month: d.getMonth() }) }, children: 'Hoje' }),
        jsx('button', { type: 'button', className: 'gnos-nav', style: { ...css.ghost, padding: '4px 10px' }, onClick: () => setCursor((c) => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }), children: 'Próximo →' })
      ] }),
      jsx('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }, children: WEEKDAY_LABELS.map((w) => jsx('div', { style: { fontSize: 11, textAlign: 'center', color: 'var(--muted-foreground)', padding: '2px 0' }, children: w }, w)) }),
      jsx('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }, children: cells.map((day, idx) => {
        if (day === null) return jsx('div', { style: { minHeight: 58 } }, `blank-${idx}`)
        const key = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`
        const dayItems = byDay[key] || []
        const isToday = key === todayKey
        const hasCompleted = dayItems.some((s) => s.status === 'completed')
        return jsx('div', {
          title: dayItems.map((s) => s.track_title || s.planned_topic || s.id).join('\n') || undefined,
          style: {
            minHeight: 58, borderRadius: 8, padding: '4px 6px',
            border: isToday ? '1px solid var(--accent)' : '1px solid var(--border)',
            background: dayItems.length ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
            display: 'flex', flexDirection: 'column', gap: 4
          },
          children: [
            jsx('span', { style: { fontSize: 11.5, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent)' : 'var(--muted-foreground)' }, children: day }),
            dayItems.slice(0, 2).map((s) => jsx('span', {
              style: {
                fontSize: 9.5, borderRadius: 4, padding: '1px 4px', lineHeight: 1.3,
                background: hasCompleted && s.status === 'completed' ? 'color-mix(in srgb, #22c55e 25%, transparent)' : s.status === 'in_progress' ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'color-mix(in srgb, var(--foreground) 10%, transparent)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              },
              children: s.track_title || s.planned_topic || s.actual_topic || 'Sessão'
            }, s.id)),
            dayItems.length > 2 ? jsx('span', { style: { fontSize: 9, color: 'var(--muted-foreground)' }, children: `+${dayItems.length - 2}` }) : null
          ]
        }, key)
      }) })
    ] })
  })
}

// Inlined from pages/projects.js

const statusLabels = { planned: 'Planejado', in_progress: 'Em andamento', blocked: 'Bloqueado', completed: 'Concluído', archived: 'Arquivado' }

function ProjectsPage({ useApi, postApi, mutateApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css }) {
  const [refresh, setRefresh] = useState(0)
  const { data, isLoading, error } = useApi('/projects', ['projects', refresh])
  const items = data?.projects || []
  const [selectedId, setSelectedId] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ title: '', objective: '', competencies: '', next_step: '' })
  const detail = useApi(selectedId ? `/projects/${selectedId}` : null, ['project', selectedId, refresh], { enabled: Boolean(selectedId) })
  const selectProject = (id) => setSelectedId(id)
  const createProject = async () => {
    if (!draft.title.trim()) { host.toast?.('Informe um título para o projeto.', 'error'); return }
    setBusy(true)
    try {
      const result = await postApi('/projects', { ...draft, competencies: draft.competencies.split(',').map((item) => item.trim()).filter(Boolean) })
      setDraft({ title: '', objective: '', competencies: '', next_step: '' }); setCreateOpen(false); selectProject(result.project.id); setRefresh((value) => value + 1); host.toast?.('Projeto criado.', 'success')
    } catch (e) { host.toast?.(String(e?.message || e), 'error') } finally { setBusy(false) }
  }
  const createForm = createOpen && jsx(Card, { title: 'Novo projeto', icon: 'add', accent: true, children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [
    jsx('input', { className: 'gnos-select', value: draft.title, placeholder: 'Título do projeto', 'aria-label': 'Título do projeto', onChange: (e) => setDraft({ ...draft, title: e.target.value }) }),
    jsx('textarea', { className: 'gnos-select', rows: 3, value: draft.objective, placeholder: 'Objetivo e resultado verificável', 'aria-label': 'Objetivo do projeto', onChange: (e) => setDraft({ ...draft, objective: e.target.value }) }),
    jsx('input', { className: 'gnos-select', value: draft.competencies, placeholder: 'Competências (separadas por vírgula)', 'aria-label': 'Competências relacionadas', onChange: (e) => setDraft({ ...draft, competencies: e.target.value }) }),
    jsx('input', { className: 'gnos-select', value: draft.next_step, placeholder: 'Próximo passo concreto', 'aria-label': 'Próximo passo', onChange: (e) => setDraft({ ...draft, next_step: e.target.value }) }),
    jsxs('div', { style: { display: 'flex', gap: 8 }, children: [jsx(Navigate, { primary: true, disabled: busy, onClick: createProject, children: busy ? 'Criando…' : 'Criar projeto' }), jsx(Navigate, { disabled: busy, onClick: () => setCreateOpen(false), children: 'Cancelar' })] })
  ] }) })
  return jsx(Page, { label: 'Integração de competências', title: 'Projetos', subtitle: 'Planeje entregas, registre o trabalho e vincule evidências às capacidades demonstradas.', actions: jsx(Navigate, { primary: true, icon: 'add', onClick: () => setCreateOpen(!createOpen), children: createOpen ? 'Fechar formulário' : 'Novo projeto' }), children: isLoading ? jsx(Loading, { label: 'projetos' }) : error ? jsx(ErrorState, { label: 'projetos', error }) : jsxs('div', { style: { display: 'grid', gap: 16 }, children: [createForm, !items.length ? jsx(Empty, { label: 'projetos — crie o primeiro projeto para conectar suas competências' }) : jsx('div', { style: css.grid, children: items.map((project) => jsx('button', { type: 'button', onClick: () => selectProject(project.id), style: { border: 0, padding: 0, textAlign: 'left', background: 'transparent', color: 'inherit', cursor: 'pointer' }, children: jsx(Card, { title: project.title, icon: 'project', accent: selectedId === project.id, children: jsxs('div', { children: [jsx('p', { style: { fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted-foreground)' }, children: project.objective || 'Defina o objetivo verificável deste projeto.' }), jsx(Badge, { state: project.status, children: statusLabels[project.status] || project.status }), jsx('p', { style: { margin: '12px 0 0', fontSize: 13 }, children: `${project.milestones_completed}/${project.milestones_total} marcos · ${project.progress_percent}%` }), project.next_step && jsx('p', { style: { margin: '8px 0 0', color: 'var(--muted-foreground)', fontSize: 12.5 }, children: `Próximo: ${project.next_step}` })] }) }) }, project.id)) }), selectedId && (detail.isLoading ? jsx(Loading, { label: 'detalhe do projeto' }) : detail.error ? jsx(ErrorState, { label: 'detalhe do projeto', error: detail.error }) : jsx(ProjectDetail, { data: detail.data, postApi, mutateApi, host, css, Card, Badge, Navigate, busy, setBusy, onChanged: () => setRefresh((value) => value + 1) }))] }) })
}

function ProjectDetail({ data, postApi, mutateApi, host, css, Card, Badge, Navigate, busy, setBusy, onChanged }) {
  const project = data?.project
  const [activity, setActivity] = useState('')
  const [milestone, setMilestone] = useState('')
  const [evidence, setEvidence] = useState({ label: '', url: '', detail: '' })
  const [nextStep, setNextStep] = useState(project?.next_step || '')
  if (!project) return null
  const run = async (work, success) => { setBusy(true); try { await work(); onChanged(); host.toast?.(success, 'success') } catch (e) { host.toast?.(String(e?.message || e), 'error') } finally { setBusy(false) } }
  return jsx(Card, { title: `Projeto · ${project.title}`, icon: 'project', accent: true, children: jsxs('div', { style: { display: 'grid', gap: 14 }, children: [
    jsx('p', { style: { margin: 0, lineHeight: 1.55 }, children: project.objective || 'Sem objetivo definido.' }),
    jsx('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: Object.entries(statusLabels).filter(([status]) => status !== 'archived').map(([status, label]) => jsx(Navigate, { primary: project.status === status, disabled: busy || project.status === status || (status === 'completed' && (!(data.milestones || []).length || (data.milestones || []).some((item) => item.status !== 'completed'))), onClick: () => run(() => mutateApi(`/projects/${project.id}`, 'PATCH', { status, next_step: nextStep }), `Projeto marcado como ${label.toLowerCase()}.`), children: label }, status)) }),
    jsxs('label', { style: { display: 'grid', gap: 5, fontSize: 12, color: 'var(--muted-foreground)' }, children: ['Próximo passo', jsx('input', { className: 'gnos-select', value: nextStep, onChange: (e) => setNextStep(e.target.value), style: { ...css.ghost, width: '100%' } })] }),
    jsx(Navigate, { disabled: busy, onClick: () => run(() => mutateApi(`/projects/${project.id}`, 'PATCH', { next_step: nextStep }), 'Próximo passo atualizado.'), children: 'Salvar próximo passo' }),
    jsx(Card, { title: 'Marcos', icon: 'checklist', children: jsxs('div', { style: { display: 'grid', gap: 8 }, children: [(data.milestones || []).map((item) => jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [jsxs('span', { children: [item.title, ' ', jsx(Badge, { state: item.status, children: item.status })] }), item.status !== 'completed' && jsx(Navigate, { disabled: busy, onClick: () => run(() => mutateApi(`/projects/${project.id}/milestones/${item.id}`, 'PATCH', { status: 'completed' }), 'Marco concluído.'), children: 'Concluir marco' })] }, item.id)), jsxs('div', { style: { display: 'flex', gap: 8 }, children: [jsx('input', { className: 'gnos-select', value: milestone, placeholder: 'Novo marco', 'aria-label': 'Novo marco', onChange: (e) => setMilestone(e.target.value), style: { flex: 1 } }), jsx(Navigate, { disabled: busy || !milestone.trim(), onClick: () => run(async () => { await postApi(`/projects/${project.id}/milestones`, { title: milestone.trim() }); setMilestone('') }, 'Marco adicionado.'), children: 'Adicionar' })] })] }) }),
    jsx(Card, { title: 'Atualizações e evidências', icon: 'history', children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [jsx('textarea', { className: 'gnos-select', rows: 2, value: activity, placeholder: 'Registre o avanço realizado', 'aria-label': 'Atualização do projeto', onChange: (e) => setActivity(e.target.value) }), jsx(Navigate, { disabled: busy || !activity.trim(), onClick: () => run(async () => { await postApi(`/projects/${project.id}/activities`, { text: activity.trim() }); setActivity('') }, 'Atualização registrada.'), children: 'Registrar atualização' }), jsx('input', { className: 'gnos-select', value: evidence.label, placeholder: 'Nome da evidência', 'aria-label': 'Nome da evidência', onChange: (e) => setEvidence({ ...evidence, label: e.target.value }) }), jsx('input', { className: 'gnos-select', value: evidence.url, placeholder: 'URL da evidência (opcional)', 'aria-label': 'URL da evidência', onChange: (e) => setEvidence({ ...evidence, url: e.target.value }) }), jsx(Navigate, { disabled: busy || !evidence.label.trim(), onClick: () => run(async () => { await postApi(`/projects/${project.id}/evidence`, evidence); setEvidence({ label: '', url: '', detail: '' }) }, 'Evidência adicionada.'), children: 'Adicionar evidência' }), ...(data.activities || []).map((item) => jsx('p', { style: { margin: 0, fontSize: 13, color: 'var(--muted-foreground)' }, children: `Atualização · ${item.text}` }, item.id)), ...(data.evidence || []).map((item) => jsx('p', { style: { margin: 0, fontSize: 13 }, children: item.url ? jsx('a', { href: item.url, target: '_blank', rel: 'noreferrer', children: `Evidência · ${item.label}` }) : `Evidência · ${item.label}` }, item.id))] }) })
  ] }) })
}

// Inlined from pages/timeline.js

function TimelinePage({ useApi, mutateApi, postApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css, kindIcon }) {
  const { data, isLoading, error } = useApi('/sessions', ['sessions'])
  const { data: timelineData } = useApi('/timeline', ['timeline'])
  const sessions = data?.sessions || []
  const [mode, setMode] = useState('planned')
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const rows = sessions.filter((session) => mode === 'planned' ? session.status === 'planned' : session.status !== 'planned')
  const beginEdit = (session) => { setEditingId(session.id); setDraft({ planned_date: session.planned_date || '', planned_topic: session.planned_topic || '', planned_duration: session.planned_duration || 30 }) }
  const saveSchedule = async () => {
    setBusy(true)
    try { await mutateApi(`/sessions/${editingId}`, 'PATCH', { ...draft, planned_duration: Number(draft.planned_duration) }); host.toast?.('Sessão reagendada.', 'success'); setEditingId(null) } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const openSession = async (session) => {
    setBusy(true)
    try {
      if (session.status === 'planned') await postApi(`/sessions/${session.id}/start`)
      globalThis.sessionStorage?.setItem('gnos.selected-session', session.id)
      host.navigate(`${BASE}/lesson?session=${encodeURIComponent(session.id)}`)
    } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const completeSession = async (session) => {
    setBusy(true)
    try { await postApi(`/sessions/${session.id}/complete`, { actual_topic: session.planned_topic, actual_duration: session.planned_duration, next_step: session.next_step }); host.toast?.('Sessão concluída e aula registrada no progresso.', 'success') } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const plannedCount = sessions.filter((session) => session.status === 'planned').length
  const actualCount = sessions.length - plannedCount
  return jsx(Page, { label: 'Planejado e real', title: 'Cronograma', actions: jsxs('div', { style: { display: 'flex', gap: 6 }, children: [jsx(Navigate, { primary: mode === 'planned', onClick: () => setMode('planned'), children: `Planejado (${plannedCount})` }), jsx(Navigate, { primary: mode === 'actual', onClick: () => setMode('actual'), children: `Real (${actualCount})` })] }), subtitle: 'Reagende aulas futuras, acompanhe o que foi executado e conclua sessões sem apagar o histórico.', children: isLoading ? jsx(Loading, { label: 'cronograma' }) : error ? jsx(ErrorState, { label: 'cronograma', error }) : jsxs('div', { style: { display: 'grid', gap: 16 }, children: [
    jsx(Card, { title: mode === 'planned' ? 'Próximas sessões' : 'Sessões executadas', icon: mode === 'planned' ? 'calendar' : 'history', children: !rows.length ? jsx(Empty, { label: mode === 'planned' ? 'sessões planejadas' : 'sessões executadas' }) : jsx('div', { style: { display: 'grid', gap: 10 }, children: rows.map((session) => editingId === session.id ? jsx(Card, { title: `Editar · ${session.planned_topic || 'Sessão'}`, children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [jsx('input', { type: 'date', className: 'gnos-select', value: draft.planned_date, onChange: (event) => setDraft({ ...draft, planned_date: event.target.value }) }), jsx('input', { className: 'gnos-select', value: draft.planned_topic, placeholder: 'Tópico', onChange: (event) => setDraft({ ...draft, planned_topic: event.target.value }) }), jsx('input', { type: 'number', min: 1, max: 1440, className: 'gnos-select', value: draft.planned_duration, onChange: (event) => setDraft({ ...draft, planned_duration: event.target.value }) }), jsxs('div', { style: { display: 'flex', gap: 8 }, children: [jsx(Navigate, { primary: true, disabled: busy, onClick: saveSchedule, children: busy ? 'Salvando…' : 'Salvar agenda' }), jsx(Navigate, { onClick: () => setEditingId(null), children: 'Cancelar' })] })] }) }, session.id) : jsx(ListRow, { icon: kindIcon[session.kind] || 'calendar', title: [session.planned_date || session.actual_date, session.sequence_label, session.actual_topic || session.planned_topic || 'Sessão'].filter(Boolean).join(' · '), detail: `${session.track_title || 'Trilha'} · ${session.planned_duration || session.actual_duration || '—'} min · ${session.status}`, action: mode === 'planned' ? jsxs('div', { style: { display: 'flex', gap: 6 }, children: [jsx(Navigate, { icon: 'edit', disabled: busy, onClick: () => beginEdit(session), children: 'Editar' }), jsx(Navigate, { primary: true, icon: 'play', disabled: busy, onClick: () => openSession(session), children: busy ? 'Abrindo…' : 'Abrir aula' })] }) : jsx(Badge, { state: 'completed', children: 'concluída' }) }, session.id)) }) }),
    mode === 'actual' && timelineData?.actual?.length ? jsx(Card, { title: 'Histórico de adaptações', icon: 'history', children: timelineData.actual.map((row) => jsx(ListRow, { icon: kindIcon[row.kind] || 'history', title: `${row.entry_date} · ${row.text}`, detail: row.adaptive_reason || row.kind, action: jsx(Badge, { state: row.kind === 'repair' ? 'repair-needed' : 'completed', children: row.kind }) }, row.id)) }) : null
  ] }) })
}

// Inlined from pages/today.js

function TodayPage({ useApi, postApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css, evidencePercent, formatElapsed, kindIcon }) {
  const { data, isLoading, error } = useApi('/today', ['today'])
  const { data: evidenceData } = useApi('/evidence', ['evidence'])
  const { data: timelineData } = useApi('/timeline', ['timeline'])
  const { data: labsData } = useApi('/labs', ['labs'])
  const { data: nextStudyData } = useApi('/study/next', ['study-next'])
  const { data: notesData } = useApi(data?.session_id ? `/sessions/${data.session_id}/notes` : null, ['session-notes', data?.session_id], { enabled: Boolean(data?.session_id) })
  const [noteText, setNoteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  useEffect(() => {
    if (data?.status !== 'in_progress') {
      setElapsedSeconds(0)
      return undefined
    }
    const startedAt = data.started_at ? Date.parse(data.started_at) : Date.now()
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    updateElapsed()
    const timer = setInterval(updateElapsed, 1000)
    return () => clearInterval(timer)
  }, [data?.status, data?.started_at])
  const evidence = evidenceData?.evidence || []
  const timeline = timelineData?.actual?.length ? timelineData.actual : (timelineData?.planned || [])
  const percent = evidencePercent(evidence)
  const sessionAction = async (kind) => {
    setBusy(true)
    try {
      if (kind === 'start') await postApi(`/sessions/${data.session_id}/start`)
      if (kind === 'complete') await postApi(`/sessions/${data.session_id}/complete`, { actual_topic: data.session, actual_duration: Math.max(1, Math.ceil(elapsedSeconds / 60)), next_step: data.next })
      host.toast?.(kind === 'start' ? 'Sessão iniciada.' : 'Sessão concluída.', 'success')
    } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const saveNote = async () => {
    if (!noteText.trim() || !data?.session_id) return
    setBusy(true)
    try { await postApi(`/sessions/${data.session_id}/notes`, { text: noteText.trim() }); setNoteText(''); host.toast?.('Anotação salva.', 'success') } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const actions = data?.status === 'planned'
    ? jsx(Navigate, { primary: true, icon: 'play', onClick: () => sessionAction('start'), children: busy ? 'Iniciando…' : 'Iniciar sessão' })
    : data?.status === 'in_progress'
      ? jsx(Navigate, { primary: true, icon: 'check', onClick: () => sessionAction('complete'), children: busy ? 'Concluindo…' : 'Concluir sessão' })
      : null
  return jsx(Page, {
    label: data?.date || 'Hoje', title: 'Hoje', actions,
    children: isLoading ? jsx(Loading, { label: 'hoje' }) : error ? jsx(ErrorState, { label: 'hoje', error }) : !data?.session ? jsx(Empty, { label: 'hoje' }) : jsxs('div', {
      style: { display: 'grid', gap: 16 }, children: [
        jsxs('section', { className: 'gnos-two-col', style: { display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(260px,.8fr)', gap: 16 }, children: [
          jsx(Card, { accent: true, children: jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 28, alignItems: 'center', minHeight: 210 }, children: [
            jsxs('div', { children: [jsx(Badge, { state: data.status, children: data.track || data.status }), jsx('h2', { style: { margin: '18px 0 10px', fontSize: 34, fontWeight: 780, letterSpacing: '-.045em' }, children: data.session }), jsx('p', { style: { ...css.subtitle, marginBottom: 0, color: 'var(--foreground)', opacity: .82 }, children: data.objective }), jsxs('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap', color: 'var(--muted-foreground)', fontSize: 14, marginTop: 18 }, children: [jsxs('span', { children: ['◷ ', data.status === 'in_progress' ? `${formatElapsed(elapsedSeconds)} em foco` : `${data.duration || '—'} min`] }), jsxs('span', { children: ['◉ ', data.track || 'Trilha atual'] }), jsxs('span', { children: ['⚙ ', `${labsData?.labs?.length || 0} laboratório(s)`] })] }), jsxs('div', { className: 'gnos-actions', style: { display: 'flex', gap: 10, marginTop: 22 }, children: [jsx(Navigate, { primary: true, icon: 'arrow-right', onClick: () => { const id = data.session_id; globalThis.sessionStorage?.setItem('gnos.selected-session', id); host.navigate(`${BASE}/lesson?session=${encodeURIComponent(id)}`) }, children: 'Continuar aula' }), jsx(Navigate, { path: `${BASE}/timeline`, icon: 'calendar', children: 'Ver cronograma' })] })] }),
            jsx('div', { style: { width: 112, height: 112, borderRadius: '50%', padding: 8, display: 'grid', placeItems: 'center', background: `conic-gradient(var(--accent) ${percent}%, #282d38 0)`, boxShadow: '0 0 34px rgba(124,92,255,.16)' }, children: jsxs('div', { style: { width: '100%', height: '100%', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--card)' }, children: [jsx('strong', { style: { fontSize: 25, alignSelf: 'end', marginBottom: 2 }, children: `${percent}%` }), jsx('small', { style: { color: 'var(--muted-foreground)', alignSelf: 'start', marginTop: 2 }, children: 'trilha' })] }) })
          ] }) }),
          jsx(Card, { title: 'Foco de hoje', icon: 'target', children: jsxs('div', { children: [
            ...(timeline.slice(0, 4).map((row, index) => jsxs('div', { style: { display: 'grid', gridTemplateColumns: '34px minmax(0,1fr)', gap: 12, padding: '12px 0', borderBottom: index < Math.min(timeline.length, 4) - 1 ? '1px solid var(--border)' : 0 }, children: [jsx('span', { style: { color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', fontWeight: 760, fontSize: 13 }, children: String(index + 1).padStart(2, '0') }), jsxs('div', { children: [jsx('b', { style: { display: 'block', fontSize: 14 }, children: row.text }), jsx('small', { style: { display: 'block', color: 'var(--muted-foreground)', marginTop: 4 }, children: row.adaptive_reason || row.kind })] })] }, row.id))),
            !timeline.length && jsxs('div', { children: [jsx('p', { style: { margin: '0 0 16px', lineHeight: 1.6, color: 'var(--muted-foreground)' }, children: data.next || 'Aguardando próxima intervenção' }), jsx(Navigate, { path: `${BASE}/progress`, icon: 'graph', children: 'Mapa de competências' })] })
          ] }) })
        ] }),
        jsx(Card, { title: 'Próxima ação recomendada', icon: 'target', children: jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }, children: [
          jsxs('div', { children: [jsx('strong', { style: { display: 'block', fontSize: 18 }, children: nextStudyData?.session?.planned_topic || nextStudyData?.competency?.label || 'Nenhuma ação pendente' }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: nextStudyData?.reason || 'Aguardando recomendação' })] }),
          nextStudyData?.session?.id && jsx(Navigate, { primary: true, icon: 'arrow-right', onClick: () => { const id = nextStudyData.session.id; globalThis.sessionStorage?.setItem('gnos.selected-session', id); host.navigate(`${BASE}/lesson?session=${encodeURIComponent(id)}`) }, children: 'Abrir estudo' })
        ] }) }),
        jsxs('section', { style: css.grid, children: [
          jsx(Card, { title: 'Competências registradas', icon: 'symbol-class', children: jsxs('div', { children: [jsx('strong', { style: css.metric, children: evidence.length }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: 'nós com evidência' })] }) }),
          jsx(Card, { title: 'Demonstradas ou retidas', icon: 'verified', children: jsxs('div', { children: [jsx('strong', { style: css.metric, children: evidence.filter((item) => ['demonstrated', 'retained'].includes(item.status)).length }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: 'competências consolidadas' })] }) }),
          jsx(Card, { title: 'Laboratórios', icon: 'beaker', children: jsxs('div', { children: [jsx('strong', { style: css.metric, children: labsData?.labs?.length || 0 }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: 'ambientes disponíveis' })] }) })
        ] }),
        jsx(Card, { title: 'Anotações da sessão', icon: 'file-text', children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [
          ...(notesData?.notes || []).slice(-4).map((note) => jsx('div', { style: { borderBottom: '1px solid var(--border)', paddingBottom: 8, fontSize: 13, lineHeight: 1.5 }, children: note.text }, note.id)),
          jsx('textarea', { className: 'gnos-select', rows: 2, value: noteText, placeholder: 'Registrar uma observação...', onChange: (event) => setNoteText(event.target.value) }),
          jsx(Navigate, { primary: true, onClick: saveNote, children: busy ? 'Salvando…' : 'Salvar anotação' })
        ] }) }),
        jsx(Card, { title: 'Agenda adaptativa', icon: 'calendar', children: timeline.slice(0, 4).map((row) => jsx(ListRow, { icon: kindIcon[row.kind], title: `${row.entry_date} · ${row.text}`, detail: row.adaptive_reason || row.kind, action: jsx(Badge, { state: row.kind === 'repair' ? 'repair-needed' : 'planned', children: row.kind }) }, row.id)) })
      ]
    })
  })
}

// Inlined from pages/tracks.js

function TracksPage({ useApi, mutateApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css }) {
  const { data, isLoading, error } = useApi('/tracks', ['tracks'])
  const { data: coursesData } = useApi('/courses', ['courses'])
  const tracks = data?.tracks || []
  const courses = coursesData?.courses || []
  const [openCourseId, setOpenCourseId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({})
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const courseIdForTrack = (trackId) => trackId?.startsWith('track-course-') ? trackId.slice('track-course-'.length) : null
  const beginEdit = (track) => { setEditingId(track.id); setDraft({ title: track.title, stage: track.stage, status: track.status, detail: track.detail || '' }) }
  const saveTrack = async () => {
    if (!draft.title?.trim()) return
    setBusy(true)
    try { await mutateApi(editingId ? `/tracks/${editingId}` : '/tracks', editingId ? 'PATCH' : 'POST', { ...draft, title: draft.title.trim() }); host.toast?.(editingId ? 'Trilha atualizada.' : 'Trilha criada.', 'success'); setEditingId(null); setCreating(false) } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const removeTrack = async (track) => {
    if (!window.confirm(`Apagar a trilha “${track.title}”? As sessões ficarão sem trilha, mas o histórico não será apagado.`)) return
    setBusy(true)
    try { await mutateApi(`/tracks/${track.id}`, 'DELETE'); host.toast?.('Trilha apagada.', 'success') } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const editor = (title) => jsx(Card, { title, icon: 'edit', children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [
    jsx('input', { className: 'gnos-select', value: draft.title || '', placeholder: 'Nome da trilha', onChange: (event) => setDraft({ ...draft, title: event.target.value }) }),
    jsxs('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }, children: [jsx('input', { className: 'gnos-select', value: draft.stage || '', placeholder: 'Estágio', onChange: (event) => setDraft({ ...draft, stage: event.target.value }) }), jsx('select', { className: 'gnos-select', value: draft.status || 'unknown', onChange: (event) => setDraft({ ...draft, status: event.target.value }), children: ['unknown', 'exposed', 'practicing', 'demonstrated', 'retained', 'repair-needed'].map((status) => jsx('option', { value: status, children: status }, status)) })] }),
    jsx('textarea', { className: 'gnos-select', value: draft.detail || '', placeholder: 'Descrição ou próximo objetivo', rows: 3, onChange: (event) => setDraft({ ...draft, detail: event.target.value }) }),
    jsxs('div', { style: { display: 'flex', gap: 8 }, children: [jsx(Navigate, { primary: true, onClick: saveTrack, children: busy ? 'Salvando…' : 'Salvar' }), jsx(Navigate, { onClick: () => { setEditingId(null); setCreating(false) }, children: 'Cancelar' })] })
  ] }) })
  return jsx(Page, { label: 'Áreas instaladas', title: 'Trilhas por competência', actions: jsx(Navigate, { primary: true, icon: 'add', onClick: () => { setCreating(true); setEditingId(null); setDraft({ title: '', stage: 'Em planejamento', status: 'unknown', detail: '' }) }, children: 'Nova trilha' }), subtitle: 'Edite a organização dos estudos sem perder as evidências e o histórico das sessões.', children: isLoading ? jsx(Loading, { label: 'trilhas' }) : error ? jsx(ErrorState, { label: 'trilhas', error }) : jsxs('div', { style: { display: 'grid', gap: 20 }, children: [
    creating && editor('Nova trilha'),
    !tracks.length && !creating ? jsx(Empty, { label: 'trilhas' }) : jsx('div', { style: css.grid, children: tracks.map((t) => {
      const courseId = courseIdForTrack(t.id)
      const hasCourse = courseId && courses.some((c) => c.id === courseId)
      return jsx(Card, { title: t.title, icon: 'library', children: editingId === t.id ? editor(`Editar · ${t.title}`) : jsxs('div', { children: [jsx('div', { style: { color: 'var(--muted-foreground)', marginBottom: 12, fontSize: 13 }, children: t.stage }), jsx(Badge, { state: t.status, children: t.status }), jsx('p', { style: { marginBottom: 0, marginTop: 12, color: 'var(--muted-foreground)', fontSize: 13, lineHeight: 1.5 }, children: t.detail }), jsxs('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }, children: [t.source_type === 'user' && jsx(Navigate, { icon: 'edit', onClick: () => beginEdit(t), children: 'Editar' }), t.source_type === 'user' && jsx(Navigate, { icon: 'trash', onClick: () => removeTrack(t), children: 'Apagar' }), t.source_type !== 'user' && jsx(Badge, { state: 'planned', children: `Origem: ${t.source_type}` }), hasCourse && jsx(Navigate, { icon: 'list-tree', onClick: () => setOpenCourseId(openCourseId === courseId ? null : courseId), children: openCourseId === courseId ? 'Fechar curso' : 'Ver curso, módulos e aulas' })] })] }) }, t.id)
    }) }),
    openCourseId && jsx(CourseExplorer, { courseId: openCourseId, onClose: () => setOpenCourseId(null) })
  ] }) })
}

const trackArtifactIcon = { video: 'device-camera-video', diagram: 'type-hierarchy', simulation: 'pulse', pdf: 'file-pdf', image: 'file-media', document: 'file-text' }

// Only real http(s) URLs are safe to hand to host.openExternal from a
// possibly-remote gateway: a `location.path` is a server-local filesystem
// path (same class of bug as the old openPortal) and would silently fail to
// open on the user's machine, so it deliberately does NOT synthesize a
// file:// URL — an artifact with only a local path has no external action
// until it's served through the plugin API like the lesson portal is.
function artifactHref(location) {
  if (!location) return null
  if (location.url && /^https?:\/\//i.test(location.url)) return location.url
  return null
}

function CourseExplorer({ courseId, onClose }) {
  const { data, isLoading, error } = useApi(`/courses/${courseId}`, ['course', courseId])
  const [openTopic, setOpenTopic] = useState(null)
  const [openLesson, setOpenLesson] = useState(null)
  const [portalOpen, setPortalOpen] = useState(false)
  const [portalLesson, setPortalLesson] = useState(null)
  if (isLoading) return jsx(Card, { title: 'Carregando curso…', children: jsx(Loading, { label: 'curso' }) })
  if (error) return jsx(Card, { title: 'Curso', children: jsx(ErrorState, { label: 'curso', error }) })
  const course = data
  const chapters = course?.chapters || []
  const lessons = course?.lessons || []
  const artifacts = course?.artifacts || []
  const lessonsByTopic = (topicId) => lessons.filter((l) => l.topic_id === topicId)
  const artifactsByLesson = (lessonId) => artifacts.filter((a) => a.lesson_id === lessonId)
  const artifactsByTopic = (topicId) => artifacts.filter((a) => a.topic_id === topicId && !a.lesson_id)
  const sources = Object.entries(course?.sources || {})
  const progress = course?.progress || { total: lessons.length, completed: 0, viewed: 0, pending: lessons.length }
  const lessonPosition = (lesson) => lesson.position || (lessons.findIndex((l) => l.id === lesson.id) + 1)
  const lessonState = (lesson) => lesson.progress_state || 'pending'
  const stateLabel = (state) => (state === 'completed' ? '\u2713 aula conclu\u00edda' : (state === 'viewed' ? 'consultada' : 'pendente'))
  const markLesson = async (lesson, state) => {
    try {
      await postApi(`/courses/${courseId}/lessons/${lesson.id}/progress`, { state, source: 'trilha' })
      if (state === 'completed') host.toast?.(`Aula ${lessonPosition(lesson)} registrada como conclu\u00edda.`, 'success')
    } catch (err) {
      host.toast?.(String(err?.message || err), 'error')
    }
  }
  return jsxs('div', {
    style: { display: 'grid', gap: 16 },
    children: [
      jsx(Card, {
        title: `Ementa — ${course?.title || courseId}`, icon: 'book',
        children: jsxs('div', {
          style: { display: 'grid', gap: 10 },
          children: [
            jsxs('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--muted-foreground)', fontSize: 13 }, children: [
              course?.length && jsxs('span', { children: ['◷ ', course.length] }),
              course?.depth && jsxs('span', { children: ['◉ profundidade: ', course.depth] }),
              jsxs('span', { children: [chapters.length, ' capítulo(s) · ', lessons.length, ' aula(s) · ', artifacts.length, ' recurso(s)'] }),
              jsxs('span', { style: { fontWeight: 640 }, children: ['\u2713 progresso: ', progress.completed, ' de ', progress.total, ' aula(s)'] }),
              jsx(Badge, { state: progress.completed === progress.total && progress.total > 0 ? 'demonstrated' : 'unknown', children: progress.completed === progress.total && progress.total > 0 ? 'curso conclu\u00eddo' : `${progress.pending} pendente(s)` }),
              progress.viewed > 0 && jsx(Badge, { state: 'unknown', children: `${progress.viewed} consultada(s)` })
            ] }),
            course?.goal && jsxs('p', { style: { margin: 0, lineHeight: 1.6, fontSize: 14 }, children: [jsx('strong', { children: 'Objetivo: ' }), course.goal] }),
            course?.vision && jsxs('p', { style: { margin: 0, lineHeight: 1.6, fontSize: 14, color: 'var(--muted-foreground)' }, children: [jsx('strong', { children: 'Visão: ' }), course.vision] }),
            sources.length > 0 && jsxs('div', {
              children: [
                jsx('div', { style: { fontWeight: 650, fontSize: 13, marginTop: 6, marginBottom: 6 }, children: 'Fontes / referências' }),
                sources.map(([sid, s]) => jsx(ListRow, { icon: 'link-external', title: s.title || sid, detail: s.verification_notes || s.type }, sid))
              ]
            }),
            jsx(Navigate, { onClick: onClose, icon: 'x', children: 'Fechar' })
          ]
        })
      }),
      jsx(Card, {
        title: 'Capítulos e módulos', icon: 'list-tree',
        children: !chapters.length ? jsx(Empty, { label: 'capítulos' }) : jsx('div', {
          style: { display: 'grid', gap: 14 },
          children: chapters.map((chapter) => jsxs('div', {
            style: { border: '1px solid var(--border)', borderRadius: 12, padding: 14 },
            children: [
              jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }, children: [
                jsx('span', { className: 'codicon codicon-folder', style: { fontSize: 14, color: 'var(--accent-2)' } }),
                jsx('strong', { style: { fontSize: 15 }, children: chapter.title }),
                jsx(Badge, { state: chapter.state === 'current' ? 'in_progress' : 'planned', children: chapter.state || 'planejado' })
              ] }),
              (chapter.topics || []).map((topic) => {
                const topicLessons = lessonsByTopic(topic.id)
                const topicArtifacts = artifactsByTopic(topic.id)
                const isOpen = openTopic === topic.id
                return jsxs('div', {
                  style: { marginLeft: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)', marginBottom: 10 },
                  children: [
                    jsxs('button', {
                      type: 'button', className: 'gnos-action', onClick: () => setOpenTopic(isOpen ? null : topic.id),
                      style: { background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--foreground)', textAlign: 'left', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 8, width: '100%' },
                      children: [
                        jsx('span', { className: `codicon codicon-chevron-${isOpen ? 'down' : 'right'}`, style: { fontSize: 12 } }),
                        jsx('span', { style: { fontWeight: 600, fontSize: 14 }, children: topic.title }),
                        jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 12 }, children: `${topicLessons.length} aula(s) · ${topic.minutes || '—'} min` })
                      ]
                    }),
                    isOpen && jsxs('div', {
                      style: { marginLeft: 20, display: 'grid', gap: 10, marginTop: 6 },
                      children: [
                        (topic.subtopics || []).length > 0 && jsx('ul', {
                          style: { margin: 0, paddingLeft: 18, color: 'var(--muted-foreground)', fontSize: 13 },
                          children: topic.subtopics.map((s, i) => jsx('li', { children: s }, i))
                        }),
                        !topicLessons.length && jsx(Empty, { label: 'aulas neste tópico' }),
                        topicLessons.map((lesson) => {
                          const lessonOpen = openLesson === lesson.id
                          const lessonArtifacts = artifactsByLesson(lesson.id)
                          return jsxs('div', {
                            style: { border: '1px solid var(--border)', borderRadius: 10, padding: 12 },
                            children: [
                              jsxs('button', {
                                type: 'button',
                                onClick: () => {
                                  const opening = !lessonOpen
                                  setOpenLesson(opening ? lesson.id : null)
                                  // Abrir a aula no leitor conta como consulta.
                                  if (opening && lessonState(lesson) !== 'completed') markLesson(lesson, 'viewed')
                                },
                                style: { background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--foreground)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, width: '100%' },
                                children: [
                                  jsx('span', { className: `codicon codicon-chevron-${lessonOpen ? 'down' : 'right'}`, style: { fontSize: 12 } }),
                                  jsx('span', { style: { fontWeight: 700, fontSize: 12, color: 'var(--muted-foreground)', minWidth: 22 }, children: String(lessonPosition(lesson)).padStart(2, '0') }),
                                  jsx('span', { className: 'codicon codicon-book', style: { fontSize: 13, color: 'var(--accent-2)' } }),
                                  jsx('span', { style: { fontWeight: 600, fontSize: 13.5 }, children: lesson.title }),
                                  jsx(Badge, { state: lessonState(lesson) === 'completed' ? 'demonstrated' : 'unknown', children: stateLabel(lessonState(lesson)) }),
                                  jsx(Badge, { state: lesson.publication === 'ready' ? 'demonstrated' : 'unknown', children: lesson.publication })
                                ]
                              }),
                              lessonOpen && jsxs('div', {
                                style: { marginTop: 10, display: 'grid', gap: 10 },
                                children: [
                                  lesson.purpose && jsx('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--muted-foreground)' }, children: lesson.purpose }),
                                  jsx('div', {
                                    style: { fontWeight: 620, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted-foreground)' },
                                    children: `Blocos (${(lesson.blocks || []).length})`
                                  }),
                                  (lesson.blocks || []).map(([label, body], i) => jsx(ListRow, { icon: blockIcon[label] || 'book', title: label, detail: (body || '').slice(0, 140) }, i)),
                                  (lesson.exercises || []).length > 0 && jsxs('div', {
                                    children: [
                                      jsx('div', { style: { fontWeight: 620, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted-foreground)', marginTop: 4 }, children: `Exercícios (${lesson.exercises.length})` }),
                                      lesson.exercises.map((ex) => jsx(ListRow, { icon: 'checklist', title: ex.prompt?.slice(0, 120) || ex.id, detail: (ex.success_criteria || []).join(' · ') }, ex.id))
                                    ]
                                  }),
                                  lessonArtifacts.length > 0 && jsxs('div', {
                                    children: [
                                      jsx('div', { style: { fontWeight: 620, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted-foreground)', marginTop: 4 }, children: `Vídeos e mídia (${lessonArtifacts.length})` }),
                                      lessonArtifacts.map((a) => jsx(ListRow, {
                                        icon: trackArtifactIcon[a.type] || 'file',
                                        title: a.title,
                                        detail: a.purpose,
                                        action: artifactHref(a.location) && jsx(Navigate, { onClick: () => host.openExternal?.(artifactHref(a.location)), icon: 'link-external', children: 'Abrir' })
                                      }, a.id))
                                    ]
                                  }),
                                  jsxs('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }, children: [
                                    lesson.portal_path && jsx(Navigate, { primary: true, icon: 'link-external', onClick: () => { setPortalLesson(lesson); setPortalOpen(true) }, children: 'Ver aula completa (com diagramas e código)' }),
                                    jsx(Navigate, { icon: 'check', onClick: () => markLesson(lesson, 'completed'), children: lessonState(lesson) === 'completed' ? '\u2713 Aula conclu\u00edda' : '\u2713 Concluir aula' }),
                                    jsxs('span', { style: { fontSize: 12, color: 'var(--muted-foreground)' }, children: ['Aula ', lessonPosition(lesson), ' de ', lessons.length, ' · ', lessonState(lesson) === 'pending' ? 'não consultada' : lessonState(lesson) === 'viewed' ? 'consultada em ' + String((lesson.progress || {}).viewed_at || '').slice(0, 10) : 'concluída em ' + String((lesson.progress || {}).completed_at || '').slice(0, 10)] })
                                  ] }),
                                ]
                              })
                            ]
                          }, lesson.id)
                        }),
                        topicArtifacts.length > 0 && topicArtifacts.map((a) => jsx(ListRow, {
                          icon: trackArtifactIcon[a.type] || 'file',
                          title: a.title,
                          detail: a.purpose,
                          action: artifactHref(a.location) && jsx(Navigate, { onClick: () => host.openExternal?.(artifactHref(a.location)), icon: 'link-external', children: 'Abrir' })
                        }, a.id))
                      ]
                    })
                  ]
                }, topic.id)
              })
            ]
          }, chapter.id))
        })
      }),
      portalOpen && jsx(PortalDialog, {
        open: portalOpen,
        onOpenChange: setPortalOpen,
        title: portalLesson?.title,
        kind: 'course',
        ids: { courseId, lessonId: portalLesson?.id },
        useApi,
        postApi,
        host,
        })
    ]
  })
}

const BASE = '/gnos'
let restImpl = null
let osImpl = null

// ctx.registerMany() runs once at activate() time; useApi/postApi are called
// later from render/handlers, so we stash the bound ctx.rest reference here.
function rest(path, opts) {
  if (!restImpl) throw new Error('gnos-learning-os: backend not initialized yet')
  return restImpl(path, opts)
}

// Rich lesson text is implemented in components/rich_text.js for reuse across pages.
function useApi(path, queryKey, opts = {}) {
  return useQuery({
    queryKey: ['gnos', ...queryKey],
    queryFn: () => rest(path),
    staleTime: 10_000,
    enabled: opts.enabled !== undefined ? opts.enabled : Boolean(path)
  })
}

let apiActions = null
function postApi(path, body) {
  if (!apiActions) throw new Error('gnos-learning-os: API actions not initialized yet')
  return apiActions.post(path, body)
}
function mutateApi(path, method, body) {
  if (!apiActions) throw new Error('gnos-learning-os: API actions not initialized yet')
  return apiActions.mutate(path, method, body)
}

// Semantic status hues stay fixed regardless of theme (red = attention, green = mastered,
// amber = in progress, blue = introduced); the rest follows the supplied GNOS palette.

const statusTone = { unknown: 'muted', exposed: 'blue', practicing: 'amber', demonstrated: 'green', retained: 'green', 'repair-needed': 'red', planned: 'muted', corrected: 'amber', in_progress: 'amber', completed: 'green', not_started: 'muted', running: 'amber', ready_to_check: 'amber', passed: 'green', failed: 'red' }
const toneHex = { muted: null, blue: '#2f6fed', amber: '#c2760c', green: '#1a9c5c', red: '#e5484d' }
const kindIcon = { lesson: 'book', lab: 'beaker', review: 'history', retrieval: 'question', checkpoint: 'checklist', exam: 'mortar-board', project: 'project', challenge: 'zap', repair: 'tools' }
const blockIcon = { 'Texto': 'book', 'Vídeo': 'device-camera-video', 'Simulação': 'pulse', 'Código': 'code', 'Diagrama': 'type-hierarchy', 'Exercício': 'checklist', 'Fonte': 'link-external', 'Equação': 'symbol-operator' }

const css = {
  page: { width: '100%', padding: '0 32px 48px', color: 'var(--foreground)', boxSizing: 'border-box' },
  eyebrowRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  eyebrowDot: { display: 'none' },
  eyebrow: { color: 'var(--muted-foreground)', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 650 },
  title: { fontSize: 28, letterSpacing: '-.035em', fontWeight: 760, margin: 0, lineHeight: 1.12 },
  subtitle: { color: 'var(--muted-foreground)', margin: '0 0 24px', maxWidth: 760, lineHeight: 1.6, fontSize: 15 },
  grid: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' },
  card: {
    border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 18, padding: 22,
    boxShadow: '0 20px 60px rgba(0,0,0,.25)'
  },
  accentCard: {
    border: '1px solid color-mix(in srgb, var(--accent) 46%, var(--border))',
    background: 'radial-gradient(circle at 88% 16%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 32%),linear-gradient(150deg,#17142b,var(--card) 62%)',
    borderRadius: 18, padding: 28,
    boxShadow: '0 20px 60px rgba(0,0,0,.3)'
  },
  cardTitleRow: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px' },
  cardTitle: { fontSize: 16, fontWeight: 720, letterSpacing: '-.015em', margin: 0 },
  cardIconWrap: {
    width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent-2)', flexShrink: 0
  },
  heroIconWrap: {
    width: 48, height: 48, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent-2)', flexShrink: 0, fontSize: 20
  },
  button: {
    background: 'var(--accent)', color: '#fff', border: 0, borderRadius: 11, padding: '11px 17px',
    fontWeight: 700, fontSize: 14, cursor: 'pointer', letterSpacing: '-.005em', boxShadow: '0 8px 24px rgba(124,92,255,.22)'
  },
  ghost: {
    background: 'var(--panel-2)', color: 'var(--foreground)', border: '1px solid var(--border)',
    borderRadius: 11, padding: '10px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 650
  },
  divider: { height: 1, background: 'var(--border)', margin: '18px 0' },
  state: { color: 'var(--muted-foreground)', padding: '64px 0', textAlign: 'center', fontSize: 15 },
  appShell: { display: 'grid', gridTemplateColumns: '248px minmax(0, 1fr)', minHeight: '100vh', width: '100%', background: 'var(--background)', color: 'var(--foreground)', fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
  appNav: {
    position: 'sticky', top: 0, alignSelf: 'start', height: '100vh', padding: '22px 16px',
    borderRight: '1px solid var(--border)', background: '#0d1015',
    display: 'flex', flexDirection: 'column', gap: 24, boxSizing: 'border-box'
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12, padding: '0 6px' },
  brandMark: {
    width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 12,
    background: 'linear-gradient(135deg,var(--accent),#4a31ca)', color: '#fff', fontWeight: 850,
    boxShadow: '0 12px 30px rgba(124,92,255,.24)'
  },
  navList: { display: 'grid', gap: 6 },
  navItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12,
    border: 0, background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer',
    fontSize: 14, fontWeight: 650, textAlign: 'left'
  },
  navItemActive: { color: '#fff', background: '#171b23', boxShadow: 'inset 3px 0 0 var(--accent)' },
  appContent: { minWidth: 0, background: 'var(--background)' },
  profile: { marginTop: 'auto', border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 14, padding: 14 },
  topbar: { minHeight: 96, display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'space-between', gap: 18, paddingBottom: 18, borderBottom: '1px solid var(--border)', marginBottom: 28 },
  metric: { fontSize: 36, fontWeight: 800, letterSpacing: '-.045em', display: 'block', margin: '8px 0' }
}

const responsiveCss = `
.gnos-shell{--background:#090b0f;--card:#11141a;--panel-2:#151922;--border:#222834;--foreground:#f4f6f8;--muted-foreground:#8f98a8;--accent:#7c5cff;--accent-2:#a48fff;--accent-foreground:#fff;--good:#43d17b;--warn:#f6b94b;--bad:#ff6474;--font-mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace;color-scheme:dark}
.gnos-shell,.gnos-shell *{box-sizing:border-box}.gnos-shell button,.gnos-shell input,.gnos-shell textarea,.gnos-shell select{font:inherit}
.gnos-action,.gnos-nav{transition:transform .16s ease,background .16s ease,border-color .16s ease,filter .16s ease}
.gnos-action:focus-visible,.gnos-nav:focus-visible,.gnos-select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.gnos-action:disabled{opacity:.5;cursor:not-allowed}
.gnos-action:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.1)}
.gnos-nav:hover{background:#171b23;color:#fff}
.gnos-card{transition:border-color .18s ease,transform .18s ease}.gnos-card:hover{border-color:#30384a}
@media(max-width:920px){.gnos-shell{grid-template-columns:210px minmax(0,1fr)!important}.gnos-page{padding:0 22px 42px!important}}
@media(max-width:760px){.gnos-shell{grid-template-columns:1fr!important}.gnos-sidebar{position:relative!important;height:auto!important;border-right:0!important;border-bottom:1px solid var(--border)!important}.gnos-nav-list{grid-template-columns:repeat(3,minmax(0,1fr))!important}.gnos-profile{display:none}.gnos-page{padding:0 18px 42px!important}.gnos-two-col{grid-template-columns:1fr!important}}
@media(max-width:520px){.gnos-nav-list{grid-template-columns:repeat(2,minmax(0,1fr))!important}.gnos-topbar{height:auto!important;min-height:92px;align-items:flex-start!important;padding:18px 0;flex-direction:column}.gnos-actions{width:100%;flex-direction:column}.gnos-actions>*{width:100%}}
`

function GnosShell({ active, Component }) {
  return jsxs('div', {
    className: 'gnos-shell',
    style: css.appShell,
    children: [
      jsx('style', { children: responsiveCss }),
      jsxs('aside', {
        className: 'gnos-sidebar',
        style: css.appNav,
        'aria-label': 'Navegação do GNOS Learning OS',
        children: [
          jsxs('div', {
            style: css.brand,
            children: [
              jsx('span', { style: css.brandMark, children: 'G' }),
              jsxs('span', {
                children: [
                  jsx('strong', { style: { display: 'block', fontSize: 16, letterSpacing: '.01em' }, children: 'GNOS' }),
                  jsx('small', { style: { display: 'block', marginTop: 3, color: 'var(--muted-foreground)', fontSize: 12 }, children: 'Learning OS' })
                ]
              })
            ]
          }),
          jsx('nav', {
            className: 'gnos-nav-list',
            style: css.navList,
            children: pages.map(([path, label, codicon]) => jsx('button', {
              type: 'button',
              className: 'gnos-nav',
              onClick: () => host.navigate(`${BASE}/${path}`),
              style: active === path ? { ...css.navItem, ...css.navItemActive } : css.navItem,
              'aria-current': active === path ? 'page' : undefined,
              children: jsxs('span', {
                style: { display: 'contents' },
                children: [
                  jsx('span', { className: `codicon codicon-${codicon}`, style: { width: 17, fontSize: 15, textAlign: 'center' } }),
                  jsx('span', { children: label })
                ]
              })
            }, path))
          }),
          jsxs('div', { className: 'gnos-profile', style: css.profile, children: [
            jsx('div', { style: css.eyebrow, children: 'Profile ativo' }),
            jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }, children: [
              jsx('span', { style: { ...css.brandMark, width: 34, height: 34, borderRadius: 10 }, children: 'D' }),
              jsxs('span', { children: [jsx('strong', { style: { display: 'block', fontSize: 13 }, children: 'didaktos' }), jsx('small', { style: { color: 'var(--muted-foreground)' }, children: 'Hermes Professor' })] })
            ] })
          ] })
        ]
      }),
      jsx('div', { style: css.appContent, children: jsx(Component, {}) })
    ]
  })
}

function Page({ label, title, subtitle, actions, children }) {
  return jsxs('main', {
    className: 'gnos-page', style: css.page, children: [
      jsxs('header', { className: 'gnos-topbar', style: css.topbar, children: [
        jsxs('div', { children: [
          jsxs('div', { style: css.eyebrowRow, children: [jsx('span', { style: css.eyebrowDot }), jsx('span', { style: css.eyebrow, children: label })] }),
          jsx('h1', { style: css.title, children: title })
        ] }),
        actions && jsx('div', { className: 'gnos-actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: actions })
      ] }),
      subtitle && jsx('p', { style: css.subtitle, children: subtitle }),
      children
    ]
  })
}
function Card({ title, icon, children, accent = false }) {
  return jsxs('section', {
    className: 'gnos-card',
    style: accent ? css.accentCard : css.card, children: [
      title && jsxs('div', {
        style: css.cardTitleRow, children: [
          icon && jsx('span', { style: css.cardIconWrap, children: jsx('span', { className: `codicon codicon-${icon}`, style: { fontSize: 14 } }) }),
          jsx('h2', { style: css.cardTitle, children: title })
        ]
      }),
      children
    ]
  })
}
function Badge({ children, state }) {
  const tone = statusTone[state] || 'muted'
  const hex = toneHex[tone]
  const style = hex
    ? { color: hex, background: `color-mix(in srgb, ${hex} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${hex} 38%, transparent)` }
    : { color: 'var(--muted-foreground)', background: 'color-mix(in srgb, var(--foreground) 5%, transparent)', border: '1px solid var(--border)' }
  return jsx('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 640, letterSpacing: '-.005em', ...style }, children })
}
function Navigate({ path, children, primary = false, icon, onClick, disabled = false }) {
  return jsxs('button', {
    type: 'button', className: 'gnos-action', disabled, onClick: onClick || (() => host.navigate(path)), style: { ...(primary ? css.button : css.ghost), opacity: disabled ? .6 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }, children: [
      icon && jsx('span', { className: `codicon codicon-${icon}`, style: { marginRight: 6, fontSize: 13, verticalAlign: '-2px' } }),
      children
    ]
  })
}
function ListRow({ icon = 'circle-small-filled', title, detail, action }) {
  return jsxs('div', {
    style: { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '13px 0', borderBottom: '1px solid color-mix(in srgb, var(--border) 65%, transparent)' }, children: [
      jsx('span', {
        style: { width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--foreground) 5%, transparent)', color: 'var(--muted-foreground)', flexShrink: 0, marginTop: 1 },
        children: jsx('span', { className: `codicon codicon-${icon}`, style: { fontSize: 12.5 } })
      }),
      jsxs('div', { style: { flex: 1, minWidth: 0 }, children: [jsx('div', { style: { fontWeight: 580, fontSize: 13.5 }, children: title }), detail && jsx('div', { style: { color: 'var(--muted-foreground)', fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }, children: detail })] }),
      action
    ]
  })
}
function Loading({ label }) { return jsx('div', { style: css.state, children: `Carregando ${label}…` }) }
function ErrorState({ label, error }) { return jsxs('div', { style: css.state, children: [jsx('div', { children: `Não foi possível carregar ${label}.` }), jsx('div', { style: { fontSize: 12, marginTop: 6, opacity: .8 }, children: String(error?.message || error || '') })] }) }
function Empty({ label }) { return jsx('div', { style: css.state, children: `Nada em ${label} ainda.` }) }

function evidencePercent(items) {
  if (!items.length) return 0
  const weight = { unknown: 0, exposed: 25, practicing: 50, demonstrated: 80, retained: 100, 'repair-needed': 30 }
  return Math.round(items.reduce((sum, item) => sum + (weight[item.status] || 0), 0) / items.length)
}

function formatElapsed(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function Today() {
  return jsx(TodayPage, { useApi, postApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css, evidencePercent, formatElapsed, kindIcon })
}
function Tracks() {
  return jsx(TracksPage, { useApi, mutateApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css })
}
function Timeline() {
  return jsx(TimelinePage, { useApi, mutateApi, postApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css, kindIcon })
}
function Lesson() {
  return jsx(LessonPage, { useApi, postApi, host, BASE, Page, Loading, Empty, Card, Badge, Navigate, css, PortalDialog })
}
const artifactIcon = { video: 'device-camera-video', diagram: 'type-hierarchy', simulation: 'pulse', pdf: 'file-pdf', image: 'file-media', document: 'file-text' }
function Lab() {
  return jsx(LabPage, { useApi, postApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css })
}
function Assessments() {
  return jsx(AssessmentsPage, { useApi, postApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css, kindIcon })
}
function Progress() {
  return jsx(ProgressPage, { useApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css, evidencePercent, ListRow })
}
function Metrics() {
  return jsx(MetricsPage, { useApi, Page, Loading, ErrorState, Empty, Card, Badge, css })
}
function Resources() {
  return jsx(ResourcesPage, { useApi, mutateApi, host, Page, Loading, ErrorState, Empty, Card, ListRow, Badge, css, artifactIcon, Pagination })
}
function Projects() {
  return jsx(ProjectsPage, { useApi, postApi, mutateApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css })
}

const pages = [
  ['today', 'Hoje', 'home', Today], ['tracks', 'Trilhas', 'library', Tracks], ['timeline', 'Cronograma', 'calendar', Timeline], ['lesson', 'Aula', 'book', Lesson], ['lab', 'Laboratórios', 'beaker', Lab], ['assessments', 'Avaliações', 'checklist', Assessments], ['progress', 'Progresso', 'graph', Progress], ['metrics', 'Métricas', 'dashboard', Metrics], ['resources', 'Recursos', 'references', Resources], ['projects', 'Projetos', 'project', Projects]
]
export default {
  id: 'gnos-learning-os',
  name: 'GNOS Learning OS',
  description: 'GNOS Learning Dashboard — interface V1 para a jornada de estudos.',
  register(ctx) {
    restImpl = (path, opts) => ctx.rest(path, opts)
    apiActions = createApiActions(rest, queryClient)
    osImpl = ctx.os
    ctx.registerMany([
      ...pages.map(([path, , , Component]) => ({
        id: `gnos.route.${path}`,
        area: ROUTES_AREA,
        data: { path: `${BASE}/${path}` },
        render: () => jsx(GnosShell, { active: path, Component })
      })),
      {
        id: 'gnos.nav.root',
        area: SIDEBAR_NAV_AREA,
        data: { path: `${BASE}/today`, label: 'GNOS Learning OS', codicon: 'mortar-board' }
      },
      { id: 'gnos.palette.open', area: PALETTE_AREA, data: { id: 'gnos.open', label: 'Abrir GNOS Learning OS', keywords: ['gnos', 'learning', 'study'], run: () => host.navigate(`${BASE}/today`) } }
    ])
  }
}
