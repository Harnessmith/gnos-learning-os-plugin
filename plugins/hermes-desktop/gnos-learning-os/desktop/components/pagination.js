import { jsx, jsxs } from 'react/jsx-runtime'

export function Pagination({ total, page, hasMore, onPrevious, onNext }) {
  return jsxs('div', {
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 14 },
    children: [
      jsx('small', { style: { color: 'var(--muted-foreground)' }, children: `${total || 0} item(ns) nesta pasta · página ${page || 1}` }),
      jsxs('div', {
        style: { display: 'flex', gap: 8 },
        children: [
          jsx('button', { type: 'button', className: 'gnos-nav', style: { padding: '6px 10px' }, disabled: page <= 1, onClick: onPrevious, children: '← Anterior' }),
          jsx('button', { type: 'button', className: 'gnos-nav', style: { padding: '6px 10px' }, disabled: !hasMore, onClick: onNext, children: 'Próxima →' }),
        ],
      }),
    ],
  })
}
