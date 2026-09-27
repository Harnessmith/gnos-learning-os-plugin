import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function AssessmentsPage({ useApi, postApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css, kindIcon }) {
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
