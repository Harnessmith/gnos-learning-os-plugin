# PROMPT 03 — Profile GNOS Learning OS

Você é o Forge, atuando como arquiteto de agentes, engenharia educacional e sistemas de aprendizagem adaptativa.

## Missão

Evoluir o GNOS para um profile/harness de aprendizagem pessoal capaz de levar um aluno de um estado atual a uma competência-alvo real.

Use como base principal:
https://github.com/joaomatheuslf/Gnos

## Repositórios de referência

Estude padrões úteis de:
- https://github.com/GarethManning/education-agent-skills
- https://github.com/ChasClogston/teaching-course-generator
- https://github.com/tobyilee/course-builder
- https://github.com/fenago/LearnGraph
- https://github.com/ghdkim/tutor-agent

Não copiar repositórios inteiros. GNOS permanece soberano como núcleo pedagógico.
Verifique licenças antes de reutilizar código.

## Antes de alterar

1. Ler README, AGENTS.md, skills, teachers, references e tests do GNOS.
2. Mapear arquitetura existente.
3. Rodar testes.
4. Preservar comportamento válido.
5. Preferir novas skills desacopladas.

## Exemplo de objetivo

O usuário deve poder dizer:

“Quero sair do zero e atingir DevOps Júnior → Pleno.”

O sistema deve pesquisar o destino, diagnosticar o aluno e construir uma rota adaptativa.

## PRINCÍPIO 80/20 — OBRIGATÓRIO

Toda formação segue 80/20.

Não tentar ensinar tudo sobre uma área.
Priorizar conhecimentos/competências que mais aumentam a capacidade prática para o objetivo.

Considere fatores como:
- relevance_to_goal;
- frequency_of_use;
- prerequisite_power;
- practical_value;
- transfer_value;
- failure_cost.

Conteúdo de baixo impacto fica para depois, a menos que o objetivo exija.

## ÁREAS MODULARES

Domínios devem ser plugins/módulos adicionáveis e removíveis.

Exemplo:

domains/
├── devops/
├── aws/
├── english/
├── law/
└── artificial-intelligence/

Cada domínio pode possuir subáreas arbitrariamente profundas.

Um domínio deve poder declarar:
- ontology;
- subdomains;
- concepts;
- prerequisites;
- competencies;
- common misconceptions;
- useful representations;
- assessment types;
- trusted sources;
- labs;
- teachers/SOUL;
- domain-specific epistemic rules.

Remover/desabilitar domínio não deve apagar automaticamente o histórico do aluno.

## PRESERVAR PEDAGOGIA DO GNOS

Manter especialmente:
- começar por problema/pergunta/caso concreto;
- desenvolver ideia antes da definição compacta;
- localizar a transição difícil;
- manter um caso contínuo;
- não assumir conhecimento sem evidência;
- teacher SOUL;
- subject guidance;
- course.json vivo;
- lesson.json;
- blocks;
- exercises;
- múltiplas representações;
- workers por bloco;
- design receipt;
- quality gate;
- learner evidence;
- adaptação do plano.

## MODELO DE EVIDÊNCIA

Preservar distinções do GNOS:
- exposed;
- practicing;
- demonstrated;
- retained.

Nunca tratar:
- viu = aprendeu;
- acertou com dica = acertou sozinho;
- acertou hoje = reteve;
- completou curso = mastery.

Tentativa deve registrar no mínimo:
- result: correct | partial | incorrect;
- help: none | hint | worked-example;
- kind: application | retrieval | transfer;
- interpretation;
- next_step.

## NOVAS SKILLS

Avaliar/implementar como skills separadas:
- goal-researcher;
- competency-mapper;
- learning-scheduler;
- resource-finder;
- resource-evaluator;
- lab-sandbox;
- assessment-engine;
- correction-engine;
- review-engine.

Não criar skill duplicando responsabilidade já bem resolvida pelo GNOS.

## GOAL RESEARCHER

Para objetivos profissionais/atuais, pesquisar antes de planejar.

Investigar quando relevante:
- vagas atuais;
- responsabilidades recorrentes;
- documentação oficial;
- roadmaps reconhecidos;
- syllabi/cursos;
- livros;
- práticas atuais;
- certificações quando úteis.

Registrar fontes verificadas e o papel de cada fonte.

## COMPETENCY MAPPER

Converter tópicos em capacidades observáveis.

Evitar apenas:
“Docker”

Preferir:
- construir imagem;
- escrever Dockerfile;
- configurar volumes;
- configurar networking;
- diagnosticar falhas;
- interpretar logs;
- justificar decisões.

