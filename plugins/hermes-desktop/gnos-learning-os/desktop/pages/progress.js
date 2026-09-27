import { jsx, jsxs } from 'react/jsx-runtime'

export function ProgressPage({ useApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css, evidencePercent, MonthCalendar }) {
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
  ] })
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
