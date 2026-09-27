import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function ResourcesPage({ useApi, mutateApi, host, Page, Loading, ErrorState, Empty, Card, ListRow, Badge, css, artifactIcon, Pagination }) {
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
  const items = data?.items || []
  const chooseFolder = (id) => { setFolderId(id); setPage(1) }
  const toggleFavorite = async (item) => {
    try { await mutateApi(`/library/favorites/${encodeURIComponent(item.id)}`, item.favorite ? 'DELETE' : 'POST'); host.toast?.(item.favorite ? 'Removido dos favoritos.' : 'Adicionado aos favoritos.', 'success') }
    catch (e) { host.toast?.(String(e?.message || e), 'error') }
  }
  const useResource = async (item) => {
    try { await mutateApi(`/sessions/${todayData.session_id}/resources/${encodeURIComponent(item.id)}`, 'POST'); host.toast?.('Uso registrado na sessão.', 'success') }
    catch (e) { host.toast?.(String(e?.message || e), 'error') }
  }
  return jsx(Page, {
    label: 'Biblioteca organizada', title: 'Recursos e fontes', subtitle: 'Recursos por matéria, com busca e paginação.',
    children: isLoading ? jsx(Loading, { label: 'biblioteca' }) : error ? jsx(ErrorState, { label: 'biblioteca', error }) : jsxs('div', { style: { display: 'grid', gap: 16 }, children: [
      jsx(Card, { title: 'Pastas e filtros', icon: 'folder', children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [
        jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 180px', gap: 10 }, children: [
          jsx('input', { className: 'gnos-select', value: query, placeholder: 'Buscar recursos...', onChange: (e) => { setQuery(e.target.value); setPage(1) } }),
          jsx('select', { className: 'gnos-select', value: kind, onChange: (e) => { setKind(e.target.value); setPage(1) }, children: [jsx('option', { value: 'all', children: 'Todos os tipos' }), jsx('option', { value: 'source', children: 'Fontes' }), jsx('option', { value: 'resource', children: 'Recursos' })] })
        ] }),
        jsx('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [
          jsx('button', { type: 'button', className: 'gnos-action', style: folderId ? css.ghost : css.button, onClick: () => chooseFolder(null), children: 'Todas' }),
          ...folders.map((folder) => jsx('button', { type: 'button', className: 'gnos-action', style: folder.id === folderId ? css.button : css.ghost, onClick: () => chooseFolder(folder.id), children: `${folder.title} (${folder.count})` }, folder.id))
        ] })
      ] }) }),
      jsx(Card, { title: 'Conteúdo', icon: 'references', children: !items.length ? jsx(Empty, { label: 'itens nesta pasta' }) : jsxs('div', { children: [
        ...items.map((item) => jsx(ListRow, { icon: item.kind === 'source' ? 'link-external' : (artifactIcon[item.type] || 'file-text'), title: item.title, detail: item.detail || item.provenance || '', action: jsxs('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [
          jsx('button', { type: 'button', className: 'gnos-action', style: css.ghost, onClick: () => toggleFavorite(item), children: item.favorite ? '★' : '☆' }),
          todayData?.session_id && item.kind === 'resource' ? jsx('button', { type: 'button', className: 'gnos-action', style: css.ghost, onClick: () => useResource(item), children: 'Usar' }) : null,
          item.url ? jsx('a', { href: item.url, target: '_blank', rel: 'noreferrer', style: { ...css.ghost, textDecoration: 'none' }, children: 'Abrir' }) : jsx(Badge, { state: 'planned', children: 'Sem link' })
        ] }) }, item.id)),
        jsx(Pagination, { total: data?.total, page: data?.page, hasMore: data?.has_more, onPrevious: () => setPage((n) => Math.max(1, n - 1)), onNext: () => setPage((n) => n + 1) })
      ] }) })
    ] })
  })
}
