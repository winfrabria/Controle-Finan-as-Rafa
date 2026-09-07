# Estabilização local: roteamento, comparações e evidências

## Escopo e limites

Correção local na branch `codex/stabilize-universal-docs`, preservando as alterações existentes. Nenhuma exclusão de notas, migração remota, troca automática de modelo, commit, push ou deploy faz parte desta entrega. O PWA conserva seu desenho; ajustes nele são apenas de semântica e compatibilidade dos achados.

Não existe garantia de cobertura de todo documento possível. A aprovação exige os cenários abaixo, evidência reproduzível e explicitação dos testes não executados.

## Responsáveis

1. Luna max — integração OpenRouter: parâmetros de cada modelo, fallback limitado, tratamento de erros e reaproveitamento de OCR.
2. Luna max — apresentação: comparações por fonte, referência comprovada, ajuste mínimo mobile e sanitização de dados do revisor.
3. Luna max — testes adversariais: concorrência, vazamento de dados e formatos alternativos de metadados; revisão sem modificar as regras de produção.
4. Agente principal — revisar os diffs, integrar os testes às suítes, questionar conclusões dos agentes, executar a bateria independente e decidir a liberação para homologação.

## Sequência de execução

1. Reproduzir os uploads interrompidos e confirmar o diagnóstico sem atribuir o problema ao arquivo.
2. Corrigir o caminho principal e o fallback; testar antes de testar documentos do usuário.
3. Corrigir a apresentação sem alterar a conclusão financeira por motivos visuais.
4. Rodar revisão adversarial independente. Toda falha relevante volta ao responsável acompanhada de teste.
5. Integrar os testes adversariais aos comandos normais de validação, evitando testes que só passam quando executados manualmente.
6. Executar novamente lint, TypeScript, Harness, upload, detalhe, PWA, autenticação, obras, push, corpus offline e build.
7. Executar smoke controlado com dados sintéticos e conferir a interface. QA autenticado depende de uma sessão disponível e deve ser declarado quando não executado.
8. Entregar links locais e roteiro de teste. Produção permanece condicionada à aprovação funcional e visual do usuário.

## Matriz de aceitação

| Área | Cenários obrigatórios | Resultado esperado |
| --- | --- | --- |
| Roteamento | Terra/Sol, JSON Schema, reasoning high, ZDR, require_parameters | Parâmetro de tokens compatível, somente um parâmetro por requisição |
| Fallback | 400 configuracional, 404 sem endpoint, timeout, estrutura inválida | No máximo uma tentativa distinta no Sol |
| Falha não recuperável | 402, 429, 503, inclusive envelope de erro | Sem repetição paga ou fallback disfarçado |
| Leitura | PDF, JPG, PNG corrompido/protegido/inválido | Falha de leitura distinta de erro técnico; sem acusação de irregularidade |
| OCR | annotations em mensagem, error.metadata, metadata e openrouter_metadata | Reutilizar o texto extraído; não reenviar o PDF quando o OCR estiver disponível |
| Conteúdo | OTHER, documento composto, parcial, reembolso, arquivo longo | Categoria não impede envio; insuficiência não vira divergência inventada |
| Obrigatoriedade | marca explícita com base verificável; opcional; dado legado sem base | Só campo efetivamente obrigatório ausente gera achado |
| Comparação | REFERENCE, CONFLICT, dados legados, datas e valores na mesma evidência | Referência justificada ou fontes neutras; nenhuma associação de valor/fonte inventada |
| Concorrência | três pipelines sobrepostos com Promise.all | noteId, jobId, OCR e estados isolados |
| Rafael | dados estruturados, texto livre e evidências antigas | Sem provider, requestId, rota, raciocínio interno, custo/tokens ou URLs técnicas |
| Interface | 1, 4 e 10+ achados; desktop e semântica no PWA existente | Cards separados, evidências legíveis, navegação e ação de leitura preservadas |

## Evidência já obtida antes da retomada

- O smoke sintético de roteamento respondeu HTTP 200 com Terra via Azure, mantendo JSON Schema, reasoning high, ZDR e require_parameters. Esse teste não é uma medição de tempo de análise de PDF.
- Primeira bateria independente: Harness 241 aprovados e 3 skips de banco; upload 51; detalhe 10; PWA 36; autenticação 7; obras 10; push 40 (inclui os testes PWA); lint, TypeScript e build aprovados.
- Corpus determinístico: 20 de 20 casos aprovados. Isso não comprova a qualidade de extração dos modelos em documentos reais.
- O red-team reproduziu falhas adicionais: conflito omitido no mobile, envelope de erro com HTTP 200, imagem inválida acionando fallback, obrigatoriedade explícita não reconhecida, metadados técnicos no reviewer e annotations top-level ignoradas.
- O teste de três pipelines realmente concorrentes passou, com três extrações simultâneas. Ele não substitui teste de concorrência no provedor ou banco real.
- Smoke de extração do cliente real, com PDF sintético gerado em memória: Terra/Azure, uma tentativa, 5.799 ms, `OTHER`, um item e total preservados. Custo informado pelo provedor: US$ 0,013459.
- Smoke do fallback: erro 404 inicial simulado e segunda chamada real Sol/Azure, duas tentativas ao todo, 13.762 ms, um item e total preservados. Custo informado: US$ 0,04902225. Nenhum arquivo do usuário, storage ou banco foi usado nesses dois smokes.
- Comandos reproduzíveis: `npx tsx --conditions=react-server scripts/smoke-extraction-routing.ts --online` e o mesmo com `--fallback`. Sem `--online`, o script não faz chamada paga. Estes tempos se referem apenas ao PDF sintético de uma página.

