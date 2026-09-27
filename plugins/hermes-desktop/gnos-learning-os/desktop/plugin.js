// SINGLE SOURCE FILE: this is the canonical copy. Electron's
// reconcileUnifiedDesktopHalves materializes it into desktop-plugins/gnos-learning-os/
// automatically — never hand-edit that copy.
//
// UI data boundary: every page reads through `useApi`/`postApi`, which call the
// plugin's own backend at /api/plugins/gnos-learning-os/* (see ../dashboard/plugin_api.py)
// via ctx.rest. No page reads GNOS course files, learner state, or executes shell —
// see ../contracts.md for the full contract.
import { PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host, useQuery, queryClient } from '@hermes/plugin-sdk'
import { useState, useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { createApiActions } from './api_client.js'
import { RichText as SharedRichText } from './components/rich_text.js'
import { PortalDialog } from './components/portal_dialog.js'
import { Pagination } from './components/pagination.js'
import { ResourcesPage } from './pages/resources.js'

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
function Navigate({ path, children, primary = false, icon, onClick }) {
  return jsxs('button', {
    type: 'button', className: 'gnos-action', onClick: onClick || (() => host.navigate(path)), style: primary ? css.button : css.ghost, children: [
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
            jsxs('div', { children: [jsx(Badge, { state: data.status, children: data.track || data.status }), jsx('h2', { style: { margin: '18px 0 10px', fontSize: 34, fontWeight: 780, letterSpacing: '-.045em' }, children: data.session }), jsx('p', { style: { ...css.subtitle, marginBottom: 0, color: 'var(--foreground)', opacity: .82 }, children: data.objective }), jsxs('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap', color: 'var(--muted-foreground)', fontSize: 14, marginTop: 18 }, children: [jsxs('span', { children: ['◷ ', data.status === 'in_progress' ? `${formatElapsed(elapsedSeconds)} em foco` : `${data.duration || '—'} min`] }), jsxs('span', { children: ['◉ ', data.track || 'Trilha atual'] }), jsxs('span', { children: ['⚙ ', `${labsData?.labs?.length || 0} laboratório(s)`] })] }), jsxs('div', { className: 'gnos-actions', style: { display: 'flex', gap: 10, marginTop: 22 }, children: [jsx(Navigate, { path: `${BASE}/lesson`, primary: true, icon: 'arrow-right', children: 'Continuar aula' }), jsx(Navigate, { path: `${BASE}/timeline`, icon: 'calendar', children: 'Ver cronograma' })] })] }),
            jsx('div', { style: { width: 112, height: 112, borderRadius: '50%', padding: 8, display: 'grid', placeItems: 'center', background: `conic-gradient(var(--accent) ${percent}%, #282d38 0)`, boxShadow: '0 0 34px rgba(124,92,255,.16)' }, children: jsxs('div', { style: { width: '100%', height: '100%', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--card)' }, children: [jsx('strong', { style: { fontSize: 25, alignSelf: 'end', marginBottom: 2 }, children: `${percent}%` }), jsx('small', { style: { color: 'var(--muted-foreground)', alignSelf: 'start', marginTop: 2 }, children: 'trilha' })] }) })
          ] }) }),
          jsx(Card, { title: 'Foco de hoje', icon: 'target', children: jsxs('div', { children: [
            ...(timeline.slice(0, 4).map((row, index) => jsxs('div', { style: { display: 'grid', gridTemplateColumns: '34px minmax(0,1fr)', gap: 12, padding: '12px 0', borderBottom: index < Math.min(timeline.length, 4) - 1 ? '1px solid var(--border)' : 0 }, children: [jsx('span', { style: { color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', fontWeight: 760, fontSize: 13 }, children: String(index + 1).padStart(2, '0') }), jsxs('div', { children: [jsx('b', { style: { display: 'block', fontSize: 14 }, children: row.text }), jsx('small', { style: { display: 'block', color: 'var(--muted-foreground)', marginTop: 4 }, children: row.adaptive_reason || row.kind })] })] }, row.id))),
            !timeline.length && jsxs('div', { children: [jsx('p', { style: { margin: '0 0 16px', lineHeight: 1.6, color: 'var(--muted-foreground)' }, children: data.next || 'Aguardando próxima intervenção' }), jsx(Navigate, { path: `${BASE}/progress`, icon: 'graph', children: 'Mapa de competências' })] })
          ] }) })
        ] }),
        jsx(Card, { title: 'Próxima ação recomendada', icon: 'target', children: jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }, children: [
          jsxs('div', { children: [jsx('strong', { style: { display: 'block', fontSize: 18 }, children: nextStudyData?.session?.planned_topic || nextStudyData?.competency?.label || 'Nenhuma ação pendente' }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: nextStudyData?.reason || 'Aguardando recomendação' })] }),
          nextStudyData?.session?.id && jsx(Navigate, { path: `${BASE}/lesson`, primary: true, icon: 'arrow-right', children: 'Abrir estudo' })
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
function Tracks() {
  return jsx(TracksPage, { useApi, mutateApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css })
}
function Timeline() {
  return jsx(TimelinePage, { useApi, mutateApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css, kindIcon })
}
function Lesson() {
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
function Lab() {
  const labs = useApi('/labs', ['labs'])
  const labId = labs.data?.labs?.[0]?.id
  const detail = useApi(labId ? `/labs/${labId}` : null, ['lab', labId])
  const [busy, setBusy] = useState(null)
  const act = async (kind) => {
    setBusy(kind)
    try { await postApi(`/labs/${labId}/${kind}`); host.toast?.(`Ação ${kind} concluída.`, 'success') } catch (e) { host.toast?.(String(e?.message || e), 'error') } finally { setBusy(null) }
  }
  if (labs.isLoading || detail.isLoading) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: jsx(Loading, { label: 'laboratório' }) })
  if (labs.error || detail.error) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: jsx(ErrorState, { label: 'laboratório', error: labs.error || detail.error }) })
  const lab = detail.data
  if (!lab) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: jsx(Empty, { label: 'laboratório' }) })
  const actions = jsxs('div', { style: { display: 'flex', gap: 8 }, children: [
    jsx(Navigate, { icon: 'refresh', onClick: () => act('reset'), children: busy === 'reset' ? 'Resetando…' : 'Resetar' }),
    lab.status === 'not_started' ? jsx(Navigate, { primary: true, icon: 'play', onClick: () => act('start'), children: busy === 'start' ? 'Iniciando…' : 'Iniciar ambiente' }) : jsx(Navigate, { primary: true, icon: 'run-all', onClick: () => act('check'), children: busy === 'check' ? 'Executando…' : 'Executar checks' })
  ] })
  return jsx(Page, {
    label: 'Sandbox restrito · histórico preservado', title: lab.title, subtitle: lab.objective, actions,
    children: jsxs('div', {
      style: { display: 'grid', gap: 16 }, children: [
        jsxs('section', { className: 'gnos-two-col', style: { display: 'grid', gridTemplateColumns: 'minmax(280px,.8fr) minmax(0,1.3fr)', gap: 16 }, children: [
          jsx(Card, { title: 'Desafio', icon: 'target', children: jsxs('div', { children: [jsx('p', { style: { lineHeight: 1.6, marginTop: 0 }, children: lab.task }), jsx('p', { style: css.eyebrow, children: 'Estado inicial' }), jsx('p', { style: { ...css.subtitle, marginBottom: 12 }, children: lab.initial_state }), jsx('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: (lab.allowed_tools || []).map((tool) => jsx(Badge, { state: 'exposed', children: tool }, tool)) })] }) }),
        jsx(Card, {
          title: 'Ambiente', icon: 'beaker', accent: true, children: jsxs('div', {
            children: [
              jsx(Badge, { state: lab.status, children: lab.status }),
              jsx(TerminalChrome, { children: lab.terminal_output || '$ (ambiente ainda não iniciado)' }),
              jsx('p', { style: { ...css.subtitle, marginBottom: 0 }, children: lab.expected_behavior })
            ]
          })
        })] }),
        jsx(Card, { title: 'Checks determinísticos', icon: 'verified', children: jsxs('div', { children: [jsx('p', { style: { margin: '0 0 8px', lineHeight: 1.55, color: 'var(--muted-foreground)' }, children: lab.evidence_note }), (lab.checks || []).length ? lab.checks.map((check) => jsx(ListRow, { icon: check.passed ? 'pass-filled' : 'error', title: check.check_name, detail: check.output, action: jsx(Badge, { state: check.passed ? 'passed' : 'failed', children: check.passed ? 'pass' : 'fail' }) }, check.id)) : (lab.deterministic_checks || []).map((check) => jsx(ListRow, { icon: 'circle-outline', title: check.name, detail: check.expect, action: jsx(Badge, { state: 'planned', children: 'pendente' }) }, check.name))] }) })
      ]
    })
  })
}
function Assessments() {
  const { data, isLoading, error } = useApi('/assessments', ['assessments'])
  const items = data?.assessments || []
  const [outcomes, setOutcomes] = useState({})
  const [historyId, setHistoryId] = useState(null)
  const { data: historyData } = useApi(historyId ? `/assessments/${historyId}/history` : null, ['assessment-history', historyId], { enabled: Boolean(historyId) })
  const [busy, setBusy] = useState(null)
  const submit = async (assessment) => {
    setBusy(assessment.id)
    const outcome = outcomes[assessment.id] || 'correct'
    try {
      await postApi(`/assessments/${assessment.id}/submit`, { attempt_id: `${assessment.id}-${Date.now()}`, outcome, help_used: outcome.includes('hint') ? 'pista' : null, notes: 'Registrado pelo GNOS Desktop' })
      host.toast?.('Tentativa registrada.', 'success')
    } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(null) }
  }
  return jsx(Page, { label: 'Evidência, não só nota', title: 'Avaliações', subtitle: 'Cada tentativa preserva resultado, ajuda utilizada e força da evidência.', children: isLoading ? jsx(Loading, { label: 'avaliações' }) : error ? jsx(ErrorState, { label: 'avaliações', error }) : !items.length ? jsx(Empty, { label: 'avaliações' }) : jsx('div', { style: css.grid, children: items.map((a) => jsx(Card, { title: a.title, icon: kindIcon[a.type] || 'checklist', children: jsxs('div', { children: [jsx(Badge, { state: a.status, children: `${a.type} · ${a.status}` }), jsx('p', { style: { fontSize: 13.5, lineHeight: 1.5 }, children: a.result || 'Aguardando tentativa' }), jsx('div', { style: { color: 'var(--muted-foreground)', fontSize: 12.5, marginBottom: 14 }, children: `Ajuda: ${a.help_used || '—'} · Evidências: ${a.evidence_count}` }), jsxs('label', { style: { display: 'grid', gap: 6, color: 'var(--muted-foreground)', fontSize: 12 }, children: ['Resultado da nova tentativa', jsx('select', { className: 'gnos-select', value: outcomes[a.id] || 'correct', onChange: (event) => setOutcomes({ ...outcomes, [a.id]: event.target.value }), style: { ...css.ghost, width: '100%' }, children: [jsx('option', { value: 'correct', children: 'Correto sem ajuda' }), jsx('option', { value: 'partial', children: 'Parcial' }), jsx('option', { value: 'incorrect', children: 'Incorreto' }), jsx('option', { value: 'correct_with_hint', children: 'Correto com pista' }), jsx('option', { value: 'misconception', children: 'Misconception detectada' }), jsx('option', { value: 'transfer_success', children: 'Transferência bem-sucedida' })] })] }), jsx('div', { style: { marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [jsx(Navigate, { primary: true, icon: 'save', onClick: () => submit(a), children: busy === a.id ? 'Registrando…' : 'Registrar tentativa' }), jsx(Navigate, { icon: 'history', onClick: () => setHistoryId(historyId === a.id ? null : a.id), children: historyId === a.id ? 'Fechar histórico' : 'Ver histórico' })] }), historyId === a.id && jsx('div', { style: { borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }, children: !historyData?.attempts?.length ? jsx('small', { style: { color: 'var(--muted-foreground)' }, children: 'Nenhuma tentativa registrada.' }) : historyData.attempts.map((attempt) => jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 12.5 }, children: [jsx(Badge, { state: attempt.outcome === 'correct' || attempt.outcome === 'transfer_success' ? 'demonstrated' : 'repair-needed', children: attempt.outcome }), jsx('span', { style: { color: 'var(--muted-foreground)' }, children: attempt.created_at?.slice(0, 10) })] }, attempt.id)) })] }) }, a.id)) }) })
}
function Progress() {
  return jsx(ProgressPage, { useApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css, evidencePercent, MonthCalendar })
}
function Metrics() {
  return jsx(MetricsPage, { useApi, Page, Loading, ErrorState, Empty, Card, css })
}
function Resources() {
  return jsx(ResourcesPage, { useApi, mutateApi, host, BASE, Page, Loading, ErrorState, Empty, Card, ListRow, Badge, css, artifactIcon })
}
function Projects() {
  const { data, isLoading, error } = useApi('/projects', ['projects'])
  const items = data?.projects || []
  return jsx(Page, { label: 'Integração de competências', title: 'Projetos', subtitle: 'Projetos conectam capacidades que a prática isolada não demonstra por si só.', children: isLoading ? jsx(Loading, { label: 'projetos' }) : error ? jsx(ErrorState, { label: 'projetos', error }) : !items.length ? jsx(Empty, { label: 'projetos' }) : jsx('div', { style: css.grid, children: items.map((p) => jsx(Card, { title: p.title, icon: 'project', accent: true, children: jsxs('div', { children: [jsx('p', { style: { fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted-foreground)' }, children: p.competencies }), jsx(Badge, { state: p.status, children: p.status }), jsxs('div', { className: 'gnos-actions', style: { display: 'flex', gap: 8, marginTop: 18 }, children: [jsx(Navigate, { path: `${BASE}/assessments`, primary: true, icon: 'checklist', children: 'Ver avaliações' }), jsx(Navigate, { path: `${BASE}/progress`, icon: 'graph', children: 'Ver competências' })] })] }) }, p.id)) }) })
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