Representar pré-requisitos e dependências.

## LEARNING SCHEDULER

Criar cronograma com datas reais.

Guardar:
- planned timeline;
- actual timeline.

Sessões podem ser:
- lesson;
- lab;
- review;
- retrieval;
- checkpoint;
- exam;
- project;
- challenge.

Se avaliação indicar lacuna importante, inserir repair session e reagendar o restante sem apagar o plano original.

Se aluno demonstrar domínio antecipado, condensar/pular conteúdo redundante.

## RECURSOS EXTERNOS

Antes de aulas/módulos quando útil, pesquisar:
- documentação oficial;
- artigos;
- vídeos;
- livros;
- papers;
- labs.

Selecionar poucos recursos de alta qualidade.

Para vídeos, quando possível avaliar:
- data;
- autor;
- transcrição;
- capítulos;
- nível;
- aderência à versão atual;
- trecho realmente útil.

Pode recomendar apenas um intervalo do vídeo.

## REPRESENTAÇÕES

Preservar regra GNOS de múltiplas formas.

Usar quando pedagogicamente útil:
- texto;
- código;
- equação;
- tabela;
- imagem;
- Excalidraw;
- Pinepaper;
- gráfico;
- animação;
- Manim;
- HTML simulation;
- documento/fonte;
- PDF.

Cada forma precisa ter função pedagógica.

Regras:
- animação só quando mudança for parte da ideia;
- diagrama para estrutura/relação;
- simulação quando manipular parâmetro ajuda a entender;
- pedir previsão antes da simulação;
- pedir interpretação depois;
- manter continuidade entre formas.

## LAB SANDBOX

Áreas práticas precisam de execução real.

Exemplo DevOps:
- Linux;
- shell;
- Git;
- Docker;
- Compose;
- networking;
- CI/CD;
- Terraform;
- Kubernetes;
- observability.

Lab deve ter contrato:
- objective;
- environment;
- initial_state;
- allowed_tools;
- task;
- expected_behavior;
- deterministic_checks;
- cleanup/reset.

Preferir:
MACHINE CHECK + LLM PEDAGOGICAL INTERPRETATION.

Nunca executar lab perigoso sem isolamento.

## ASSESSMENT ENGINE

Suportar:
- diagnostic;
- exercise;
- quiz;
- checkpoint;
- exam;
- lab;
- project;
- challenge;
- oral assessment;
- transfer assessment;
- delayed retrieval.

Tipos de tarefa:
- recall;
- explain;
- predict;
- compare;
- classify;
- apply;
- debug;
- design;
- implement;
- investigate;
- teach-back;
- transfer.

Gerar avaliações a partir de conceitos, competências, evidências e misconceptions, não apenas “N questões sobre assunto X”.

## CORRECTION ENGINE

Correção deve produzir:
- resultado;
- o que estava correto;
- o que faltou;
- interpretação do erro;
- misconception ou prerequisite gap se houver;
- por que importa;
- próxima intervenção/teste.

## HINTS

Usar escada de ajuda quando apropriado:
1. sinalizar inconsistência;
2. pergunta direcionadora;
3. pista mínima;
4. pista estrutural;
5. exemplo semelhante;
6. worked example;
7. solução.

Se o aluno pedir explicitamente a resposta, não transformar ajuda em punição.

## REVIEW ENGINE

Após sessão/avaliação decidir:
- advance;
- practice;
- repair;
- review;
- repeat;
- challenge.

Basear decisão em evidência.

Exemplo conceitual:
- incorrect → repair;
- correct with worked-example → practice;
- correct with hint → unassisted retry;
- correct unassisted → demonstrated;
- later retrieval/transfer success → retained.

## PROJETOS

Cursos profissionais devem possuir projetos integradores.

Exemplo DevOps:
- Git + Docker + deployment;
- CI/CD + cloud + observability;
- Terraform + networking + compute;
- capstone com requisitos reais.

Projetos devem gerar evidências para múltiplas competências.

## CRONOLOGIA

Toda sessão deve manter data e histórico.

O sistema deve saber:
- o que estava previsto;
- o que foi realmente ensinado;
- por que o plano mudou;
- resultado da avaliação;
- próxima sessão.

A cronologia é parte do produto, não metadado opcional.

## ENTREGÁVEIS

- arquitetura atualizada;
- novas skills;
- contratos/schemas;
- domínio de exemplo `devops`;
- cronograma de exemplo;
- labs de exemplo;
- avaliações de exemplo;
- testes;
- documentação de migração;
- compatibilidade com GNOS existente sempre que razoável.