## Resultado da rodada final local

- Harness: 264 testes aprovados e 3 testes de integração com banco ignorados intencionalmente. Os skips exigem `HARNESS_DATABASE_TESTS=1` e não foram habilitados para evitar escrita em banco sem um ambiente isolado confirmado.
- Detalhe da nota: 20 de 20 aprovados. Upload e apresentação da caixa de notas: 54 de 54 aprovados.
- PWA: 36 de 36; autenticação: 7 de 7; push: 40 de 40. A suíte de push inclui os 36 testes do PWA, portanto essas contagens não representam 76 casos exclusivos.
- Corpus determinístico: 20 de 20 dentro da suíte do Harness, sem chamadas ao provedor.
- Lint, TypeScript, `git diff --check` e build otimizado do Next.js aprovados após a última alteração.
- Testes unitários das obras: 9 asserções aprovadas. O arquivo de integração com banco ficou filtrado e não é contabilizado como CRUD validado.
- QA visual do componente real foi executado com uma fixture sintética em 1, 4 e 12 achados na largura de 1265 px. Foram confirmados cartões separados, conflito neutro, referência vermelho/verde, datas corretas, navegação nos limites, expansão dos sete campos obrigatórios e ausência de rolagem horizontal.
- A revisão principal encontrou e corrigiu, além dos casos inicialmente delegados: normalização de campo obrigatório no caminho canônico, preservação de texto natural contendo “rota” ou “provedor”, seleção correta de data quando a evidência também contém valor, bordas independentes dos cartões e expansão segura da lista de campos obrigatórios.
- O parecer adversarial final levantou duas hipóteses que foram revisadas e rejeitadas como bloqueadores: `require_parameters` é justamente o filtro de endpoints compatíveis e Terra/Sol passaram no smoke online após a correção de `max_completion_tokens`; o item 12 define explicitamente `comparisonMode: CONFLICT` e `expectedValue: null`, coberto no Harness e nas duas apresentações. Permanece, contudo, a necessidade de roteamento específico antes de testar candidatos experimentais `JSON_ONLY`.

## Limites ainda não validados nesta rodada

- O agente adversarial original foi interrompido por limite de uso; os casos já produzidos foram incorporados e a revisão principal assumiu os cenários restantes. Isso não é contado como parecer completo daquele agente.
- O fluxo autenticado completo do Rafael não foi executado porque as sessões disponíveis no navegador local chegaram à tela de login. A fixture visual usa o componente real e o CSS real, mas não substitui o shell autenticado, leitura do banco e ação real de marcar como lida.
- Os três pipelines concorrentes são simulados em memória. Não houve teste de carga simultânea contra banco e provedor reais.
- Não houve upload ponta a ponta de PDF real nesta rodada final, nem teste físico do PWA, nem reprocessamento de notas antigas.
- O benchmark amplo de modelos não foi executado nem promoveu modelo algum. Os dois smokes pagos sintéticos medem apenas uma página e não sustentam conclusão sobre documentos longos ou latência de produção.
- O benchmark atual atua sobre o JSON estruturado do corpus, não sobre a extração multimodal de PDF/JPG/PNG. Candidatos marcados como `JSON_ONLY` também precisam de roteamento por capacidade antes de qualquer rodada online; o `require_parameters` global não é evidência de compatibilidade desses candidatos.
- Nenhuma nota foi apagada e nenhuma migração, commit, push ou deploy foi realizado.

## Checklist da segunda rodada

- [x] Corrigir e revisar os casos adversariais reproduzidos.
- [x] Incorporar os arquivos adversariais de OpenRouter/concorrência ao `test:harness` e o de sanitização ao `test:note-detail`.
- [x] Reexecutar a bateria após a última alteração.
- [x] Fazer smoke de extração com conteúdo sintético, incluindo fallback real após falha primária simulada.
- [x] Conferir visualmente os componentes reais com dados sintéticos e declarar o bloqueio de autenticação.
- [x] Publicar o roteiro de homologação local com os limites conhecidos.

## Teste do usuário após liberação local

1. Abrir `http://localhost:3000/enviar-nota`, escolher uma obra e enviar um PDF ainda não usado nesta rodada. Verificar que o envio é aceito, chega à conferência e tem estado final explicado.
2. Enviar dois outros documentos em abas distintas (PDF/foto), verificar identificação individual e ausência de mistura de obra, arquivo e resultado.
3. Entrar como Rafael e abrir `http://localhost:3000/revisao/notas`. Comparar um conflito sem referência e uma divergência com referência sustentada. No conflito, os valores devem ficar separados por fonte e neutros; na referência, encontrado e esperado ficam em cartões separados e com rótulos explícitos.
4. Conferir datas em pt-BR e evidências por página/trecho; nenhuma data pode aparecer como valor monetário ou vice-versa.
5. Conferir campos obrigatórios e opcionais; nenhuma obrigatoriedade deve ser inferida apenas por o campo estar vazio.
6. Abrir a análise completa, navegar anterior/próximo e marcar a nota como lida. Confirmar o histórico.
7. No PWA atual, verificar os mesmos dados sem exigir um redesign visual novo.

Notas antigas não são reanalisadas automaticamente por mudar o código. Um teste novo deve usar um novo envio ou a ação administrativa de reprocessamento autorizada, quando disponível. Duplicidade detectada deve ser distinguida do resultado de uma auditoria nova.
