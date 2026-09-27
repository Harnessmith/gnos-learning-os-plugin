# GNOS Learning OS — Plano de Consolidação e Evolução

> **Para o Forge:** executar por fases, com testes antes da implementação e validação real no Hermes Desktop.

**Objetivo:** consolidar o GNOS como um sistema pessoal de aprendizagem, corrigindo integridade de sincronização e transformando o mapa de competências, cronograma e conteúdo em um fluxo diário de estudo.

**Arquitetura:** manter um monólito modular: o Didaktos continua sendo a fonte do conteúdo publicado; o PostgreSQL mantém o estado de estudo, sessões, tentativas e histórico; o plugin Electron consome exclusivamente a API FastAPI. Não introduzir multiusuário nem microserviços.

**Stack:** Python/FastAPI, PostgreSQL, Pydantic, Hermes Desktop Plugin SDK, React runtime, portal HTML em iframe sandbox.

---

## 1. Estado atual

O sistema já possui:

- plugin Desktop funcional conectado via `ctx.rest`;
- API em `dashboard/plugin_api.py`;
- persistência PostgreSQL no schema `gnos_learning_os`;
- cursos, aulas, sessões, trilhas, timeline, evidências, recursos, assessments e labs;
- sincronização parcial em `dashboard/sync_evidence.py`;
- leitura de portais HTML via API autenticada;
- CRUD básico de trilhas;
- edição de sessões planejadas;
- mapa de competências, métricas e calendário;
- biblioteca hierárquica inicial com paginação;
- testes de contratos, sincronização, renderização e backend.

## 2. Problemas prioritários conhecidos

1. O sincronizador usa IDs como `track-{domain_id}`, enquanto algumas consultas procuram apenas `track-course-*` e `track-user-*`.
2. A sincronização cria entradas de timeline sem `session_id`, mas a leitura da timeline usa `JOIN` interno com `sessions`, ocultando essas entradas.
3. O schema é criado/verificado durante as requisições em vez de usar migrations versionadas.
4. Trilhas provenientes do Didaktos e trilhas editáveis pelo usuário estão misturadas.
5. Evidência representa apenas o estado atual; falta histórico de observações pedagógicas.
6. `plugin_api.py` e `plugin.js` concentram muitas responsabilidades em arquivos grandes.
7. A suíte ainda precisa de testes E2E reais das novas interações do Desktop.

Como o sistema terá somente um usuário, não será implementado `learner_id`, autorização multiusuário ou tenancy nesta fase.

---

# Fase 0 — Baseline e proteção

### Tarefa 0.1 — Registrar o estado inicial

**Arquivos:**
- `docs/plans/2026-09-27-gnos-learning-os-consolidacao.md`
- `planning/2026-09-25-gnos-learning-os/progress.md`

**Ações:**
- confirmar branch limpa;
- registrar commit base;
- rodar `py_compile` e `node --check`;
- rodar a suíte existente;
- registrar testes bloqueados por dependências ambientais.

**Verificação:** nenhuma alteração funcional antes de preservar o baseline.

### Tarefa 0.2 — Criar testes de regressão dos dois bugs de sincronização

**Testes:**
- `tests/test_sync_evidence.py`;
- novo `tests/test_plugin_integrity.py`.

**Casos:**
- trilha sincronizada aparece em `/tracks`, `/today` e `/timeline`;
- entrada de timeline sem sessão aparece na resposta da API.

**Verificação:** os testes devem falhar antes da correção e passar depois.

---

# Fase 1 — Corrigir identidade e timeline

### Tarefa 1.1 — Padronizar IDs de trilhas

**Arquivos:**
- `dashboard/sync_evidence.py`;
- `dashboard/plugin_api.py`;
- testes de sincronização.

**Decisão:** usar IDs semânticos consistentes:

```text
track-domain-<domain_id>
track-course-<course_id>
track-user-<uuid>
```

Atualizar sincronização, filtros, `/today`, `/tracks`, `/timeline` e consultas de sessões.

### Tarefa 1.2 — Adicionar `track_id` às entradas de timeline

**Arquivos:**
- `dashboard/plugin_api.py`;
- migration futura;
- `dashboard/sync_evidence.py`.

**Mudança:** `timeline_entries` deve poder pertencer diretamente a uma trilha, mesmo sem uma sessão.

