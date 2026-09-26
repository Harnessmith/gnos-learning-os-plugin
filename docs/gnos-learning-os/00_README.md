# GNOS Learning OS — Prompt Kit para Forge

Este diretório contém prompts prontos para entregar ao profile `forge` no Hermes.

## Ordem recomendada

1. `01_PLUGIN_DESKTOP_V1.md` — cria o plugin/dashboard visual com mocks e contratos.
2. `02_PLUGIN_BACKEND_AND_CONTRACTS.md` — adiciona backend do plugin, persistência e APIs internas.
3. `03_PROFILE_GNOS_LEARNING_OS.md` — cria/evolui o profile GNOS com pedagogia, scheduler, pesquisa, avaliações e labs.
4. `04_INTEGRATION_PLUGIN_PROFILE.md` — conecta plugin e profile sem acoplamento indevido.
5. `05_TESTS_AND_ACCEPTANCE.md` — endurece testes, validações e critérios de aceite.
6. `06_MASTER_BUILD.md` — prompt mestre para executar o projeto completo quando desejar delegar tudo de uma vez.

## Repositório principal

- GNOS: https://github.com/joaomatheuslf/Gnos

## Repositórios de referência

- https://github.com/GarethManning/education-agent-skills
- https://github.com/ChasClogston/teaching-course-generator
- https://github.com/tobyilee/course-builder
- https://github.com/fenago/LearnGraph
- https://github.com/ghdkim/tutor-agent

## Princípios obrigatórios

- GNOS continua sendo o núcleo pedagógico.
- Não criar um Frankenstein copiando repositórios inteiros.
- Preservar compatibilidade e testes existentes sempre que possível.
- Plugin e profile devem ser desacoplados por contratos estáveis.
- Domínios/áreas de estudo devem ser adicionáveis, removíveis e hierárquicos.
- Toda formação segue 80/20: ensinar primeiro o que mais gera capacidade prática para o objetivo.
- Cronograma deve ser datado, versionado, adaptativo e preservar planejado x realizado.
- Exercícios, provas e labs geram evidência; exposição não equivale a domínio.
- Em áreas práticas, preferir execução real + validação determinística + interpretação pedagógica.
- Recursos externos devem ser pesquisados e avaliados, inclusive vídeos quando úteis.

## Como usar

Envie um prompt por vez ao Forge e peça que ele trabalhe no repositório/branch indicado. Depois de cada etapa, peça evidências de testes e um resumo dos arquivos alterados antes de seguir.
