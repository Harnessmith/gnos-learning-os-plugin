import { jsx, jsxs } from 'react/jsx-runtime'

export function MetricsPage({ useApi, Page, Loading, ErrorState, Empty, Card, Badge, css }) {
  const { data, isLoading, error } = useApi('/metrics', ['metrics'])
  const totals = data?.totals || {}
  const byTrack = data?.by_track || []
  const weekdayCalendar = data?.weekday_calendar || []
  const courses = data?.courses || []
  const maxWeekday = Math.max(1, ...weekdayCalendar.map((d) => Math.max(d.planned, d.actual)))
  const exercisePercent = totals.exercises_total ? Math.round((totals.exercises_done / totals.exercises_total) * 100) : 0
  const sessionPercent = totals.sessions_total ? Math.round((totals.sessions_completed / totals.sessions_total) * 100) : 0
  return jsx(Page, {
    label: 'Visão geral', title: 'Métricas', subtitle: 'Minutos reais de estudo, exercícios concluídos e o calendário programático por matéria/curso.',
    children: isLoading ? jsx(Loading, { label: 'métricas' }) : error ? jsx(ErrorState, { label: 'métricas', error }) : jsxs('div', { style: { display: 'grid', gap: 16 }, children: [
      jsxs('section', { style: css.grid, children: [
        jsx(Card, { title: 'Minutos reais de estudo', icon: 'clock', children: jsxs('div', { children: [jsx('strong', { style: css.metric, children: totals.minutes_real || 0 }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: `de ${totals.minutes_planned || 0} min planejados` })] }) }),
        jsx(Card, { title: 'Sessões concluídas', icon: 'check', children: jsxs('div', { children: [jsx('strong', { style: css.metric, children: `${totals.sessions_completed || 0}/${totals.sessions_total || 0}` }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: `${sessionPercent}% do total` })] }) }),
        jsx(Card, { title: 'Exercícios feitos', icon: 'checklist', children: jsxs('div', { children: [jsx('strong', { style: css.metric, children: `${totals.exercises_done || 0}/${totals.exercises_total || 0}` }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 13 }, children: `${exercisePercent}% concluído` })] }) })
      ] }),
      jsx(Card, { title: 'Calendário programático', icon: 'calendar', children: !weekdayCalendar.length ? jsx(Empty, { label: 'calendário' }) : jsx('div', { style: { display: 'grid', gap: 10 }, children: weekdayCalendar.map((d) => jsxs('div', { style: { display: 'grid', gridTemplateColumns: '90px minmax(0,1fr) 70px', gap: 10, alignItems: 'center' }, children: [
        jsx('span', { style: { fontSize: 13, color: 'var(--muted-foreground)' }, children: d.weekday }),
        jsxs('div', { style: { position: 'relative', height: 10, borderRadius: 6, background: 'color-mix(in srgb, var(--foreground) 6%, transparent)', overflow: 'hidden' }, children: [
          jsx('div', { style: { position: 'absolute', inset: 0, width: `${(d.planned / maxWeekday) * 100}%`, background: 'color-mix(in srgb, var(--accent) 30%, transparent)' } }),
          jsx('div', { style: { position: 'absolute', inset: 0, width: `${(d.actual / maxWeekday) * 100}%`, background: 'var(--accent)' } })
        ] }),
        jsx('span', { style: { fontSize: 12, color: 'var(--muted-foreground)', textAlign: 'right' }, children: `${d.actual}/${d.planned}` })
      ] }, d.weekday)) }) }),
      jsx(Card, { title: 'Progresso por matéria/curso', icon: 'graph', children: !byTrack.length ? jsx(Empty, { label: 'trilhas' }) : jsx('div', { style: { display: 'grid', gap: 12 }, children: byTrack.map((t) => jsxs('div', { style: { borderBottom: '1px solid var(--border)', paddingBottom: 12 }, children: [
        jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }, children: [
          jsx('strong', { children: t.title }),
          jsx(Badge, { state: t.stage, children: t.stage || '—' })
        ] }),
        jsxs('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--muted-foreground)' }, children: [
          jsxs('span', { children: ['◷ ', `${t.minutes_real} min reais`] }),
          jsxs('span', { children: ['◉ ', `${t.sessions_completed}/${t.sessions_total} sessões`] }),
          jsxs('span', { children: ['✓ ', `${t.exercises_done}/${t.exercises_total} exercícios`] })
        ] })
      ] }, t.track_id)) }) }),
      jsx(Card, { title: 'Conclusão dos cursos', icon: 'mortar-board', children: !courses.length ? jsx(Empty, { label: 'cursos' }) : jsx('div', { style: { display: 'grid', gap: 12 }, children: courses.map((c) => jsxs('div', { children: [
        jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 }, children: [jsx('strong', { style: { fontSize: 13.5 }, children: c.title }), jsx('span', { style: { fontSize: 12.5, color: 'var(--muted-foreground)' }, children: `${c.lessons_ready}/${c.lessons_total} aulas · ${c.percent}%` })] }),
        jsx('div', { style: { height: 8, borderRadius: 5, background: 'color-mix(in srgb, var(--foreground) 6%, transparent)', overflow: 'hidden' }, children: jsx('div', { style: { height: '100%', width: `${c.percent}%`, background: 'var(--accent)' } }) })
      ] }, c.course_id)) }) })
    ] })
  })
}
