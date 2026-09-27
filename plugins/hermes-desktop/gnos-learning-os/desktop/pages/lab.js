import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function LabPage({ useApi, postApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, ListRow, css }) {
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