```sql
ALTER TABLE gnos_learning_os.timeline_entries
ADD COLUMN IF NOT EXISTS track_id TEXT REFERENCES gnos_learning_os.tracks(id) ON DELETE SET NULL;
```

Atualizar inserções e consultas para usar `LEFT JOIN` quando necessário.

### Tarefa 1.3 — Corrigir máquina de estados das sessões

**Arquivos:**
- `dashboard/plugin_api.py`;
- novo teste de transições.

**Regras:**

```text
planned -> in_progress -> completed
planned -> completed: proibido
completed -> qualquer estado anterior: proibido
completed -> completed: idempotente ou 409, nunca duplicar evento
```

Validar duração, data e transições no backend.

### Tarefa 1.4 — Proteger trilhas de origem

**Arquivos:**
- `dashboard/plugin_api.py`;
- `desktop/plugin.js`.

**Mudança:** distinguir `source_type`:

```text
course
 domain
 user
```

Trilhas de curso/domínio não serão apagadas pelo botão comum. O usuário poderá editar apenas overrides locais ou trilhas criadas manualmente.

---

# Fase 2 — Migrations e persistência estável

### Tarefa 2.1 — Criar diretório de migrations

**Criar:**

```text
dashboard/db/migrations/001_initial_schema.sql
dashboard/db/migrations/002_timeline_track_id.sql
dashboard/db/migrations/003_track_source_metadata.sql
```

### Tarefa 2.2 — Criar controle de versão do schema

**Criar:**

```text
dashboard/db/migrate.py
```

A migration deve:

- criar tabela `schema_migrations`;
- aplicar apenas versões ausentes;
- executar dentro de transação;
- falhar de forma explícita;
- ser executável manualmente e no startup do gateway.

### Tarefa 2.3 — Retirar DDL das rotas

**Modificar:**
- `dashboard/plugin_api.py`.

`_ensure_seeded()` deixa de criar estrutura do banco em cada request. O startup executa migrations; as rotas apenas leem e gravam dados.

### Tarefa 2.4 — Verificar migração em banco real

**Comandos:**

```bash
python -m dashboard.db.migrate
python -m unittest tests/test_plugin_integrity.py -v
```

Verificar também que o gateway reinicia e que os dados existentes permanecem intactos.

---

# Fase 3 — Modelo pedagógico histórico

### Tarefa 3.1 — Criar tabela de observações

**Migration:**

```sql
CREATE TABLE competency_observations (
    id TEXT PRIMARY KEY,
    competency_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    outcome TEXT NOT NULL,
    help_used TEXT,
    notes TEXT,
    observed_at TEXT NOT NULL
);
```

### Tarefa 3.2 — Manter `evidence` como projeção atual

**Arquivos:**
- `dashboard/plugin_api.py`;
- `dashboard/sync_evidence.py`.

Cada nova evidência deve:

1. inserir uma observação append-only;
2. recalcular o estado atual;
3. atualizar a projeção `evidence`;
4. preservar o histórico anterior.

### Tarefa 3.3 — Expor histórico no mapa de competências

**API:**

```text
GET /evidence/{competency_id}/history
```

**UI:**
- linha do tempo;
- tentativas;
- erros;
- intervenção aplicada;
- evolução de status.

---

# Fase 4 — Planejador pessoal

### Tarefa 4.1 — Criar serviço de recomendação de próxima ação

**Criar:**

```text
dashboard/services/study_recommendations.py
```

Prioridade recomendada:

1. sessão atrasada;
2. competência `repair-needed`;
3. revisão vencida;
4. competência praticando sem avaliação recente;
5. próxima aula planejada;
6. conteúdo novo.

### Tarefa 4.2 — Criar endpoint de recomendação

```text
GET /study/next
```

Resposta:

```json
{
  "kind": "review|lesson|repair|assessment",
  "title": "...",
  "reason": "...",
  "route": "...",
  "competency_ids": []
}
```

### Tarefa 4.3 — Criar card “Próximo estudo”

**Modificar:**
- `desktop/plugin.js` ou componente extraído para `desktop/pages/Today.jsx`.

O card deve permitir iniciar diretamente a ação recomendada.

### Tarefa 4.4 — Implementar modo de sessão de estudo

**Funções:**
- iniciar sessão;
- timer;
- objetivo da sessão;
- anotações rápidas;
- concluir;
- registrar duração real;
- sugerir próximo passo.

---

