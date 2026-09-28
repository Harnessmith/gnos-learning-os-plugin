import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function TimelinePage({ useApi, mutateApi, postApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css, kindIcon }) {
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
  const completeSession = async (session) => {
    setBusy(true)
    try { await postApi(`/sessions/${session.id}/complete`, { actual_topic: session.planned_topic, actual_duration: session.planned_duration, next_step: session.next_step }); host.toast?.('Sessão concluída.', 'success') } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const plannedCount = sessions.filter((session) => session.status === 'planned').length
  const actualCount = sessions.length - plannedCount
  return jsx(Page, { label: 'Planejado e real', title: 'Cronograma', actions: jsxs('div', { style: { display: 'flex', gap: 6 }, children: [jsx(Navigate, { primary: mode === 'planned', onClick: () => setMode('planned'), children: `Planejado (${plannedCount})` }), jsx(Navigate, { primary: mode === 'actual', onClick: () => setMode('actual'), children: `Real (${actualCount})` })] }), subtitle: 'Reagende aulas futuras, acompanhe o que foi executado e conclua sessões sem apagar o histórico.', children: isLoading ? jsx(Loading, { label: 'cronograma' }) : error ? jsx(ErrorState, { label: 'cronograma', error }) : jsxs('div', { style: { display: 'grid', gap: 16 }, children: [
    jsx(Card, { title: mode === 'planned' ? 'Próximas sessões' : 'Sessões executadas', icon: mode === 'planned' ? 'calendar' : 'history', children: !rows.length ? jsx(Empty, { label: mode === 'planned' ? 'sessões planejadas' : 'sessões executadas' }) : jsx('div', { style: { display: 'grid', gap: 10 }, children: rows.map((session) => editingId === session.id ? jsx(Card, { title: `Editar · ${session.planned_topic || 'Sessão'}`, children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [jsx('input', { type: 'date', className: 'gnos-select', value: draft.planned_date, onChange: (event) => setDraft({ ...draft, planned_date: event.target.value }) }), jsx('input', { className: 'gnos-select', value: draft.planned_topic, placeholder: 'Tópico', onChange: (event) => setDraft({ ...draft, planned_topic: event.target.value }) }), jsx('input', { type: 'number', min: 1, max: 1440, className: 'gnos-select', value: draft.planned_duration, onChange: (event) => setDraft({ ...draft, planned_duration: event.target.value }) }), jsxs('div', { style: { display: 'flex', gap: 8 }, children: [jsx(Navigate, { primary: true, onClick: saveSchedule, children: busy ? 'Salvando…' : 'Salvar agenda' }), jsx(Navigate, { onClick: () => setEditingId(null), children: 'Cancelar' })] })] }) }, session.id) : jsx(ListRow, { icon: kindIcon[session.kind] || 'calendar', title: [session.planned_date || session.actual_date, session.sequence_label, session.actual_topic || session.planned_topic || 'Sessão'].filter(Boolean).join(' · '), detail: `${session.track_title || 'Trilha'} · ${session.planned_duration || session.actual_duration || '—'} min · ${session.status}`, action: mode === 'planned' ? jsxs('div', { style: { display: 'flex', gap: 6 }, children: [jsx(Navigate, { icon: 'edit', onClick: () => beginEdit(session), children: 'Editar' }), jsx(Navigate, { primary: true, icon: 'check', onClick: () => completeSession(session), children: 'Concluir' })] }) : jsx(Badge, { state: 'completed', children: 'concluída' }) }, session.id)) }) }),
    mode === 'actual' && timelineData?.actual?.length ? jsx(Card, { title: 'Histórico de adaptações', icon: 'history', children: timelineData.actual.map((row) => jsx(ListRow, { icon: kindIcon[row.kind] || 'history', title: `${row.entry_date} · ${row.text}`, detail: row.adaptive_reason || row.kind, action: jsx(Badge, { state: row.kind === 'repair' ? 'repair-needed' : 'completed', children: row.kind }) }, row.id)) }) : null
  ] }) })
}
