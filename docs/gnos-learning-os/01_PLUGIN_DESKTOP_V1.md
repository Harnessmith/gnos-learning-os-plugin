# PROMPT 01 — GNOS Desktop Plugin V1

Você é o Forge, atuando como engenheiro sênior de produto, Electron/React, UX e integração com Hermes Desktop.

## Missão

Criar a V1 do **GNOS Learning Dashboard** como plugin do Hermes Desktop.

Nesta etapa, NÃO implemente ainda a inteligência pedagógica do GNOS. O objetivo é construir a interface, navegação, contratos e estados visuais com dados mockados realistas, deixando tudo preparado para o profile/backend futuro.

## Requisitos de arquitetura

1. O plugin é apenas interface e orquestração de UI.
2. Não colocar regras pedagógicas complexas no renderer.
3. Não acessar diretamente arquivos internos do GNOS a partir da UI.
4. Toda comunicação futura deve passar por contratos/API do plugin.
5. O plugin deve funcionar inicialmente com mocks intercambiáveis por uma implementação real.
6. Não modificar o core do Hermes Desktop se o SDK/plugin system permitir extensão sem fork.
7. Antes de implementar, inspecione a versão atual do Hermes Desktop e sua documentação/SDK no repositório oficial.
8. Não invente APIs do Hermes: confirme as APIs disponíveis.

## Produto

O dashboard deve representar um Learning OS pessoal.

### Páginas principais

- Hoje
- Trilhas
- Cronograma
- Aula
- Laboratórios
- Avaliações
- Progresso
- Recursos
- Projetos

### Página Hoje

Mostrar:
- data atual;
- trilha ativa;
- sessão de hoje;
- objetivo da sessão;
- duração planejada;
- revisão pendente;
- próxima sessão;
- CTA principal: `Continuar aprendendo`.

### Trilhas

Exibir áreas instaladas, por exemplo:
- DevOps
- AWS
- Inglês
- Direito

Cada trilha deve mostrar status por competências, não apenas percentual bruto.
Estados sugeridos:
- unknown
- exposed
- practicing
- demonstrated
- retained
- repair-needed

Permitir interface futura para:
- adicionar domínio;
- desabilitar domínio;
- remover domínio sem obrigatoriamente apagar histórico.

### Cronograma

Criar visualização datada com dois modos:
- Planejado
- Real

Uma sessão pode ser:
- lesson
- lab
- review
- retrieval
- checkpoint
- exam
- project
- challenge

Mostrar alterações adaptativas no cronograma sem apagar o plano original.

### Aula

Interface híbrida, não somente chat.

Suportar blocos visuais para:
- texto;
- código;
- equação;
- imagem;
- diagrama;
- animação;
- simulação;
- fonte/documento;
- exercício.

Incluir painel/ação `Perguntar ao professor` preservando contexto da sessão atual.

### Laboratório

Criar UI preparada para:
- enunciado;
- terminal;
- status do sandbox;
- executar checks;
- pedir pista;
- resetar;
- mostrar evidências/resultado.

Nesta V1, terminal e checks podem ser simulados.

### Avaliações

Mostrar:
- checkpoints;
- exams;
- labs avaliativos;
- projetos;
- resultados por competência;
- ajuda utilizada;
- evidências.

Evitar reduzir tudo a uma nota percentual.

### Progresso

Visualizar conhecimento/competências por árvore/grafo hierárquico:

DevOps
→ Containers
→ Docker
→ Networking

Permitir drill-down por conceito/competência e mostrar:
- status;
- evidências;
- tentativas;
- erros/misconceptions;
- próxima intervenção.

### Recursos

Mostrar poucos recursos selecionados para uma aula:
- documentação oficial;
- artigo;
- vídeo;
- paper;
- lab.

Preparar UI para trechos recomendados de vídeo.

### Projetos

Mostrar projetos integradores e quais competências eles exercitam.

## UX

- Aparência coerente com Hermes Desktop.
- Evitar estética genérica de dashboard SaaS.
- Priorizar leitura, foco e fluxo de estudo.
- CTA principal sempre deve responder: “o que estudo agora?”.
- Não adicionar gamificação infantil por padrão.
- Métricas úteis: sessões, horas, labs, evidências, retained, projetos.

## Dados mockados

Criar mocks suficientemente realistas para demonstrar:
- trilha DevOps Junior → Pleno;
- cronograma adaptado após uma dificuldade;
- aula de Docker Networking;
- lab com falha de DNS entre containers;
- checkpoint corrigido;
- revisão agendada.

## Contratos

Mesmo usando mocks, modele interfaces/types como se viessem de endpoints futuros, por exemplo:

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

Os nomes podem mudar se houver razão técnica forte, mas mantenha contratos claros.

## Entregáveis

- plugin instalável no Hermes Desktop;
- páginas navegáveis;
- mocks e adapters separados;
- tipos/contratos documentados;
- README de desenvolvimento;
- screenshots ou evidência equivalente de execução;
- testes do que for testável;
- nenhum acoplamento ao profile GNOS ainda.

## Critério de sucesso

Ao abrir o plugin, deve ser possível navegar por uma experiência convincente de aprendizagem e percorrer:

Hoje → Aula → Exercício → Lab → Resultado → Próxima sessão

sem que a camada visual precise conhecer internamente como o GNOS decide pedagogia.
