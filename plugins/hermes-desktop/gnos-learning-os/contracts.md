# Contratos de interface — GNOS Plugin V1

**Versão:** `v1`  
**Fronteira:** `UI → LearningGateway → futura API do plugin → profile GNOS`

A UI usa exclusivamente o gateway abaixo. Nenhuma página lê estado do profile, arquivos de curso ou executa comandos.

## Leituras

| Método do gateway | Contrato futuro |
|---|---|
| `getToday()` | `GET /v1/today` |
| `getTracks()` | `GET /v1/tracks` |
| `getTimeline()` | `GET /v1/timeline?view=planned\|actual` |
| `getLesson(id)` | `GET /v1/sessions/:id` |
| `getAssessments()` | `GET /v1/assessments` |
| `getProgress()` | `GET /v1/evidence` |
| `getResources()` | `GET /v1/resources` |
| `getProjects()` | `GET /v1/projects` |
| `getLab(id)` | `GET /v1/labs/:id` |

## Escritas planejadas

| Ação | Contrato futuro | Regra de segurança |
|---|---|---|
| iniciar/concluir sessão | `POST /v1/sessions/:id/start\|complete` | API registra evento; UI não altera evidência diretamente. |
| iniciar/verificar/resetar lab | `POST /v1/labs/:id/start\|check\|reset` | Execução apenas em runner isolado; nunca shell no renderer. |
| enviar avaliação | `POST /v1/assessments/:id/submit` | Resposta validada e idempotente por `attempt_id`. |

## Modelos mínimos

- `Track { id, title, stage, competencies[] }`
- `Session { id, kind, topic, plannedDate, objective, durationMinutes, status }`
- `TimelineEntry { id, source: planned|actual, sessionId, adaptiveReason? }`
- `Assessment { id, type, competencyResults[], helpUsed, evidenceCount }`
- `Evidence { id, competencyId, status, attempts, misconceptions[], nextIntervention }`
- `Lab { id, objective, sandboxStatus, allowedTools[], deterministicCheck }`

Estados válidos de competência: `unknown`, `exposed`, `practicing`, `demonstrated`, `retained`, `repair-needed`.

## Compatibilidade

O backend posterior deve manter esta fronteira e versionar qualquer mudança incompatível para `/v2`. `planned` e `actual` são cronologias distintas: replanejar nunca reescreve o plano original.
