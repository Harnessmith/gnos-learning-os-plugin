# PROMPT 05 — Testes, Validação e Critérios de Aceite

Você é o Forge. O GNOS Learning OS e seu plugin já existem.

## Missão

Criar uma suíte de validação suficientemente forte para impedir regressões pedagógicas, corrupção de estado e falhas perigosas de sandbox.

## Testes obrigatórios

### 1. GNOS existente

Rodar todos os testes originais e manter compatibilidade quando possível.

### 2. Contratos

Testar schemas entre:
- plugin;
- backend;
- profile;
- lab runner.

### 3. Timeline

Casos:
- sessão concluída normalmente;
- sessão atrasada;
- repair session inserida;
- aula reagendada;
- aula pulada por domínio já demonstrado;
- planned timeline preservada;
- actual timeline correta.

### 4. Evidence

Garantir:
- exposure não vira demonstrated;
- hint não equivale a none;
- worked-example não equivale a independent success;
- retained exige evidência posterior apropriada;
- tentativa duplicada é idempotente;
- histórico anterior não é apagado por falha posterior.

### 5. Course adaptation

Testar:
- rephrase sem revisão do course;
- missing prerequisite cria alteração apropriada;
- nova fonte versiona plano quando necessário;
- revisão preserva IDs estáveis;
- stale fingerprint bloqueia continuidade silenciosa.

### 6. 80/20

Criar testes/fixtures verificando que o planejador prioriza:
- fundamentos;
- alta frequência;
- alto prerequisite power;
- alta aplicabilidade;
antes de edge cases de baixo impacto.

Não transformar 80/20 em regra matemática rígida se isso degradar o ensino.

### 7. Labs

Garantir:
- isolamento;
- timeout;
- cleanup;
- reset;
- caminhos restritos;
- comandos fora do escopo bloqueados quando aplicável;
- falha do runner não derruba Hermes;
- check determinístico retorna resultado reproduzível.

### 8. Correção

Casos:
- correct;
- partial;
- incorrect;
- correct with hint;
- correct after worked-example;
- misconception;
- prerequisite gap;
- transfer success;
- delayed failure.

### 9. Recursos

Validar que resource selection:
- prefere fontes oficiais quando apropriado;
- não inventa conteúdo de fonte não aberta;
- não trata snippet como verificação;
- registra provenance;
- evita excesso de links.

### 10. UI

Testar fluxo:
Hoje → Aula → Lab → Resultado → Próxima sessão.

Testar estados vazios/erro/loading/offline/profile unavailable.

## Cenário E2E DevOps

Criar fixture de aluno fictício:
- objetivo: DevOps Júnior → Pleno;
- 3 sessões/semana;
- 90 minutos;
- conhece Git básico;
- desconhece Docker networking.

Simular:
1. diagnóstico;
2. cronograma;
3. aula;
4. lab de Docker networking;
5. erro de localhost/DNS;
6. hint;
7. correção parcial;
8. repair session inserida;
9. nova tentativa sem ajuda;
10. demonstrated;
11. delayed transfer;
12. retained.

Verificar toda a cronologia e evidência.

## Definition of Done

O projeto só está pronto quando:
- testes originais passam ou regressões são explicitamente justificadas;
- novos testes passam;
- plugin não depende de mocks para o fluxo principal;
- profile e UI comunicam por contratos versionados;
- labs são isolados;
- cronograma é persistente/adaptativo;
- evidência não é fabricada;
- erros e ajuda alteram corretamente o learner state;
- README explica instalação, arquitetura e troubleshooting.
