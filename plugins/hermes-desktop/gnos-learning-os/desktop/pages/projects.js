import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const statusLabels = { planned: 'Planejado', in_progress: 'Em andamento', blocked: 'Bloqueado', completed: 'Concluído', archived: 'Arquivado' }

export function ProjectsPage({ useApi, postApi, mutateApi, host, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css }) {
  const [refresh, setRefresh] = useState(0)
  const { data, isLoading, error } = useApi('/projects', ['projects', refresh])
  const items = data?.projects || []
  const [selectedId, setSelectedId] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ title: '', objective: '', competencies: '', next_step: '' })
  const detail = useApi(selectedId ? `/projects/${selectedId}` : null, ['project', selectedId, refresh], { enabled: Boolean(selectedId) })
  const selectProject = (id) => setSelectedId(id)
  const createProject = async () => {
    if (!draft.title.trim()) { host.toast?.('Informe um título para o projeto.', 'error'); return }
    setBusy(true)
    try {
      const result = await postApi('/projects', { ...draft, competencies: draft.competencies.split(',').map((item) => item.trim()).filter(Boolean) })
      setDraft({ title: '', objective: '', competencies: '', next_step: '' }); setCreateOpen(false); selectProject(result.project.id); setRefresh((value) => value + 1); host.toast?.('Projeto criado.', 'success')
    } catch (e) { host.toast?.(String(e?.message || e), 'error') } finally { setBusy(false) }
  }
  const createForm = createOpen && jsx(Card, { title: 'Novo projeto', icon: 'add', accent: true, children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [
    jsx('input', { className: 'gnos-select', value: draft.title, placeholder: 'Título do projeto', 'aria-label': 'Título do projeto', onChange: (e) => setDraft({ ...draft, title: e.target.value }) }),
    jsx('textarea', { className: 'gnos-select', rows: 3, value: draft.objective, placeholder: 'Objetivo e resultado verificável', 'aria-label': 'Objetivo do projeto', onChange: (e) => setDraft({ ...draft, objective: e.target.value }) }),
    jsx('input', { className: 'gnos-select', value: draft.competencies, placeholder: 'Competências (separadas por vírgula)', 'aria-label': 'Competências relacionadas', onChange: (e) => setDraft({ ...draft, competencies: e.target.value }) }),
    jsx('input', { className: 'gnos-select', value: draft.next_step, placeholder: 'Próximo passo concreto', 'aria-label': 'Próximo passo', onChange: (e) => setDraft({ ...draft, next_step: e.target.value }) }),
    jsxs('div', { style: { display: 'flex', gap: 8 }, children: [jsx(Navigate, { primary: true, disabled: busy, onClick: createProject, children: busy ? 'Criando…' : 'Criar projeto' }), jsx(Navigate, { disabled: busy, onClick: () => setCreateOpen(false), children: 'Cancelar' })] })
  ] }) })
  return jsx(Page, { label: 'Integração de competências', title: 'Projetos', subtitle: 'Planeje entregas, registre o trabalho e vincule evidências às capacidades demonstradas.', actions: jsx(Navigate, { primary: true, icon: 'add', onClick: () => setCreateOpen(!createOpen), children: createOpen ? 'Fechar formulário' : 'Novo projeto' }), children: isLoading ? jsx(Loading, { label: 'projetos' }) : error ? jsx(ErrorState, { label: 'projetos', error }) : jsxs('div', { style: { display: 'grid', gap: 16 }, children: [createForm, !items.length ? jsx(Empty, { label: 'projetos — crie o primeiro projeto para conectar suas competências' }) : jsx('div', { style: css.grid, children: items.map((project) => jsx('button', { type: 'button', onClick: () => selectProject(project.id), style: { border: 0, padding: 0, textAlign: 'left', background: 'transparent', color: 'inherit', cursor: 'pointer' }, children: jsx(Card, { title: project.title, icon: 'project', accent: selectedId === project.id, children: jsxs('div', { children: [jsx('p', { style: { fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted-foreground)' }, children: project.objective || 'Defina o objetivo verificável deste projeto.' }), jsx(Badge, { state: project.status, children: statusLabels[project.status] || project.status }), jsx('p', { style: { margin: '12px 0 0', fontSize: 13 }, children: `${project.milestones_completed}/${project.milestones_total} marcos · ${project.progress_percent}%` }), project.next_step && jsx('p', { style: { margin: '8px 0 0', color: 'var(--muted-foreground)', fontSize: 12.5 }, children: `Próximo: ${project.next_step}` })] }) }) }, project.id)) }), selectedId && (detail.isLoading ? jsx(Loading, { label: 'detalhe do projeto' }) : detail.error ? jsx(ErrorState, { label: 'detalhe do projeto', error: detail.error }) : jsx(ProjectDetail, { data: detail.data, postApi, mutateApi, host, css, Card, Badge, Navigate, busy, setBusy, onChanged: () => setRefresh((value) => value + 1) }))] }) })
}

function ProjectDetail({ data, postApi, mutateApi, host, css, Card, Badge, Navigate, busy, setBusy, onChanged }) {
  const project = data?.project
  const [activity, setActivity] = useState('')
  const [milestone, setMilestone] = useState('')
  const [evidence, setEvidence] = useState({ label: '', url: '', detail: '' })
  const [nextStep, setNextStep] = useState(project?.next_step || '')
  if (!project) return null
  const run = async (work, success) => { setBusy(true); try { await work(); onChanged(); host.toast?.(success, 'success') } catch (e) { host.toast?.(String(e?.message || e), 'error') } finally { setBusy(false) } }
  return jsx(Card, { title: `Projeto · ${project.title}`, icon: 'project', accent: true, children: jsxs('div', { style: { display: 'grid', gap: 14 }, children: [
    jsx('p', { style: { margin: 0, lineHeight: 1.55 }, children: project.objective || 'Sem objetivo definido.' }),
    jsx('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: Object.entries(statusLabels).filter(([status]) => status !== 'archived').map(([status, label]) => jsx(Navigate, { primary: project.status === status, disabled: busy || project.status === status || (status === 'completed' && (!(data.milestones || []).length || (data.milestones || []).some((item) => item.status !== 'completed'))), onClick: () => run(() => mutateApi(`/projects/${project.id}`, 'PATCH', { status, next_step: nextStep }), `Projeto marcado como ${label.toLowerCase()}.`), children: label }, status)) }),
    jsxs('label', { style: { display: 'grid', gap: 5, fontSize: 12, color: 'var(--muted-foreground)' }, children: ['Próximo passo', jsx('input', { className: 'gnos-select', value: nextStep, onChange: (e) => setNextStep(e.target.value), style: { ...css.ghost, width: '100%' } })] }),
    jsx(Navigate, { disabled: busy, onClick: () => run(() => mutateApi(`/projects/${project.id}`, 'PATCH', { next_step: nextStep }), 'Próximo passo atualizado.'), children: 'Salvar próximo passo' }),
    jsx(Card, { title: 'Marcos', icon: 'checklist', children: jsxs('div', { style: { display: 'grid', gap: 8 }, children: [(data.milestones || []).map((item) => jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [jsxs('span', { children: [item.title, ' ', jsx(Badge, { state: item.status, children: item.status })] }), item.status !== 'completed' && jsx(Navigate, { disabled: busy, onClick: () => run(() => mutateApi(`/projects/${project.id}/milestones/${item.id}`, 'PATCH', { status: 'completed' }), 'Marco concluído.'), children: 'Concluir marco' })] }, item.id)), jsxs('div', { style: { display: 'flex', gap: 8 }, children: [jsx('input', { className: 'gnos-select', value: milestone, placeholder: 'Novo marco', 'aria-label': 'Novo marco', onChange: (e) => setMilestone(e.target.value), style: { flex: 1 } }), jsx(Navigate, { disabled: busy || !milestone.trim(), onClick: () => run(async () => { await postApi(`/projects/${project.id}/milestones`, { title: milestone.trim() }); setMilestone('') }, 'Marco adicionado.'), children: 'Adicionar' })] })] }) }),
    jsx(Card, { title: 'Atualizações e evidências', icon: 'history', children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [jsx('textarea', { className: 'gnos-select', rows: 2, value: activity, placeholder: 'Registre o avanço realizado', 'aria-label': 'Atualização do projeto', onChange: (e) => setActivity(e.target.value) }), jsx(Navigate, { disabled: busy || !activity.trim(), onClick: () => run(async () => { await postApi(`/projects/${project.id}/activities`, { text: activity.trim() }); setActivity('') }, 'Atualização registrada.'), children: 'Registrar atualização' }), jsx('input', { className: 'gnos-select', value: evidence.label, placeholder: 'Nome da evidência', 'aria-label': 'Nome da evidência', onChange: (e) => setEvidence({ ...evidence, label: e.target.value }) }), jsx('input', { className: 'gnos-select', value: evidence.url, placeholder: 'URL da evidência (opcional)', 'aria-label': 'URL da evidência', onChange: (e) => setEvidence({ ...evidence, url: e.target.value }) }), jsx(Navigate, { disabled: busy || !evidence.label.trim(), onClick: () => run(async () => { await postApi(`/projects/${project.id}/evidence`, evidence); setEvidence({ label: '', url: '', detail: '' }) }, 'Evidência adicionada.'), children: 'Adicionar evidência' }), ...(data.activities || []).map((item) => jsx('p', { style: { margin: 0, fontSize: 13, color: 'var(--muted-foreground)' }, children: `Atualização · ${item.text}` }, item.id)), ...(data.evidence || []).map((item) => jsx('p', { style: { margin: 0, fontSize: 13 }, children: item.url ? jsx('a', { href: item.url, target: '_blank', rel: 'noreferrer', children: `Evidência · ${item.label}` }) : `Evidência · ${item.label}` }, item.id))] }) })
  ] }) })
}
