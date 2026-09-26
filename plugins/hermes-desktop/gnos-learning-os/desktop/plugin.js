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

const statusTone = { unknown: 'muted', exposed: 'blue', practicing: 'amber', demonstrated: 'green', retained: 'green', 'repair-needed': 'red', planned: 'muted', corrected: 'amber', in_progress: 'amber', completed: 'green', not_started: 'muted', running: 'amber', ready_to_check: 'amber', passed: 'green', failed: 'red' }
const kindIcon = { lesson: 'book', lab: 'beaker', review: 'history', retrieval: 'question', checkpoint: 'checklist', exam: 'mortar-board', project: 'project', challenge: 'zap', repair: 'tools' }
const css = {
  page: { maxWidth: 1120, margin: '0 auto', padding: '28px 32px 48px', color: 'var(--foreground)' },
  eyebrow: { color: 'var(--muted-foreground)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 },
  title: { fontSize: 30, letterSpacing: '-.035em', fontWeight: 650, margin: '0 0 8px' },
  subtitle: { color: 'var(--muted-foreground)', margin: '0 0 24px', maxWidth: 760 },
  grid: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' },
  card: { border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 10, padding: 17 },
  accentCard: { border: '1px solid color-mix(in srgb, var(--accent) 45%, var(--border))', background: 'color-mix(in srgb, var(--accent) 8%, var(--card))', borderRadius: 10, padding: 20 },
  button: { background: 'var(--accent)', color: 'var(--accent-foreground)', border: 0, borderRadius: 7, padding: '9px 13px', fontWeight: 600, cursor: 'pointer' },
  ghost: { background: 'transparent', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px', cursor: 'pointer' },
  state: { color: 'var(--muted-foreground)', padding: '48px 0', textAlign: 'center' }
}
function Page({ label, title, subtitle, children }) { return jsxs('main', { style: css.page, children: [jsx('div', { style: css.eyebrow, children: label }), jsx('h1', { style: css.title, children: title }), subtitle && jsx('p', { style: css.subtitle, children: subtitle }), children] }) }
function Card({ title, children, accent = false }) { return jsxs('section', { style: accent ? css.accentCard : css.card, children: [title && jsx('h2', { style: { fontSize: 15, margin: '0 0 10px', fontWeight: 650 }, children: title }), children] }) }
function Badge({ children, state }) { const tone = statusTone[state] || 'muted'; const colors = { muted: 'var(--muted)', blue: '#2563eb', amber: '#b45309', green: '#15803d', red: '#b91c1c' }; return jsx('span', { style: { display: 'inline-block', color: tone === 'muted' ? 'var(--muted-foreground)' : colors[tone], border: `1px solid ${tone === 'muted' ? 'var(--border)' : colors[tone]}`, borderRadius: 999, padding: '2px 7px', fontSize: 11, fontWeight: 600 }, children }) }
function Navigate({ path, children, primary = false, onClick }) { return jsx('button', { onClick: onClick || (() => host.navigate(path)), style: primary ? css.button : css.ghost, children }) }
function ListRow({ icon = 'circle-small-filled', title, detail, action }) { return jsxs('div', { style: { display: 'flex', gap: 10, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--border)' }, children: [jsx('span', { className: `codicon codicon-${icon}`, style: { color: 'var(--muted-foreground)' } }), jsxs('div', { style: { flex: 1, minWidth: 0 }, children: [jsx('div', { style: { fontWeight: 560 }, children: title }), detail && jsx('div', { style: { color: 'var(--muted-foreground)', fontSize: 13, marginTop: 2 }, children: detail })] }), action] }) }
function Loading({ label }) { return jsx('div', { style: css.state, children: `Carregando ${label}…` }) }
function ErrorState({ label, error }) { return jsxs('div', { style: css.state, children: [jsx('div', { children: `Não foi possível carregar ${label}.` }), jsx('div', { style: { fontSize: 12, marginTop: 6 }, children: String(error?.message || error || '') })] }) }
function Empty({ label }) { return jsx('div', { style: css.state, children: `Nada em ${label} ainda.` }) }

function Today() {
  const { data, isLoading, error } = useApi('/today', ['today'])
  return jsx(Page, {
    label: data?.date || 'Hoje', title: 'O que você estuda agora?',
    subtitle: 'Uma sessão clara, com contexto e próximo passo — sem transformar aprendizado em uma lista infinita.',
    children: isLoading ? jsx(Loading, { label: 'hoje' }) : error ? jsx(ErrorState, { label: 'hoje', error }) : !data?.session ? jsx(Empty, { label: 'hoje' }) : jsxs('div', {
      style: css.grid, children: [
        jsx(Card, { title: data.track, accent: true, children: jsxs('div', { children: [jsx('div', { style: { fontSize: 19, fontWeight: 650, marginBottom: 8 }, children: data.session }), jsx('p', { style: { color: 'var(--muted-foreground)', margin: '0 0 14px' }, children: data.objective }), jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [jsx(Badge, { state: data.status, children: `${data.duration} min planejados` }), jsx(Navigate, { path: `${BASE}/lesson`, primary: true, children: 'Continuar aprendendo' })] })] }) }),
        jsx(Card, { title: 'Sessão atual', children: jsxs('div', { children: [jsx('p', { style: { marginTop: 0 }, children: `Status: ${data.status}` }), jsx(Navigate, { path: `${BASE}/timeline`, children: 'Ver cronograma' })] }) }),
        jsx(Card, { title: 'Depois da sessão', children: jsx('p', { style: { margin: 0, color: 'var(--muted-foreground)' }, children: data.next }) })
      ]
    })
  })
}
function Tracks() {
  const { data, isLoading, error } = useApi('/tracks', ['tracks'])
  const tracks = data?.tracks || []
  return jsx(Page, { label: 'Áreas instaladas', title: 'Trilhas por competência', subtitle: 'O estado descreve evidência de aprendizagem — não apenas um percentual acumulado.', children: isLoading ? jsx(Loading, { label: 'trilhas' }) : error ? jsx(ErrorState, { label: 'trilhas', error }) : !tracks.length ? jsx(Empty, { label: 'trilhas' }) : jsx('div', { style: css.grid, children: tracks.map((t) => jsx(Card, { title: t.title, children: jsxs('div', { children: [jsx('div', { style: { color: 'var(--muted-foreground)', marginBottom: 10 }, children: t.stage }), jsx(Badge, { state: t.status, children: t.status }), jsx('p', { style: { marginBottom: 0, color: 'var(--muted-foreground)' }, children: t.detail })] }) }, t.id)) }) })
}
function Timeline() {
  const { data, isLoading, error } = useApi('/timeline', ['timeline'])
  const section = (title, rows) => jsx(Card, { title, children: !rows?.length ? jsx(Empty, { label: title }) : rows.map((r) => jsx(ListRow, { icon: kindIcon[r.kind], title: `${r.entry_date} · ${r.text}`, detail: r.adaptive_reason || (r.kind === 'repair' ? 'Alteração adaptativa; plano original preservado.' : r.kind) }, r.id)) })
  return jsx(Page, { label: 'Planejado e real', title: 'Cronograma', subtitle: 'O histórico real explica adaptações sem apagar o plano que existia antes delas.', children: isLoading ? jsx(Loading, { label: 'cronograma' }) : error ? jsx(ErrorState, { label: 'cronograma', error }) : jsxs('div', { style: css.grid, children: [section('Plano original', data?.planned), section('Execução real', data?.actual)] }) })
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
        (session.blocks || []).map(([type, body]) => jsx(Card, { title: type, children: type === 'Código' || type === 'Diagrama' ? jsx('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', overflow: 'auto', fontFamily: 'var(--font-mono)' }, children: body }) : jsx('p', { style: { margin: 0, lineHeight: 1.65 }, children: body }) }, type)),
        jsxs('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' }, children: [jsx(Navigate, { path: `${BASE}/lab`, primary: true, children: 'Ir para o laboratório' }), jsx(Navigate, { path: `${BASE}/resources`, children: 'Perguntar ao professor' })] })
      ]
    })
  })
}
const LAB_ID = 'lab-dns-entre-containers'
function Lab() {
  const { data: lab, isLoading, error } = useApi(`/labs/${LAB_ID}`, ['lab', LAB_ID])
  const [busy, setBusy] = [false, () => {}]
  const runCheck = async () => { try { await postApi(`/labs/${LAB_ID}/check`) } catch (e) { host.toast?.(String(e), 'error') } }
  const doStart = async () => { try { await postApi(`/labs/${LAB_ID}/start`) } catch (e) { host.toast?.(String(e), 'error') } }
  const doReset = async () => { try { await postApi(`/labs/${LAB_ID}/reset`) } catch (e) { host.toast?.(String(e), 'error') } }
  if (isLoading) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: jsx(Loading, { label: 'laboratório' }) })
  if (error || !lab) return jsx(Page, { label: 'Laboratório', title: 'Laboratório', children: error ? jsx(ErrorState, { label: 'laboratório', error }) : jsx(Empty, { label: 'laboratório' }) })
  return jsx(Page, {
    label: 'Sandbox simulado · sem execução no renderer', title: lab.title, subtitle: lab.objective,
    children: jsxs('div', {
      style: css.grid, children: [
        jsx(Card, {
          title: 'Ambiente', accent: true, children: jsxs('div', {
            children: [
              jsx(Badge, { state: lab.status, children: lab.status }),
              jsx('pre', { style: { margin: '14px 0', padding: 12, borderRadius: 7, background: 'var(--muted)', overflow: 'auto' }, children: lab.terminal_output || '$ (ambiente ainda não iniciado)' }),
              jsxs('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [jsx(Navigate, { primary: true, onClick: lab.status === 'not_started' || lab.status === 'ready_to_check' ? doStart : runCheck, children: lab.status === 'not_started' || lab.status === 'ready_to_check' ? 'Iniciar ambiente' : 'Executar checks' }), jsx(Navigate, { onClick: runCheck, children: 'Rodar checks (simulado)' }), jsx(Navigate, { onClick: doReset, children: 'Resetar' })] })
            ]
          })
        }),
        jsx(Card, { title: 'Evidência e resultado', children: jsx('p', { style: { margin: 0, lineHeight: 1.55 }, children: lab.evidence_note }) })
      ]
    })
  })
}
function Assessments() {
  const { data, isLoading, error } = useApi('/assessments', ['assessments'])
  const items = data?.assessments || []
  return jsx(Page, { label: 'Verificação de domínio', title: 'Avaliações', subtitle: 'Resultados preservam contexto, ajuda utilizada e evidências — não colapsam a aprendizagem em uma nota única.', children: isLoading ? jsx(Loading, { label: 'avaliações' }) : error ? jsx(ErrorState, { label: 'avaliações', error }) : !items.length ? jsx(Empty, { label: 'avaliações' }) : jsx('div', { style: { display: 'grid', gap: 14 }, children: items.map((a) => jsx(Card, { title: a.title, children: jsxs('div', { children: [jsx(Badge, { state: a.status, children: `${a.type} · ${a.status}` }), jsx('p', { children: a.result }), jsx('div', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: `Ajuda: ${a.help_used} · Evidências: ${a.evidence_count}` })] }) }, a.id)) }) })
}
function Progress() {
  const { data, isLoading, error } = useApi('/evidence', ['evidence'])
  const items = data?.evidence || []
  return jsx(Page, { label: 'Árvore de conhecimento', title: 'Progresso', subtitle: 'Drill-down por competência: evidências, tentativas, erros e a próxima intervenção.', children: isLoading ? jsx(Loading, { label: 'progresso' }) : error ? jsx(ErrorState, { label: 'progresso', error }) : jsx(Card, { title: 'DevOps → Containers → Docker → Networking', children: items.map((e) => jsx('div', { style: { marginLeft: e.depth * 20 }, children: jsx(ListRow, { icon: e.depth ? 'chevron-right' : 'symbol-class', title: e.label, detail: e.detail, action: jsx(Badge, { state: e.status, children: e.status }) }) }, e.id)) }) })
}
function Resources() {
  const { data, isLoading, error } = useApi('/resources', ['resources'])
  const items = data?.resources || []
  return jsx(Page, { label: 'Poucos, selecionados e situados', title: 'Recursos', subtitle: 'Cada recurso serve à sessão atual; fontes oficiais têm preferência quando são a referência adequada.', children: isLoading ? jsx(Loading, { label: 'recursos' }) : error ? jsx(ErrorState, { label: 'recursos', error }) : jsx(Card, { children: items.map((r) => jsx(ListRow, { icon: r.type === 'Vídeo' ? 'play' : r.type === 'Lab' ? 'beaker' : 'book', title: `${r.type} · ${r.title}`, detail: r.detail }, r.id)) }) })
}
function Projects() {
  const { data, isLoading, error } = useApi('/projects', ['projects'])
  const items = data?.projects || []
  return jsx(Page, { label: 'Integração de competências', title: 'Projetos', subtitle: 'Projetos conectam capacidades que a prática isolada não demonstra por si só.', children: isLoading ? jsx(Loading, { label: 'projetos' }) : error ? jsx(ErrorState, { label: 'projetos', error }) : jsx('div', { style: css.grid, children: items.map((p) => jsx(Card, { title: p.title, accent: true, children: jsxs('div', { children: [jsx('p', { children: p.competencies }), jsx(Badge, { state: p.status, children: p.status })] }) }, p.id)) }) })
}

