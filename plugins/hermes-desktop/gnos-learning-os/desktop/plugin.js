// SINGLE SOURCE FILE: this is the canonical copy. Electron's
// reconcileUnifiedDesktopHalves materializes it into desktop-plugins/gnos-learning-os/
// automatically — never hand-edit that copy.
//
// UI data boundary: every page reads through `useApi`/`postApi`, which call the
// plugin's own backend at /api/plugins/gnos-learning-os/* (see ../dashboard/plugin_api.py)
// via ctx.rest. No page reads GNOS course files, learner state, or executes shell —
// see ../contracts.md for the full contract.
import { PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host, useQuery, queryClient } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const BASE = '/gnos'
let restImpl = null

// ctx.registerMany() runs once at activate() time; useApi/postApi are called
// later from render/handlers, so we stash the bound ctx.rest reference here.
function rest(path, opts) {
  if (!restImpl) throw new Error('gnos-learning-os: backend not initialized yet')
  return restImpl(path, opts)
}

function useApi(path, queryKey, opts = {}) {
  return useQuery({
    queryKey: ['gnos', ...queryKey],
    queryFn: () => rest(path),
    staleTime: 10_000,
    enabled: opts.enabled !== undefined ? opts.enabled : Boolean(path)
  })
}

async function postApi(path, body) {
  const result = await rest(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, headers: body ? { 'Content-Type': 'application/json' } : undefined })
  await queryClient.invalidateQueries({ queryKey: ['gnos'] })
  return result
}

// Semantic status hues stay fixed regardless of theme (red = attention, green = mastered,
// amber = in progress, blue = introduced) — everything else routes through var(--ui-*).
const statusTone = { unknown: 'muted', exposed: 'blue', practicing: 'amber', demonstrated: 'green', retained: 'green', 'repair-needed': 'red', planned: 'muted', corrected: 'amber', in_progress: 'amber', completed: 'green', not_started: 'muted', running: 'amber', ready_to_check: 'amber', passed: 'green', failed: 'red' }
const toneHex = { muted: null, blue: '#2f6fed', amber: '#c2760c', green: '#1a9c5c', red: '#e5484d' }
const kindIcon = { lesson: 'book', lab: 'beaker', review: 'history', retrieval: 'question', checkpoint: 'checklist', exam: 'mortar-board', project: 'project', challenge: 'zap', repair: 'tools' }
const blockIcon = { 'Texto': 'book', 'Vídeo': 'device-camera-video', 'Simulação': 'pulse', 'Código': 'code', 'Diagrama': 'type-hierarchy', 'Exercício': 'checklist', 'Fonte': 'link-external', 'Equação': 'symbol-operator' }

const css = {
  page: { maxWidth: 1120, margin: '0 auto', padding: '30px 32px 56px', color: 'var(--foreground)' },
  eyebrowRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  eyebrowDot: { width: 6, height: 6, borderRadius: 999, background: 'var(--accent)' },
  eyebrow: { color: 'var(--muted-foreground)', fontSize: 12, letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 600 },
  title: { fontSize: 30, letterSpacing: '-.035em', fontWeight: 680, margin: '0 0 10px', lineHeight: 1.15 },
  subtitle: { color: 'var(--muted-foreground)', margin: '0 0 26px', maxWidth: 720, lineHeight: 1.55, fontSize: 14.5 },
  grid: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' },
  card: {
    border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 14, padding: 18,
    boxShadow: '0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent)'
  },
  accentCard: {
    border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--border))',
    background: 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 11%, var(--card)), var(--card) 65%)',
    borderRadius: 16, padding: 24,
    boxShadow: '0 6px 20px -8px color-mix(in srgb, var(--accent) 35%, transparent)'
  },
  cardTitleRow: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' },
  cardTitle: { fontSize: 14.5, fontWeight: 660, letterSpacing: '-.01em' },
  cardIconWrap: {
    width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', flexShrink: 0
  },
  heroIconWrap: {
    width: 46, height: 46, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', flexShrink: 0, fontSize: 20
  },
  button: {
    background: 'var(--accent)', color: 'var(--accent-foreground)', border: 0, borderRadius: 9, padding: '10px 16px',
    fontWeight: 640, fontSize: 13.5, cursor: 'pointer', letterSpacing: '-.005em'
  },
  ghost: {
    background: 'color-mix(in srgb, var(--foreground) 4%, transparent)', color: 'var(--foreground)',
    border: '1px solid var(--border)', borderRadius: 9, padding: '9px 15px', cursor: 'pointer', fontSize: 13.5, fontWeight: 540
  },
  divider: { height: 1, background: 'color-mix(in srgb, var(--border) 70%, transparent)', margin: '16px 0' },
  state: { color: 'var(--muted-foreground)', padding: '56px 0', textAlign: 'center', fontSize: 14 }
}

