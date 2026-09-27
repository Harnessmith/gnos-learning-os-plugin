import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function TracksPage({ useApi, mutateApi, host, BASE, Page, Loading, ErrorState, Empty, Card, Badge, Navigate, css }) {
  const { data, isLoading, error } = useApi('/tracks', ['tracks'])
  const { data: coursesData } = useApi('/courses', ['courses'])
  const tracks = data?.tracks || []
  const courses = coursesData?.courses || []
  const [openCourseId, setOpenCourseId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({})
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const courseIdForTrack = (trackId) => trackId?.startsWith('track-course-') ? trackId.slice('track-course-'.length) : null
  const beginEdit = (track) => { setEditingId(track.id); setDraft({ title: track.title, stage: track.stage, status: track.status, detail: track.detail || '' }) }
  const saveTrack = async () => {
    if (!draft.title?.trim()) return
    setBusy(true)
    try { await mutateApi(editingId ? `/tracks/${editingId}` : '/tracks', editingId ? 'PATCH' : 'POST', { ...draft, title: draft.title.trim() }); host.toast?.(editingId ? 'Trilha atualizada.' : 'Trilha criada.', 'success'); setEditingId(null); setCreating(false) } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const removeTrack = async (track) => {
    if (!window.confirm(`Apagar a trilha “${track.title}”? As sessões ficarão sem trilha, mas o histórico não será apagado.`)) return
    setBusy(true)
    try { await mutateApi(`/tracks/${track.id}`, 'DELETE'); host.toast?.('Trilha apagada.', 'success') } catch (actionError) { host.toast?.(String(actionError?.message || actionError), 'error') } finally { setBusy(false) }
  }
  const editor = (title) => jsx(Card, { title, icon: 'edit', children: jsxs('div', { style: { display: 'grid', gap: 10 }, children: [
    jsx('input', { className: 'gnos-select', value: draft.title || '', placeholder: 'Nome da trilha', onChange: (event) => setDraft({ ...draft, title: event.target.value }) }),
    jsxs('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }, children: [jsx('input', { className: 'gnos-select', value: draft.stage || '', placeholder: 'Estágio', onChange: (event) => setDraft({ ...draft, stage: event.target.value }) }), jsx('select', { className: 'gnos-select', value: draft.status || 'unknown', onChange: (event) => setDraft({ ...draft, status: event.target.value }), children: ['unknown', 'exposed', 'practicing', 'demonstrated', 'retained', 'repair-needed'].map((status) => jsx('option', { value: status, children: status }, status)) })] }),
    jsx('textarea', { className: 'gnos-select', value: draft.detail || '', placeholder: 'Descrição ou próximo objetivo', rows: 3, onChange: (event) => setDraft({ ...draft, detail: event.target.value }) }),
    jsxs('div', { style: { display: 'flex', gap: 8 }, children: [jsx(Navigate, { primary: true, onClick: saveTrack, children: busy ? 'Salvando…' : 'Salvar' }), jsx(Navigate, { onClick: () => { setEditingId(null); setCreating(false) }, children: 'Cancelar' })] })
  ] }) })
  return jsx(Page, { label: 'Áreas instaladas', title: 'Trilhas por competência', actions: jsx(Navigate, { primary: true, icon: 'add', onClick: () => { setCreating(true); setEditingId(null); setDraft({ title: '', stage: 'Em planejamento', status: 'unknown', detail: '' }) }, children: 'Nova trilha' }), subtitle: 'Edite a organização dos estudos sem perder as evidências e o histórico das sessões.', children: isLoading ? jsx(Loading, { label: 'trilhas' }) : error ? jsx(ErrorState, { label: 'trilhas', error }) : jsxs('div', { style: { display: 'grid', gap: 20 }, children: [
    creating && editor('Nova trilha'),
    !tracks.length && !creating ? jsx(Empty, { label: 'trilhas' }) : jsx('div', { style: css.grid, children: tracks.map((t) => {
      const courseId = courseIdForTrack(t.id)
      const hasCourse = courseId && courses.some((c) => c.id === courseId)
      return jsx(Card, { title: t.title, icon: 'library', children: editingId === t.id ? editor(`Editar · ${t.title}`) : jsxs('div', { children: [jsx('div', { style: { color: 'var(--muted-foreground)', marginBottom: 12, fontSize: 13 }, children: t.stage }), jsx(Badge, { state: t.status, children: t.status }), jsx('p', { style: { marginBottom: 0, marginTop: 12, color: 'var(--muted-foreground)', fontSize: 13, lineHeight: 1.5 }, children: t.detail }), jsxs('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }, children: [t.source_type === 'user' && jsx(Navigate, { icon: 'edit', onClick: () => beginEdit(t), children: 'Editar' }), t.source_type === 'user' && jsx(Navigate, { icon: 'trash', onClick: () => removeTrack(t), children: 'Apagar' }), t.source_type !== 'user' && jsx(Badge, { state: 'planned', children: `Origem: ${t.source_type}` }), hasCourse && jsx(Navigate, { icon: 'list-tree', onClick: () => setOpenCourseId(openCourseId === courseId ? null : courseId), children: openCourseId === courseId ? 'Fechar curso' : 'Ver curso, módulos e aulas' })] })] }) }, t.id)
    }) }),
    openCourseId && jsx(CourseExplorer, { courseId: openCourseId, onClose: () => setOpenCourseId(null) })
  ] })
}


const artifactIcon = { video: 'device-camera-video', diagram: 'type-hierarchy', simulation: 'pulse', pdf: 'file-pdf', image: 'file-media', document: 'file-text' }

// Only real http(s) URLs are safe to hand to host.openExternal from a
// possibly-remote gateway: a `location.path` is a server-local filesystem
// path (same class of bug as the old openPortal) and would silently fail to
// open on the user's machine, so it deliberately does NOT synthesize a
// file:// URL — an artifact with only a local path has no external action
// until it's served through the plugin API like the lesson portal is.
function artifactHref(location) {
  if (!location) return null
  if (location.url && /^https?:\/\//i.test(location.url)) return location.url
  return null
}

function CourseExplorer({ courseId, onClose }) {
  const { data, isLoading, error } = useApi(`/courses/${courseId}`, ['course', courseId])
  const [openTopic, setOpenTopic] = useState(null)
  const [openLesson, setOpenLesson] = useState(null)
  const [portalOpen, setPortalOpen] = useState(false)
  const [portalLesson, setPortalLesson] = useState(null)
  if (isLoading) return jsx(Card, { title: 'Carregando curso…', children: jsx(Loading, { label: 'curso' }) })
  if (error) return jsx(Card, { title: 'Curso', children: jsx(ErrorState, { label: 'curso', error }) })
  const course = data
  const chapters = course?.chapters || []
  const lessons = course?.lessons || []
  const artifacts = course?.artifacts || []
  const lessonsByTopic = (topicId) => lessons.filter((l) => l.topic_id === topicId)
  const artifactsByLesson = (lessonId) => artifacts.filter((a) => a.lesson_id === lessonId)
  const artifactsByTopic = (topicId) => artifacts.filter((a) => a.topic_id === topicId && !a.lesson_id)
  const sources = Object.entries(course?.sources || {})
  return jsxs('div', {
    style: { display: 'grid', gap: 16 },
    children: [
      jsx(Card, {
        title: `Ementa — ${course?.title || courseId}`, icon: 'book',
        children: jsxs('div', {
          style: { display: 'grid', gap: 10 },
          children: [
            jsxs('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--muted-foreground)', fontSize: 13 }, children: [
              course?.length && jsxs('span', { children: ['◷ ', course.length] }),
              course?.depth && jsxs('span', { children: ['◉ profundidade: ', course.depth] }),
              jsxs('span', { children: [chapters.length, ' capítulo(s) · ', lessons.length, ' aula(s) · ', artifacts.length, ' recurso(s)'] })
            ] }),
            course?.goal && jsxs('p', { style: { margin: 0, lineHeight: 1.6, fontSize: 14 }, children: [jsx('strong', { children: 'Objetivo: ' }), course.goal] }),
            course?.vision && jsxs('p', { style: { margin: 0, lineHeight: 1.6, fontSize: 14, color: 'var(--muted-foreground)' }, children: [jsx('strong', { children: 'Visão: ' }), course.vision] }),
            sources.length > 0 && jsxs('div', {
              children: [
                jsx('div', { style: { fontWeight: 650, fontSize: 13, marginTop: 6, marginBottom: 6 }, children: 'Fontes / referências' }),
                sources.map(([sid, s]) => jsx(ListRow, { icon: 'link-external', title: s.title || sid, detail: s.verification_notes || s.type }, sid))
              ]
            }),
            jsx(Navigate, { onClick: onClose, icon: 'x', children: 'Fechar' })
          ]
        })
      }),
      jsx(Card, {
        title: 'Capítulos e módulos', icon: 'list-tree',
        children: !chapters.length ? jsx(Empty, { label: 'capítulos' }) : jsx('div', {
          style: { display: 'grid', gap: 14 },
          children: chapters.map((chapter) => jsxs('div', {
            style: { border: '1px solid var(--border)', borderRadius: 12, padding: 14 },
            children: [
              jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }, children: [
                jsx('span', { className: 'codicon codicon-folder', style: { fontSize: 14, color: 'var(--accent-2)' } }),
                jsx('strong', { style: { fontSize: 15 }, children: chapter.title }),
                jsx(Badge, { state: chapter.state === 'current' ? 'in_progress' : 'planned', children: chapter.state || 'planejado' })
              ] }),
              (chapter.topics || []).map((topic) => {
                const topicLessons = lessonsByTopic(topic.id)
                const topicArtifacts = artifactsByTopic(topic.id)
                const isOpen = openTopic === topic.id
                return jsxs('div', {
                  style: { marginLeft: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)', marginBottom: 10 },
                  children: [
                    jsxs('button', {
                      type: 'button', className: 'gnos-action', onClick: () => setOpenTopic(isOpen ? null : topic.id),
                      style: { background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--foreground)', textAlign: 'left', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 8, width: '100%' },
                      children: [
                        jsx('span', { className: `codicon codicon-chevron-${isOpen ? 'down' : 'right'}`, style: { fontSize: 12 } }),
                        jsx('span', { style: { fontWeight: 600, fontSize: 14 }, children: topic.title }),
                        jsx('span', { style: { color: 'var(--muted-foreground)', fontSize: 12 }, children: `${topicLessons.length} aula(s) · ${topic.minutes || '—'} min` })
                      ]
                    }),
                    isOpen && jsxs('div', {
                      style: { marginLeft: 20, display: 'grid', gap: 10, marginTop: 6 },
                      children: [
                        (topic.subtopics || []).length > 0 && jsx('ul', {
                          style: { margin: 0, paddingLeft: 18, color: 'var(--muted-foreground)', fontSize: 13 },
                          children: topic.subtopics.map((s, i) => jsx('li', { children: s }, i))
                        }),
                        !topicLessons.length && jsx(Empty, { label: 'aulas neste tópico' }),
                        topicLessons.map((lesson) => {
                          const lessonOpen = openLesson === lesson.id
                          const lessonArtifacts = artifactsByLesson(lesson.id)
                          return jsxs('div', {
                            style: { border: '1px solid var(--border)', borderRadius: 10, padding: 12 },
                            children: [
                              jsxs('button', {
                                type: 'button', onClick: () => setOpenLesson(lessonOpen ? null : lesson.id),
                                style: { background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--foreground)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, width: '100%' },
                                children: [
                                  jsx('span', { className: `codicon codicon-chevron-${lessonOpen ? 'down' : 'right'}`, style: { fontSize: 12 } }),
                                  jsx('span', { className: 'codicon codicon-book', style: { fontSize: 13, color: 'var(--accent-2)' } }),
                                  jsx('span', { style: { fontWeight: 600, fontSize: 13.5 }, children: lesson.title }),
                                  jsx(Badge, { state: lesson.publication === 'ready' ? 'demonstrated' : 'unknown', children: lesson.publication })
                                ]
                              }),
                              lessonOpen && jsxs('div', {
                                style: { marginTop: 10, display: 'grid', gap: 10 },
                                children: [
                                  lesson.purpose && jsx('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--muted-foreground)' }, children: lesson.purpose }),
                                  jsx('div', {
                                    style: { fontWeight: 620, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted-foreground)' },
                                    children: `Blocos (${(lesson.blocks || []).length})`
                                  }),
                                  (lesson.blocks || []).map(([label, body], i) => jsx(ListRow, { icon: blockIcon[label] || 'book', title: label, detail: (body || '').slice(0, 140) }, i)),
                                  (lesson.exercises || []).length > 0 && jsxs('div', {
                                    children: [
                                      jsx('div', { style: { fontWeight: 620, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted-foreground)', marginTop: 4 }, children: `Exercícios (${lesson.exercises.length})` }),
                                      lesson.exercises.map((ex) => jsx(ListRow, { icon: 'checklist', title: ex.prompt?.slice(0, 120) || ex.id, detail: (ex.success_criteria || []).join(' · ') }, ex.id))
                                    ]
                                  }),
                                  lessonArtifacts.length > 0 && jsxs('div', {
                                    children: [
                                      jsx('div', { style: { fontWeight: 620, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted-foreground)', marginTop: 4 }, children: `Vídeos e mídia (${lessonArtifacts.length})` }),
                                      lessonArtifacts.map((a) => jsx(ListRow, {
                                        icon: artifactIcon[a.type] || 'file',
                                        title: a.title,
                                        detail: a.purpose,
                                        action: artifactHref(a.location) && jsx(Navigate, { onClick: () => host.openExternal?.(artifactHref(a.location)), icon: 'link-external', children: 'Abrir' })
                                      }, a.id))
                                    ]
                                  }),
                                  lesson.portal_path && jsx(Navigate, { primary: true, icon: 'link-external', onClick: () => { setPortalLesson(lesson); setPortalOpen(true) }, children: 'Ver aula completa (com diagramas e código)' })
                                ]
                              })
                            ]
                          }, lesson.id)
                        }),
                        topicArtifacts.length > 0 && topicArtifacts.map((a) => jsx(ListRow, {
                          icon: artifactIcon[a.type] || 'file',
                          title: a.title,
                          detail: a.purpose,
                          action: artifactHref(a.location) && jsx(Navigate, { onClick: () => host.openExternal?.(artifactHref(a.location)), icon: 'link-external', children: 'Abrir' })
                        }, a.id))
                      ]
                    })
                  ]
                }, topic.id)
              })
            ]
          }, chapter.id))
        })
      }),
      portalOpen && jsx(PortalDialog, {
        open: portalOpen,
        onOpenChange: setPortalOpen,
        title: portalLesson?.title,
        kind: 'course',
        ids: { courseId, lessonId: portalLesson?.id },
        useApi,
      })
    ]
  })
}
