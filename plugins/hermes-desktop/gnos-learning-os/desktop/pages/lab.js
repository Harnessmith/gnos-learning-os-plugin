import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function LabPage({ useApi, postApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css }) {
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
