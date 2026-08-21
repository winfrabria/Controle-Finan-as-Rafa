# PRD — Estabilização do Harness WinfraBR

Status: proposta para auditoria independente  
Data: 21/08/2026  
Base: `main@1650fa6`  
Política atual: `2026-08-14.2`

## 1. Objetivo

Transformar a qualidade do Harness em algo mensurável e reproduzível antes de alterar modelo, prompt, regra ou produção. O resultado esperado é um corpus representativo com verdade de referência, um avaliador automatizado e relatórios que diferenciem:

- erro de extração;
- erro de reconciliação ou regra local;
- achado livre sem evidência suficiente;
- pergunta de contexto válida;
- limitação legítima do documento;
- erro de apresentação que não muda a decisão.

Esta rodada não autoriza merge na `main`, alteração de variáveis da Vercel, troca de modelo em produção, migration, push ou deploy.

## 2. Problema atual

Os testes unitários protegem contratos técnicos, mas ainda não medem de forma suficiente a qualidade semântica em documentos reais. O benchmark existente mede principalmente custo e latência e o arquivo de casos dourados é pequeno para representar notas simples, documentos compostos e reembolsos multipágina.

Os riscos prioritários são:

1. classificar como suspeita uma limitação ou um dado ausente;
2. não encontrar uma contradição explícita no próprio documento;
3. contar camadas sobrepostas como itens independentes;
4. emitir `TOTAL_MISMATCH` com cobertura parcial;
5. repetir o mesmo achado com títulos diferentes;
6. transformar uma inconsistência objetiva em pergunta ao remetente;
7. usar uma regra de obra que não foi fornecida;
8. produzir evidência correta, mas impossível de conferir na interface;
9. esconder falhas de schema, retries, latência ou custo atrás de uma classificação final.

## 3. Princípios obrigatórios

- Nenhuma regra pode conter nome de fornecedor, número de nota, nome de arquivo, placa ou valor fixo vindo de caso real.
- Todo achado precisa apontar evidência verificável no anexo ou regra externa realmente fornecida.
- Contradição explícita entre ficha, recibo, pagamento, boleto ou NF é achado; não é pergunta de contexto.
- Pergunta de contexto só pode tratar de fato externo que mudaria a conclusão e não pode ser inferido do anexo.
- Ausência de regra da obra não autoriza inventar regra ou suspeita.
- Recibo, pedido, comprovante ou documento sem valor fiscal não é suspeito apenas pelo tipo documental no MVP.
- `TOTAL_MISMATCH` exige cobertura `COMPLETE` dos itens contabilizáveis e reconciliação sem sobreposição.
- `UNKNOWN` e `INCOMPLETE` resultam em limitação, reextração ou achado específico sustentado; nunca em divergência do total por inferência.
- A resposta persistida não pode conter raciocínio interno, segredo, chave, prompt privado ou dados fora do contrato estruturado.
- A unidade avaliada é um anexo, mesmo quando ele contém várias páginas e camadas documentais.

## 4. Corpus de avaliação

O corpus deve usar cópias de teste em diretório não versionado ou artefatos sanitizados. Nenhum PDF real deve entrar no Git.

Categorias mínimas:

1. NF-e simples com totais consistentes;
2. NFS-e de serviço;
3. NF acompanhada de boleto e comprovante;
4. combustível com relatório de abastecimento;
5. alimentação, supermercado, limpeza e hospedagem;
6. reembolso composto multipágina com ficha, recibos e pagamentos;
7. documento parcialmente ilegível;
8. duplicidade real e documento apenas semelhante;
9. documento com contradição explícita de data, valor ou identidade;
10. documento que depende de contexto externo legítimo.

Cada caso precisa declarar:

- classificação aceitável;
- achados obrigatórios;
- achados proibidos;
- limitações aceitáveis;
- perguntas de contexto aceitáveis e proibidas;
- páginas, campos ou trechos que sustentam cada achado;
- número máximo de duplicatas semânticas;
- cobertura esperada dos itens;
- observação sobre camadas que não podem ser somadas duas vezes.

## 5. Métricas e gates

Métricas principais:

- acurácia de classificação por anexo;
- precisão e recall dos achados obrigatórios;
- taxa de achado sem evidência;
- taxa de duplicação semântica;
- precisão das perguntas de contexto;
- validade do schema;
- cobertura de páginas e itens;
- número de chamadas, retries e fallbacks;
- latência p50/p95;
- tokens e custo por etapa e por anexo.

