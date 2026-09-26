# PROMPT 02 — Backend do Plugin, Persistência e Contratos

Você é o Forge. Parta do GNOS Desktop Plugin V1 já existente.

## Missão

Transformar os mocks em uma arquitetura de backend local robusta para o plugin, mantendo a futura integração com o profile GNOS desacoplada.

## Princípio central

PLUGIN UI ↔ API/CONTRACT ↔ GNOS PROFILE

O frontend não deve ler/escrever diretamente arquivos pedagógicos.

## Objetivos

Implementar backend do plugin usando os mecanismos oficialmente suportados pelo Hermes Desktop/plugin SDK atual. Confirme primeiro a arquitetura disponível.

O backend deve oferecer serviços para:
- estado do dashboard;
- trilhas;
- cronograma;
- sessões;
- evidências;
- avaliações;
- recursos;
- projetos;
- labs;
- eventos em tempo real quando necessário.

## Contratos mínimos

Modele contratos equivalentes a:

GET /today
GET /tracks
GET /tracks/:id
GET /timeline
GET /sessions/:id
GET /assessments
GET /evidence
GET /resources
GET /projects

POST /sessions/:id/start
POST /sessions/:id/complete
POST /labs/:id/start
POST /labs/:id/check
POST /labs/:id/reset
POST /assessments/:id/submit

Não trate esta lista como dogma se o SDK oficial sugerir estrutura melhor.

## Modelos fundamentais

Definir esquemas para:
- Track
- Domain
- Subdomain
- Concept
- Competency
- Session
- TimelineEntry
- Assessment
- Attempt
- Evidence
- Resource
- Project
- Lab
- LabCheck
- ReviewDecision

## Cronologia

Preservar explicitamente:
- planned timeline;
- actual timeline.

Nunca sobrescrever o passado ao reagendar.

Sessão deve suportar:
- session_id;
- planned_date;
- actual_date;
- planned_topic;
- actual_topic;
- planned_duration;
- actual_duration;
- objectives;
- activities;
- assessment;
- evidence;
- decision;
- next_step.

## Persistência

Nesta etapa, implementar uma persistência local simples e segura.
Pode ser SQLite ou estrutura equivalente, desde que:
- seja fácil migrar;
- preserve histórico;
- permita transações;
- não acople à UI;
- possa receber dados do profile no futuro.

Não tente criar ainda toda a memória pedagógica do GNOS.

## Eventos

Suportar atualização em tempo real para:
- lab status;
- terminal output futuramente;
- session progress;
- assessment state;
- background operation state quando aplicável.

Use WebSocket/socket do SDK se oficialmente suportado.

## Lab Runner

Criar apenas a infraestrutura/abstração inicial.

Não execute comandos perigosos dentro do processo principal do Hermes.
Projete:

plugin backend
→ isolated lab runner
→ Docker/namespace/VM no futuro

Nesta fase, pode existir um mock runner ou runner restrito.

Definir contrato de lab:
- objective;
- environment;
- initial_state;
- allowed_tools;
- task;
- expected_behavior;
- deterministic_checks;
- cleanup/reset.

## Segurança

- não expor shell arbitrário sem isolamento;
- validar inputs;
- restringir caminhos;
- separar arquivos do plugin do workspace do aluno;
- não armazenar segredos em texto puro;
- não permitir que conteúdo de curso vire instrução operacional para o backend.

## Entregáveis

- backend funcional;
- persistência;
- contratos tipados;
- adapters mock → real;
- endpoints/RPCs documentados;
- camada inicial de lab runner;
- testes;
- migration strategy;
- documentação para o futuro profile GNOS integrar.
