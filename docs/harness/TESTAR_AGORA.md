# Testar agora — 19/09/2026

Ambiente para **teste controlado e revisão humana**, não para aprovação financeira automática. As notas enviadas foram preservadas; o banco não foi zerado novamente.

- Revisão: http://localhost:3117/revisao/notas
- Envio: http://127.0.0.1:3117/enviar-nota
- Acesso local: `tmp/ACESSO_LOCAL.md` nesta worktree. Não publicar esse arquivo.
- Versões: policy `2026-09-19.19`, prompt `2026-09-19.9`, schema `2026-09-19.27`, rules `2026-09-19.29`.

## Correções desta rodada

O servidor iniciado às 09:17 ainda executava a policy `2026-09-12.12`, apesar de uma compilação posterior no disco. As chamadas de IA dos quatro envios haviam terminado, mas o processo antigo continuava aplicando as regras anteriores. Compilar não reinicia `next start`.

O `prebuild` agora recusa sobrescrever o build enquanto o servidor isolado estiver ativo. Depois de parar o processo local, compilar e iniciar novamente, execute `npx tsx scripts/check-isolated-runtime.ts`. Esse comando autentica no ambiente local e compara as versões devolvidas pelo servidor HTTP com as do código, além de conferir a saúde e a fila. Não expõe credenciais.

Também foi corrigido o falso bloqueio entre emissão e vencimento de boleto. A exceção exige confirmação independente com datas rotuladas na mesma linha, fonte e página; não altera o original nem a extração persistida. Datas de mesma finalidade, valores realmente conflitantes e evidências de outra página continuam bloqueados.

Documentos referenciados mas ausentes agora recebem uma explicação concreta. A interface não afirma mais, genericamente, que reprocessar resolverá o problema, nem diz que uma conferência já encerrada continua aguardando análise.

Em 19/09, foram corrigidos mais três bloqueios genéricos: observação documental `OTHER` omitida do inventário de uma página já verificada, cupons/NFC-e citados na NF-e apenas como origem tributária tratados como anexos obrigatórios e desconto tipado ignorado no cálculo do item. O painel “Alcance desta análise” foi removido da interface; falhas técnicas reais continuam exibindo sua mensagem específica.

Na revisão seguinte, a interface deixou de exibir o cartão verde grande quando não há inconsistências e passou a apresentar comparações como **Encontrado** e **Esperado**, com as fontes que sustentam cada lado. As regras agora reconhecem concordância entre ficha, venda/pedido, recibo e pagamento, preservam conflitos sem referência comprovada e eliminam duplicações do mesmo conflito entre regra local e verificação por IA. A tela usa `Revisão manual` apenas quando existe uma lacuna técnica ou documental concreta.

Também foi corrigida a validação textual da verificação independente: listas de descrições separadas por barra, vírgula ou ponto e vírgula são aceitas somente quando cada termo consta da mesma citação. Isso evita rejeitar achados verdadeiros por diferença de pontuação sem afrouxar a conferência de valores, datas, páginas ou fontes. Inventários parciais não geram mais uma divergência de composição baseada apenas nos itens que couberam na extração.

## O que foi validado

- Harness completo: **700 testes aprovados, 30 pulados por dependerem de integrações opcionais e nenhuma falha**.
- Detalhe da nota: **40/40**.
- Lista e envio: **72/72**.
- Histórico público: **10/10**.
- PWA: **36/36**.
- ESLint, TypeScript e build de produção aprovados; o worker compilado renderizou uma página PDF completa sem chamada de modelo.
- O servidor HTTP confirmou as versões acima e a fila sem pendências.
- Os PDFs originais da Medeiros e do Alexandre foram preservados e suas cópias locais conferidas por SHA-256. As três páginas da Medeiros foram renderizadas e inspecionadas visualmente.

## Como testar

1. Abra **Enviar nota** e confirme que a obra aparece. Selecione `Obra 104 · Teste isolado`.
2. Envie um PDF, JPG ou PNG de até 10 MB. Para comparar documentos independentes, envie cada original uma vez.
3. Você pode iniciar outro envio enquanto o anterior continua em segundo plano. Cada protocolo deve manter seu próprio andamento.
4. Abra **Revisão de notas** quando concluir. O resultado normal deve ser `OK` quando não houver inconsistência sustentada ou `Suspeita` quando houver achado comprovado. `Precisa de informação` fica reservado a uma dependência externa concreta. Falha ou leitura realmente insuficiente não pode virar `OK` por conveniência.
5. Em cada achado, confira **Onde encontramos**: fonte, página, trecho e valor/data precisam corresponder ao PDF. Um resumo da IA não deve aparecer como terceira fonte.
6. Abra a nota detalhada, escolha no seletor a página citada e confira se a imagem real é renderizada.
7. Para testar duplicidade intencionalmente, envie exatamente o mesmo arquivo duas vezes. O alerta deve dizer que o arquivo foi reenviado, sem alegar automaticamente pagamento duplicado.

Não use **Marcar como lida** nem o feedback como aprovação da despesa. Essas ações organizam a revisão; não mudam o conteúdo fiscal.

## Resultados já gravados no banco

Os diagnósticos dos quatro envios feitos antes desta compilação continuam gravados com a lógica anterior. A atualização da interface aparece ao recarregar a página, mas a nova interpretação do conteúdo só aparece em uma nova análise ou reprocessamento. Nenhuma chamada paga nem reprocessamento automático foi disparado nesta correção.

Na validação local com as evidências já extraídas, a nota da Neuracy deixou de gerar a falsa divergência de composição e passou a sustentar a divergência real entre a descrição fiscal `PÃO FRANCÊS` e a folha de controle com café da manhã, janta e suco. No conjunto do Roger, as regras passaram a separar três eventos: data de 19/05 contra 18/05, venda/pedido de R$ 44,50 contra ficha e pagamento de R$ 40,00, e pagamento de R$ 28,00 contra ficha e recibo de R$ 18,00.

Resultados antigos não devem ser apresentados como se fossem produzidos pela versão nova. Para validar a mudança de ponta a ponta, envie novamente os mesmos arquivos no ambiente isolado ou use o reprocessamento administrativo controlado.

## Modelos e desempenho

A configuração de modelos não foi alterada nesta correção. As novas rodadas completas levaram aproximadamente 72 s para Pabla, 70 s para Veredas e 133 s para Medeiros. A leitura inicial e auditoria do Alexandre levaram 55 s; após corrigir a regra, a reauditoria reaproveitou a extração e levou aproximadamente 160 s adicionais, sendo 130 s na auditoria e 30 s na verificação. São rodadas diferentes, não uma comparação de velocidade entre modelos.

Ainda existe latência variável nas chamadas externas. Esta rodada corrigiu execução desatualizada, interpretação de datas e explicação de pendências; não comprovou redução geral do tempo de análise nem superioridade de outro modelo.

## Limites honestos

- Quatro documentos reais e testes automatizados não provam precisão geral para todo formato fiscal.
- A falta de documentos referenciados é diferente de falha de leitura. Reprocessar o mesmo arquivo não acrescenta suporte externo.
- O modo do verificador continua `shadow`; não houve promoção para `enforce`.
- PWA em aparelho físico, operação em produção e aprovação financeira automática continuam fora desta validação.
- A worktree principal `F:\winfra-rafael` não foi alterada. Não houve commit, push, integração ou deploy.