Gates bloqueantes:

1. zero `TOTAL_MISMATCH` com cobertura diferente de `COMPLETE`;
2. zero regra de obra aplicada sem parâmetro de obra fornecido;
3. zero suspeita sustentada apenas pelo tipo de documento;
4. zero achado sem evidência rastreável;
5. zero contradição objetiva convertida em pergunta de contexto;
6. zero segredo ou raciocínio interno em log público;
7. schema válido em 100% das respostas aceitas;
8. uma falha de provider deve terminar em estado seguro e auditável, sem loop infinito.

As metas numéricas de precisão, recall, latência e custo serão definidas depois da primeira execução do corpus, para não inventar um baseline.

## 6. Pacotes de trabalho isolados

### WP-A — Auditoria semântica e de arquitetura

Branch: `codex/harness-audit-gemini35`  
Responsável sugerido: Antigravity, melhor Gemini 3.5 disponível no ambiente.

Escopo:

- ler este PRD e todo o Harness atual;
- revisar contratos, prompts, regras, engine, worker, retries e versionamento;
- mapear falhas semânticas e arquiteturais com arquivo/linha e caso reproduzível;
- desafiar as premissas deste PRD;
- propor mudanças, sem implementá-las;
- gravar o relatório em `docs/harness/reviews/2026-08-21-gemini35-audit.md`.

### WP-B — Red team independente

Branch: `codex/harness-redteam-nemotron`  
Responsável sugerido: OpenCode `opencode/nemotron-3-ultra-free`, variante `high`.

Escopo:

- procurar falso positivo, falso negativo, hardcode de caso, prompt injection, vazamento, loop, concorrência e inconsistência de estado;
- questionar explicitamente as conclusões do WP-A quando o relatório estiver disponível;
- não alterar código de produção;
- criar casos de teste mínimos apenas se necessários para provar uma falha;
- gravar o relatório em `docs/harness/reviews/2026-08-21-nemotron-redteam.md`.

### WP-C — Runner de avaliação e fixtures

Branch: `codex/harness-evals-bigpickle`  
Responsável sugerido: OpenCode `opencode/big-pickle`, variante `high`.

Escopo:

- criar contrato versionado de casos dourados;
- criar runner determinístico que compare classificação, achados, proibições, perguntas e duplicações;
- suportar execução offline com respostas gravadas e execução online opt-in;
- impedir que PDF real ou segredo seja versionado;
- produzir saída JSON e resumo legível;
- adicionar testes unitários do runner;
- documentar comando e formato;
- não mudar prompt, regra ou modelo para fazer os testes passarem.

### WP-D — Revisão cruzada

Responsável: agente principal.

Escopo:

- revisar todos os diffs e relatórios;
- executar testes em cada worktree;
- comparar divergências entre modelos;
- rejeitar sugestões específicas demais ou sem evidência;
- levar ao usuário apenas decisões de produto ou risco real;
- preparar uma branch de integração somente após aprovação.

## 7. Contrato de entrega para cada agente

Cada agente deve:

1. trabalhar apenas na branch e worktree atribuídas;
2. começar lendo este PRD;
3. registrar comandos e testes executados;
4. distinguir fato observado, hipótese e recomendação;
5. citar arquivo e linha para toda falha de código;
6. não incluir cadeia de pensamento; entregar somente achado, evidência, impacto e correção sugerida;
7. não fazer push, merge, deploy, migration ou alteração externa;
8. não modificar arquivos fora do seu pacote;
9. terminar com um commit local de escopo único.

## 8. Próximas rodadas, fora do escopo atual

Depois da estabilização do Harness:

- auditoria da observabilidade administrativa e logs;
- testes E2E dos papéis ADMIN, REVIEWER e envio público;
- atualização controlada de dependências em branch própria;
- QA visual e PWA;
- benchmark comparativo de modelos com o mesmo corpus e temperatura/configuração equivalentes.

Essas rodadas não devem começar antes de o contrato de avaliação do WP-C estar aprovado, porque sem ele não existe medida comum para comparar mudanças.

## 9. Processo de decisão

O agente principal apresenta:

- consenso entre auditores;
- pontos em que os auditores discordaram;
- propostas aceitas, rejeitadas e pendentes;
- impacto esperado em qualidade, tempo e custo;
- branch recomendada para teste.

Somente depois da aprovação do usuário será criada a integração. A tarefa permanente do Harness deve ser atualizada antes de qualquer mudança de política, prompt, schema, regra, roteamento, retry, versão ou produção.
