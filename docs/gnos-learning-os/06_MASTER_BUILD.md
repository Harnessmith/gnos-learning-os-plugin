# PROMPT MESTRE — Construir GNOS Learning OS + Hermes Desktop Plugin

Você é o Forge. Execute este trabalho como um projeto de engenharia completo, em etapas, preservando o que já funciona e validando cada fase antes de avançar.

## Objetivo

Construir um sistema pessoal de aprendizagem chamado provisoriamente **GNOS Learning OS**, baseado no GNOS e integrado ao Hermes Desktop.

O usuário deve poder dizer, por exemplo:

“Quero sair do zero e chegar a DevOps Júnior → Pleno.”

O sistema deve:
- pesquisar o objetivo;
- mapear competências;
- aplicar 80/20;
- diagnosticar o aluno;
- criar currículo;
- criar cronograma datado;
- ensinar;
- pesquisar bons recursos externos;
- usar visuais quando ajudam;
- criar exercícios;
- criar labs executáveis;
- corrigir;
- registrar evidências;
- decidir avançar/revisar/remediar;
- reagendar;
- testar retenção;
- manter histórico completo.

## Base principal

https://github.com/joaomatheuslf/Gnos

## Referências

- https://github.com/GarethManning/education-agent-skills
- https://github.com/ChasClogston/teaching-course-generator
- https://github.com/tobyilee/course-builder
- https://github.com/fenago/LearnGraph
- https://github.com/ghdkim/tutor-agent

GNOS é o núcleo pedagógico. Não fazer Frankenstein.

## Estratégia de implementação

### Fase 1 — Desktop Plugin

Criar plugin nativo do Hermes Desktop com:
- Hoje;
- Trilhas;
- Cronograma;
- Aula;
- Labs;
- Avaliações;
- Progresso;
- Recursos;
- Projetos.

Começar com mocks e contratos claros.

### Fase 2 — Backend do Plugin

Implementar:
- APIs/RPC;
- persistência;
- timeline;
- session state;
- evidence views;
- lab abstraction;
- realtime events.

Não colocar regras pedagógicas no frontend.

### Fase 3 — GNOS Learning Profile

Preservar GNOS e adicionar skills complementares:
- goal-researcher;
- competency-mapper;
- learning-scheduler;
- resource-finder;
- resource-evaluator;
- lab-sandbox;
- assessment-engine;
- correction-engine;
- review-engine.

### Fase 4 — Integração

PLUGIN ↔ CONTRACT/API ↔ PROFILE

UI não conhece pedagogia interna.
Profile não conhece UI.

### Fase 5 — Hardening

Adicionar testes de contrato, timeline, evidence, sandbox, adaptação e E2E.

## Regra 80/20

Ensinar primeiro o conjunto mínimo de alto impacto necessário para gerar capacidade prática.

Priorizar:
- fundamentos;
- alta frequência de uso;
- pré-requisitos que desbloqueiam muita coisa;
- prática real;
- troubleshooting;
- transferência.

Postergar detalhes raros enquanto não forem necessários.

## Pedagogia GNOS

Preservar:
problema concreto
→ raciocínio
→ explicação
→ formalização
→ segunda representação
→ prática
→ aplicação independente
→ avaliação
→ evidência
→ adaptação.

Estados de evidência:
- exposed;
- practicing;
- demonstrated;
- retained.

Nunca fabricar mastery.

## Cronograma

Manter planejado e real separados.

Exemplo:

PLANEJADO
02/10 Networking
05/10 Git
07/10 Docker

REAL
02/10 Networking
05/10 Networking Repair
07/10 Git

Toda mudança precisa de razão registrável.

## Labs

Para áreas práticas, criar sandbox executável e descartável.

Arquitetura preferida:
plugin backend
→ isolated runner
→ Docker/namespace/VM

Usar deterministic checks + interpretação pedagógica.

## Recursos

Pesquisar materiais atuais quando necessário.
Selecionar poucos recursos úteis.
Vídeos podem ser recomendados por trecho, quando isso for melhor do que produzir conteúdo do zero.

## Áreas

Domínios são módulos instaláveis/removíveis e podem conter subáreas arbitrariamente profundas.

Exemplo:
DevOps → Containers → Docker → Networking.

## Entrega

Não pare apenas em arquitetura/documentação.
Produza implementação funcional incremental com commits claros, testes, README e demo E2E.

Antes de cada grande mudança:
- inspecione código existente;
- preserve interfaces válidas;
- explique trade-offs;
- evite dependências desnecessárias.

Ao final, demonstre:

Hoje
→ Aula
→ Exercício
→ Lab
→ Correção
→ Evidência
→ Review Decision
→ Replanejamento
→ Próxima sessão.
