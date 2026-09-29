import { useState, useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function TodayPage({ useApi, postApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css, evidencePercent, formatElapsed, kindIcon }) {
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
