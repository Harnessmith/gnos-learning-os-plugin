import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function ResourcesPage({ useApi, mutateApi, host, BASE, Page, Loading, ErrorState, Empty, Card, ListRow, Badge, css, artifactIcon }) {
  const [folderId, setFolderId] = useState(null)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const queryFolder = folderId ? `&folder_id=${encodeURIComponent(folderId)}` : ''
  const querySearch = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''
  const queryKind = kind !== 'all' ? `&kind=${kind}` : ''
  const { data, isLoading, error } = useApi(`/library?page=${page}&page_size=12${queryFolder}${querySearch}${queryKind}`, ['library', folderId, page, query, kind])
  const { data: todayData } = useApi('/today', ['today'])
  const folders = data?.folders || []
  const selectedFolder = data?.selected_folder || folderId
  const items = data?.items || []
  const selectFolder = (id) => { setFolderId(id); setPage(1) }
  const toggleFavorite = async (item) => {
    try {
      await mutateApi(`/library/favorites/${encodeURIComponent(item.id)}`, item.favorite ? 'DELETE' : 'POST')
      host.toast?.(item.favorite ? 'Removido dos favoritos.' : 'Adicionado aos favoritos.', 'success')
    } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') }
  }
  const recordUsage = async (item) => {
    if (!todayData?.session_id || item.kind !== 'resource') return
    try {
      await mutateApi(`/sessions/${todayData.session_id}/resources/${encodeURIComponent(item.id)}`, 'POST')
      host.toast?.('Recurso registrado na sessão atual.', 'success')
    } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') }
  }
  const editAssociations = async (item) => {
    if (item.kind !== 'resource') return
    const folderId = window.prompt('Pasta do recurso (vazio para limpar):', item.folder_id || '')
    if (folderId === null) return
    const lessonId = window.prompt('ID da aula relacionada (vazio para limpar):', item.lesson_id || '')
    if (lessonId === null) return
    const competencyId = window.prompt('ID da competência relacionada (vazio para limpar):', item.competency_id || '')
    if (competencyId === null) return
    try {
      await mutateApi(`/library/resources/${encodeURIComponent(item.id)}/associations`, 'PATCH', {
        folder_id: folderId || null, lesson_id: lessonId || null, competency_id: competencyId || null
      })
      host.toast?.('Associações atualizadas.', 'success')
    } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') }
  }
  return jsx(Page, {
    label: 'Biblioteca organizada', title: 'Recursos e fontes',
    subtitle: 'Cada matéria tem suas próprias pastas. A lista é paginada para crescer junto com seus estudos.',
    children: isLoading ? jsx(Loading, { label: 'biblioteca' }) : error ? jsx(ErrorState, { label: 'biblioteca', error }) : jsxs('div', {
      style: { display: 'grid', gap: 16 }, children: [
        jsx(Card, { title: 'Pastas por matéria', icon: 'folder', children: jsxs('div', { style: { display: 'grid', gap: 12 }, children: [
          jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 180px', gap: 10 }, children: [jsx('input', { className: 'gnos-select', value: query, placeholder: 'Buscar recursos e fontes...', onChange: (event) => { setQuery(event.target.value); setPage(1) } }), jsx('select', { className: 'gnos-select', value: kind, onChange: (event) => { setKind(event.target.value); setPage(1) }, children: [jsx('option', { value: 'all', children: 'Todos os tipos' }), jsx('option', { value: 'source', children: 'Fontes' }), jsx('option', { value: 'resource', children: 'Recursos' })] })] }),
          !folders.length ? jsx(Empty, { label: 'pastas' }) : jsx('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }, children: folders.map((folder) => jsx('button', {
          type: 'button', className: 'gnos-action', onClick: () => selectFolder(folder.id),
          style: { textAlign: 'left', padding: 14, borderRadius: 10, border: folder.id === selectedFolder ? '1px solid var(--accent)' : '1px solid var(--border)', background: folder.id === selectedFolder ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--card)', color: 'var(--foreground)', cursor: 'pointer' },
          children: jsxs('div', { children: [jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }, children: [jsx('strong', { children: folder.title }), jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 12 }, children: folder.count })] }), jsx('small', { style: { display: 'block', marginTop: 6, color: 'var(--muted-foreground)' }, children: folder.type === 'sources' ? 'Fontes e referências' : 'Materiais de estudo' })] })
        }, folder.id)) }) }),
        jsx(Card, { title: selectedFolder ? (folders.find((folder) => folder.id === selectedFolder)?.title || 'Conteúdo da pasta') : 'Conteúdo', icon: 'references', children: !items.length ? jsx(Empty, { label: 'itens nesta pasta' }) : jsxs('div', { children: [items.map((item) => jsx(ListRow, { icon: item.kind === 'source' ? 'link-external' : (artifactIcon[item.type] || 'file-text'), title: item.title, detail: `${item.detail || item.provenance || ''}${item.subject_title ? ` · ${item.subject_title}` : ''}`, action: jsx('div', { style: { display: 'flex', gap: 8 }, children: [jsx('button', { type: 'button', className: 'gnos-nav', style: { ...css.ghost, padding: '6px 10px' }, onClick: () => toggleFavorite(item), children: item.favorite ? '★' : '☆', title: item.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos' }), item.kind === 'resource' && jsx('button', { type: 'button', className: 'gnos-nav', style: { ...css.ghost, padding: '6px 10px' }, onClick: () => editAssociations(item), children: 'Associar', title: 'Editar associações do recurso' }), todayData?.session_id && item.kind === 'resource' && jsx('button', { type: 'button', className: 'gnos-nav', style: { ...css.ghost, padding: '6px 10px' }, onClick: () => recordUsage(item), children: 'Usar na sessão', title: 'Registrar uso na sessão atual' }), item.url ? jsx('a', { href: item.url, target: '_blank', rel: 'noreferrer', style: { ...css.ghost, textDecoration: 'none' }, children: 'Abrir' }) : jsx(Badge, { state: 'planned', children: 'Sem link' })] }) }, item.id)), jsx(Pagination, { total: data?.total, page: data?.page, hasMore: data?.has_more, onPrevious: () => setPage((current) => Math.max(1, current - 1)), onNext: () => setPage((current) => current + 1) })
      ]
    })
  })
}