# Fase 5 — Biblioteca e conteúdo

### Tarefa 5.1 — Normalizar pastas de recursos

**Migration:**

```text
resource_folders
resources.folder_id
```

Pastas devem representar curso/matéria e suportar subpastas.

### Tarefa 5.2 — Adicionar busca e filtros

```text
GET /library?q=&folder_id=&type=&page=&page_size=
```

Filtros:

- título;
- tipo;
- curso;
- matéria;
- aula relacionada;
- competência relacionada.

### Tarefa 5.3 — Adicionar favoritos e associação

**Funções:**
- favoritar recurso;
- vincular recurso a uma aula;
- vincular recurso a uma competência;
- abrir recurso em nova aba/portal;
- registrar recurso utilizado na sessão.

---

# Fase 6 — Modularização

### Tarefa 6.1 — Separar backend por domínio

**Criar:**

```text
dashboard/api/routes_tracks.py
dashboard/api/routes_sessions.py
dashboard/api/routes_timeline.py
dashboard/api/routes_evidence.py
dashboard/api/routes_library.py
dashboard/api/routes_courses.py
dashboard/services/
dashboard/repositories/
dashboard/schemas/
```

Manter `plugin_api.py` temporariamente como ponto de montagem para não quebrar o manifest do plugin.

### Tarefa 6.2 — Separar frontend por página

**Criar:**

```text
desktop/api/client.js
desktop/components/PortalDialog.jsx
desktop/components/RichText.jsx
desktop/components/Pagination.jsx
desktop/pages/Today.jsx
desktop/pages/Tracks.jsx
desktop/pages/Timeline.jsx
desktop/pages/Progress.jsx
desktop/pages/Resources.jsx
desktop/pages/Metrics.jsx
```

Migrar uma página por vez, mantendo `plugin.js` como entrypoint.

### Tarefa 6.3 — Substituir invalidação global

Atualizar as mutações para invalidar apenas os recursos relacionados:

```text
tracks mutation -> tracks, today
session mutation -> sessions, timeline, metrics, today
assessment mutation -> assessments, evidence, metrics
resource mutation -> library
```

---

# Fase 7 — QA e entrega

### Tarefa 7.1 — Testes backend

Cobrir:

- IDs sincronizados;
- timeline sem sessão;
- CRUD protegido de trilhas;
- estados de sessão;
- idempotência de assessments;
- histórico de evidências;
- recomendações;
- filtros e paginação.

### Tarefa 7.2 — Teste real do gateway

Verificar:

```text
health -> tracks -> today -> sessions -> portal -> start -> complete -> metrics
```

### Tarefa 7.3 — E2E Desktop

Cobrir:

- abrir trilha;
- abrir aula completa;
- criar/editar trilha manual;
- replanejar sessão futura;
- concluir sessão;
- abrir mapa de competência;
- abrir recurso paginado;
- iniciar próxima recomendação.

### Tarefa 7.4 — Validação final

Executar:

```bash
python -m compileall dashboard
node --check desktop/plugin.js
python -m unittest discover -s tests -v
hermes plugins doctor
systemctl restart hermes-gateway.service
```

Depois validar no Desktop com dados reais do workspace Didaktos.

---

# Resultado final esperado

Ao final, o GNOS será um sistema pessoal com:

- uma fonte clara para conteúdo e outra para progresso;
- sincronização idempotente e observável;
- cronograma sem dados desaparecendo;
- trilhas de curso protegidas contra edição destrutiva;
- trilhas manuais editáveis;
- histórico completo de evidências;
- mapa de competências explicável;
- recomendação diária de estudo;
- sessão de foco com tempo real e anotações;
- biblioteca pesquisável e hierárquica;
- avaliações registradas como evidências;
- métricas confiáveis;
- backend e frontend modularizados;
- testes de backend e E2E comprovando os fluxos principais.

## Critério de conclusão

A evolução só será considerada concluída quando:

1. uma aula publicada no Didaktos aparecer na trilha;
2. a sessão puder ser planejada, iniciada e concluída;
3. a conclusão gerar histórico e atualizar métricas;
4. uma resposta de exercício atualizar a competência;
5. o sistema recomendar a próxima ação;
6. recursos puderem ser encontrados por pasta e busca;
7. o fluxo completo funcionar no Hermes Desktop com dados reais;
8. a suíte automatizada passar sem regressões relevantes.
