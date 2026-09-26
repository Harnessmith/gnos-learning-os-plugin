# PROMPT 04 — Integração GNOS Plugin ↔ Profile

Você é o Forge. Existem agora dois componentes:

1. GNOS Desktop Plugin + backend do plugin.
2. GNOS Learning OS profile/harness.

## Missão

Integrar os dois mantendo acoplamento mínimo.

## Princípio

PLUGIN
não conhece pedagogia interna.

PROFILE
não conhece UI.

PLUGIN ↔ CONTRACT/API ↔ PROFILE

## Objetivos

Criar adapters para que o plugin consiga consultar e acionar o GNOS sem acessar diretamente estruturas internas instáveis.

O plugin deve conseguir:
- obter sessão de hoje;
- listar trilhas;
- ler status de conceitos/competências;
- ler cronograma planejado e real;
- iniciar sessão;
- enviar tentativa;
- iniciar/check/reset lab;
- receber correção;
- ler decisão advance/review/repair;
- listar recursos;
- listar projetos;
- receber eventos em tempo real.

## Fonte de verdade

Defina explicitamente qual componente é fonte de verdade para:
- learner state;
- curriculum/course plan;
- timeline;
- evidence;
- lab state;
- UI cache.

Evite duas cópias editáveis do mesmo estado.

## Idempotência e versões

Operações importantes devem possuir IDs estáveis/idempotentes.

Preservar fingerprints/revisions onde o GNOS já utiliza esse padrão.

Uma mudança de currículo precisa ser versionada e explicável.

## Timeline

Mapear o scheduler do profile para o dashboard:
- planned;
- actual;
- inserted repair/review sessions;
- rescheduled sessions;
- completed sessions.

Nunca esconder mudanças adaptativas.

## Evidência

UI deve exibir estado derivado, mas não editar manualmente evidência.

Tentativa precisa passar pelo pipeline do GNOS antes de virar evidência válida.

## Labs

Separar:
- UI terminal;
- backend plugin;
- isolated lab runner;
- GNOS pedagogical review.

Deterministic check não substitui interpretação pedagógica.

## Chat/Professor

Quando o usuário pergunta durante a aula, preservar contexto mínimo relevante:
- track/domain;
- session;
- concept;
- current lesson block;
- evidence relevante;
- current lab se houver.

Evitar despejar todo o histórico na janela de contexto.

## Falhas

Projetar comportamento para:
- profile indisponível;
- backend reiniciado;
- lab runner morto;
- curriculum fingerprint stale;
- sessão parcialmente concluída;
- tentativa duplicada;
- plugin atualizado antes do profile;
- profile atualizado antes do plugin.

## Entregáveis

- adapter layer;
- schemas versionados;
- integração end-to-end;
- migrações;
- testes de contrato;
- documentação de compatibilidade;
- demo completa:

Hoje → Aula → Exercício → Lab → Correção → Evidência → Replanejamento → Próxima sessão.