const pages = [
  ['today', 'Hoje', 'home', Today], ['tracks', 'Trilhas', 'library', Tracks], ['timeline', 'Cronograma', 'calendar', Timeline], ['lesson', 'Aula', 'book', Lesson], ['lab', 'Laboratórios', 'beaker', Lab], ['assessments', 'Avaliações', 'checklist', Assessments], ['progress', 'Progresso', 'graph', Progress], ['resources', 'Recursos', 'references', Resources], ['projects', 'Projetos', 'project', Projects]
]
export default function activate(ctx) {
  restImpl = (path, opts) => ctx.rest(path, opts)
  ctx.registerMany([
    ...pages.flatMap(([path, label, codicon, Component]) => [
      { id: `gnos.route.${path}`, area: ROUTES_AREA, data: { path: `${BASE}/${path}` }, render: () => jsx(Component, {}) },
      { id: `gnos.nav.${path}`, area: SIDEBAR_NAV_AREA, data: { path: `${BASE}/${path}`, label, codicon } }
    ]),
    { id: 'gnos.palette.open', area: PALETTE_AREA, data: { id: 'gnos.open', label: 'Abrir GNOS Learning OS', keywords: ['gnos', 'learning', 'study'], run: () => host.navigate(`${BASE}/today`) } }
  ])
}