function Page({ label, title, subtitle, children }) {
  return jsxs('main', {
    style: css.page, children: [
      jsxs('div', { style: css.eyebrowRow, children: [jsx('span', { style: css.eyebrowDot }), jsx('span', { style: css.eyebrow, children: label })] }),
      jsx('h1', { style: css.title, children: title }),
      subtitle && jsx('p', { style: css.subtitle, children: subtitle }),
      children
    ]
  })
}
function Card({ title, icon, children, accent = false }) {
  return jsxs('section', {
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
    onClick: onClick || (() => host.navigate(path)), style: primary ? css.button : css.ghost, children: [
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

function Today() {
  const { data, isLoading, error } = useApi('/today', ['today'])
  return jsx(Page, {
    label: data?.date || 'Hoje', title: 'O que você estuda agora?',
    subtitle: 'Uma sessão clara, com contexto e próximo passo — sem transformar aprendizado em uma lista infinita.',
    children: isLoading ? jsx(Loading, { label: 'hoje' }) : error ? jsx(ErrorState, { label: 'hoje', error }) : !data?.session ? jsx(Empty, { label: 'hoje' }) : jsxs('div', {
      style: css.grid, children: [
        jsx(Card, {
          accent: true, children: jsxs('div', {
            children: [
              jsxs('div', {
                style: { display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }, children: [
                  jsx('span', { style: css.heroIconWrap, children: jsx('span', { className: `codicon codicon-${kindIcon.lesson}` }) }),
                  jsxs('div', { children: [
                    jsx('div', { style: { color: 'var(--muted-foreground)', fontSize: 12.5, fontWeight: 600, marginBottom: 3 }, children: data.track }),
                    jsx('div', { style: { fontSize: 20, fontWeight: 660, letterSpacing: '-.015em' }, children: data.session })
                  ] })
                ]
              }),
              jsx('p', { style: { color: 'var(--muted-foreground)', margin: '0 0 16px', lineHeight: 1.55 }, children: data.objective }),
              jsx('div', { style: css.divider }),
              jsxs('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }, children: [jsx(Badge, { state: data.status, children: `${data.duration} min planejados` }), jsx(Navigate, { path: `${BASE}/lesson`, primary: true, icon: 'arrow-right', children: 'Continuar aprendendo' })] })
            ]
          })
        }),
        jsx(Card, { title: 'Sessão atual', icon: 'pulse', children: jsxs('div', { children: [jsxs('p', { style: { marginTop: 0, color: 'var(--muted-foreground)', fontSize: 13.5 }, children: ['Status: ', jsx(Badge, { state: data.status, children: data.status })] }), jsx(Navigate, { path: `${BASE}/timeline`, icon: 'calendar', children: 'Ver cronograma' })] }) }),
        jsx(Card, { title: 'Depois da sessão', icon: 'arrow-swap', children: jsx('p', { style: { margin: 0, color: 'var(--muted-foreground)', lineHeight: 1.5, fontSize: 13.5 }, children: data.next }) })
      ]
    })
  })
}
function Tracks() {
  const { data, isLoading, error } = useApi('/tracks', ['tracks'])
  const tracks = data?.tracks || []
  return jsx(Page, { label: 'Áreas instaladas', title: 'Trilhas por competência', subtitle: 'O estado descreve evidência de aprendizagem — não apenas um percentual acumulado.', children: isLoading ? jsx(Loading, { label: 'trilhas' }) : error ? jsx(ErrorState, { label: 'trilhas', error }) : !tracks.length ? jsx(Empty, { label: 'trilhas' }) : jsx('div', { style: css.grid, children: tracks.map((t) => jsx(Card, { title: t.title, icon: 'library', children: jsxs('div', { children: [jsx('div', { style: { color: 'var(--muted-foreground)', marginBottom: 12, fontSize: 13 }, children: t.stage }), jsx(Badge, { state: t.status, children: t.status }), jsx('p', { style: { marginBottom: 0, marginTop: 12, color: 'var(--muted-foreground)', fontSize: 13, lineHeight: 1.5 }, children: t.detail })] }) }, t.id)) }) })
}
function Timeline() {
  const { data, isLoading, error } = useApi('/timeline', ['timeline'])
  const section = (title, icon, rows) => jsx(Card, { title, icon, children: !rows?.length ? jsx(Empty, { label: title }) : rows.map((r) => jsx(ListRow, { icon: kindIcon[r.kind], title: `${r.entry_date} · ${r.text}`, detail: r.adaptive_reason || (r.kind === 'repair' ? 'Alteração adaptativa; plano original preservado.' : r.kind) }, r.id)) })
  return jsx(Page, { label: 'Planejado e real', title: 'Cronograma', subtitle: 'O histórico real explica adaptações sem apagar o plano que existia antes delas.', children: isLoading ? jsx(Loading, { label: 'cronograma' }) : error ? jsx(ErrorState, { label: 'cronograma', error }) : jsxs('div', { style: css.grid, children: [section('Plano original', 'checklist', data?.planned), section('Execução real', 'history', data?.actual)] }) })
}
function Lesson() {
  const { data, isLoading, error } = useApi('/today', ['today'])
  const sessionId = data?.session_id
  const { data: session, isLoading: isLoadingSession } = useApi(sessionId ? `/sessions/${sessionId}` : null, ['session', sessionId])
  if (isLoading || isLoadingSession) return jsx(Page, { label: '…', title: 'Aula', children: jsx(Loading, { label: 'aula' }) })
  if (error || !session) return jsx(Page, { label: 'Aula', title: 'Aula', children: error ? jsx(ErrorState, { label: 'aula', error }) : jsx(Empty, { label: 'aula' }) })
  return jsx(Page, {
    label: session.teacher, title: session.actual_topic || session.planned_topic, subtitle: 'Aula híbrida: leitura, representação visual, código e recuperação ativa trabalham juntos.',
    children: jsxs('div', {
      style: { display: 'grid', gap: 14 }, children: [
        (session.blocks || []).map(([type, body]) => jsx(Card, { title: type, icon: blockIcon[type] || 'symbol-misc', children: type === 'Código' || type === 'Diagrama' ? jsx('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 13, background: 'color-mix(in srgb, var(--foreground) 4%, transparent)', padding: 12, borderRadius: 9 }, children: body }) : jsx('p', { style: { margin: 0, lineHeight: 1.65, fontSize: 14 }, children: body }) }, type)),
        jsxs('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }, children: [jsx(Navigate, { path: `${BASE}/lab`, primary: true, icon: 'beaker', children: 'Ir para o laboratório' }), jsx(Navigate, { path: `${BASE}/resources`, icon: 'comment-discussion', children: 'Perguntar ao professor' })] })
      ]
    })
  })
}
const LAB_ID = 'lab-dns-entre-containers'
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
  const { data: lab, isLoading, error } = useApi(`/labs/${LAB_ID}`, ['lab', LAB_ID])
  const runCheck = async () => { try { await postApi(`/labs/${LAB_ID}/check`) } catch (e) { host.toast?.(String(e), 'error') } }
  const doStart = async () => { try { await postApi(`/labs/${LAB_ID}/start`) } catch (e) { host.toast?.(String(e), 'error') } }
  const doReset = async () => { try { await postApi(`/labs/${LAB_ID}/reset`) } catch (e) { host.toast?.(String(e), 'error') } }
  if (isLoading) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: jsx(Loading, { label: 'laboratório' }) })
  if (error || !lab) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: error ? jsx(ErrorState, { label: 'laboratório', error }) : jsx(Empty, { label: 'laboratório' }) })
  const startState = lab.status === 'not_started' || lab.status === 'ready_to_check'
  return jsx(Page, {
    label: 'Sandbox simulado · sem execução no renderer', title: lab.title, subtitle: lab.objective,
    children: jsxs('div', {
      style: css.grid, children: [
        jsx(Card, {
          title: 'Ambiente', icon: 'beaker', accent: true, children: jsxs('div', {
            children: [
              jsx(Badge, { state: lab.status, children: lab.status }),
              jsx(TerminalChrome, { children: lab.terminal_output || '$ (ambiente ainda não iniciado)' }),
              jsxs('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [jsx(Navigate, { primary: true, icon: startState ? 'play' : 'check', onClick: startState ? doStart : runCheck, children: startState ? 'Iniciar ambiente' : 'Executar checks' }), jsx(Navigate, { icon: 'debug-rerun', onClick: runCheck, children: 'Rodar checks (simulado)' }), jsx(Navigate, { icon: 'refresh', onClick: doReset, children: 'Resetar' })] })
            ]
          })
        }),
        jsx(Card, { title: 'Evidência e resultado', icon: 'verified', children: jsx('p', { style: { margin: 0, lineHeight: 1.55, fontSize: 13.5, color: 'var(--muted-foreground)' }, children: lab.evidence_note }) })
      ]
    })
  })
}
function Assessments() {
  const { data, isLoading, error } = useApi('/assessments', ['assessments'])
  const items = data?.assessments || []
  return jsx(Page, { label: 'Verificação de domínio', title: 'Avaliações', subtitle: 'Resultados preservam contexto, ajuda utilizada e evidências — não colapsam a aprendizagem em uma nota única.', children: isLoading ? jsx(Loading, { label: 'avaliações' }) : error ? jsx(ErrorState, { label: 'avaliações', error }) : !items.length ? jsx(Empty, { label: 'avaliações' }) : jsx('div', { style: { display: 'grid', gap: 14 }, children: items.map((a) => jsx(Card, { title: a.title, icon: 'checklist', children: jsxs('div', { children: [jsx(Badge, { state: a.status, children: `${a.type} · ${a.status}` }), jsx('p', { style: { fontSize: 13.5, lineHeight: 1.5 }, children: a.result }), jsx('div', { style: { color: 'var(--muted-foreground)', fontSize: 12.5 }, children: `Ajuda: ${a.help_used} · Evidências: ${a.evidence_count}` })] }) }, a.id)) }) })
}
function Progress() {
  const { data, isLoading, error } = useApi('/evidence', ['evidence'])
  const items = data?.evidence || []
  return jsx(Page, { label: 'Árvore de conhecimento', title: 'Progresso', subtitle: 'Drill-down por competência: evidências, tentativas, erros e a próxima intervenção.', children: isLoading ? jsx(Loading, { label: 'progresso' }) : error ? jsx(ErrorState, { label: 'progresso', error }) : jsx(Card, { title: 'DevOps → Containers → Docker → Networking', icon: 'type-hierarchy', children: items.map((e) => jsx('div', { style: e.depth ? { marginLeft: e.depth * 18, paddingLeft: 10, borderLeft: '1px solid color-mix(in srgb, var(--border) 80%, transparent)' } : {}, children: jsx(ListRow, { icon: e.depth ? 'chevron-right' : 'symbol-class', title: e.label, detail: e.detail, action: jsx(Badge, { state: e.status, children: e.status }) }) }, e.id)) }) })
}
function Resources() {
  const { data, isLoading, error } = useApi('/resources', ['resources'])
  const items = data?.resources || []
  return jsx(Page, { label: 'Poucos, selecionados e situados', title: 'Recursos', subtitle: 'Cada recurso serve à sessão atual; fontes oficiais têm preferência quando são a referência adequada.', children: isLoading ? jsx(Loading, { label: 'recursos' }) : error ? jsx(ErrorState, { label: 'recursos', error }) : jsx(Card, { children: items.map((r) => jsx(ListRow, { icon: r.type === 'Vídeo' ? 'play' : r.type === 'Lab' ? 'beaker' : 'book', title: `${r.type} · ${r.title}`, detail: r.detail }, r.id)) }) })
}
function Projects() {
  const { data, isLoading, error } = useApi('/projects', ['projects'])
  const items = data?.projects || []
  return jsx(Page, { label: 'Integração de competências', title: 'Projetos', subtitle: 'Projetos conectam capacidades que a prática isolada não demonstra por si só.', children: isLoading ? jsx(Loading, { label: 'projetos' }) : error ? jsx(ErrorState, { label: 'projetos', error }) : jsx('div', { style: css.grid, children: items.map((p) => jsx(Card, { title: p.title, icon: 'project', accent: true, children: jsxs('div', { children: [jsx('p', { style: { fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted-foreground)' }, children: p.competencies }), jsx(Badge, { state: p.status, children: p.status })] }) }, p.id)) }) })
}

const pages = [
  ['today', 'Hoje', 'home', Today], ['tracks', 'Trilhas', 'library', Tracks], ['timeline', 'Cronograma', 'calendar', Timeline], ['lesson', 'Aula', 'book', Lesson], ['lab', 'Laboratórios', 'beaker', Lab], ['assessments', 'Avaliações', 'checklist', Assessments], ['progress', 'Progresso', 'graph', Progress], ['resources', 'Recursos', 'references', Resources], ['projects', 'Projetos', 'project', Projects]
]
export default {
  id: 'gnos-learning-os',
  name: 'GNOS Learning OS',
  description: 'GNOS Learning Dashboard — interface V1 para a jornada de estudos.',
  register(ctx) {
    restImpl = (path, opts) => ctx.rest(path, opts)
    ctx.registerMany([
      ...pages.flatMap(([path, label, codicon, Component]) => [
        { id: `gnos.route.${path}`, area: ROUTES_AREA, data: { path: `${BASE}/${path}` }, render: () => jsx(Component, {}) },
        { id: `gnos.nav.${path}`, area: SIDEBAR_NAV_AREA, data: { path: `${BASE}/${path}`, label, codicon } }
      ]),
      { id: 'gnos.palette.open', area: PALETTE_AREA, data: { id: 'gnos.open', label: 'Abrir GNOS Learning OS', keywords: ['gnos', 'learning', 'study'], run: () => host.navigate(`${BASE}/today`) } }
    ])
  }
}
