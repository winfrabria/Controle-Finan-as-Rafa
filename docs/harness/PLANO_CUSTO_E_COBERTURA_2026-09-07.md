# Correção local: recuperação, cobertura e consumo

Status: implementação local e validação offline concluídas; homologação real pendente. Sem chamadas pagas, reprocessamento de notas reais, commit, push ou deploy nesta rodada.

## Diagnóstico confirmado

- Uma resposta estruturalmente válida foi descartada por cobertura inconsistente; o fallback PDF usou outro parser, recebeu HTTP 400 e a aplicação culpou o arquivo legível.
- A primeira extração não ficou disponível quando a segunda chamada falhou; o detalhe sanitizado do erro e da primeira limitação também não foi preservado.
- Contar linhas de uma ficha não comprova leitura de todos os comprovantes da página. A extração omitiu pagamento e instrução de preenchimento; o verificador posterior expirou.

## Entregas

1. Recuperação limitada: manter a primeira extração válida, distinguir falha do parser de arquivo realmente inacessível, registrar erro sanitizado por tentativa e manter no máximo duas chamadas de extração.
2. PDF adaptativo: manter leitura nativa também na recuperação; não acionar automaticamente um segundo serviço de OCR quando não há OCR reutilizável.
3. Cobertura: inventário compacto por página, tipos e quantidade de registros, instrução de obrigatoriedade e confronto com as observações extraídas. Não tratar apenas a declaração COMPLETE da IA como prova.
4. Custo: se a extração continuar incompleta após a recuperação, concluir com limitações e regras locais sustentadas, sem contratar Terra e Sol para tentar reconstruir dados ausentes. Não esconder achados sustentados nem aprovar documentos incompletos.
5. Prompts: distinguir instruções maliciosas para a IA de instruções de preenchimento do formulário; preservar todos os registros de uma mesma página, sem regras particulares por fornecedor/valor.
6. Testes offline: recuperação com HTTP 400/timeout, metadados sanitizados, ausência e inconsistência de inventário, pagamento omitido, campos obrigatórios/opcionais, sucesso completo e conclusão sem chamadas de auditoria/verificação quando falta base.

## Aceitação e limites

- Testes, lint, typecheck e build comprovam os contratos, não precisão real do modelo.
- Nenhum modelo é promovido com base em suposição; a qualidade após mudança do contrato ainda requer uma única rodada real controlada e orçamento previamente combinado.
- O inventário é uma salvaguarda estrutural, não verificação independente da imagem. Omissões simultâneas no inventário e nas observações ainda exigem validação humana ou visual independente.
- Nenhum PDF real entra no repositório. Não apagar dados existentes.

## Resultado da rodada

- Harness: 332 testes aprovados, 3 ignorados e nenhuma falha. Upload: 54; detalhe: 20; push/PWA: 40; autenticação: 7; obras: 10. Total: 463 aprovados e 3 ignorados.
- Corpus sintético: 20 casos dourados aprovados. Lint, typecheck, build e verificação de whitespace passaram.
- Recuperação reproduzida offline com erro de parser HTTP 400, indicação de arquivo criptografado contraditória com leitura já validada, timeout, falta de saldo e falha de conexão. Em todos esses cenários, o checkpoint válido é mantido com limitação, sem terceira chamada de extração.
- O checkpoint desta correção fica em memória durante a recuperação e é persistido ao concluir a extração. Não representa recuperação durável contra encerramento do processo entre as duas chamadas.
- Testes da auditoria confirmam zero chamadas de descoberta/verificação quando a extração está limitada; achados locais sustentados permanecem, sem aprovar a nota incompleta.
- Configuração local de recuperação PDF alterada de `mistral-ocr` para `native`. Nenhum modelo trocado e nenhuma configuração de produção alterada.
- Consulta somente leitura aos registros dos últimos três dias: US$ 0,5720 conhecidos; nove execuções sem custo informado. Duas verificações concluídas somaram US$ 0,3705. Esses registros não permitem reconciliar a diferença de US$ 7 relatada pelo usuário, nem comprovam o saldo atual do OpenRouter.
- Uso de API de IA nesta rodada: nenhuma chamada. Não foi feita medição real de economia ou latência após o patch.

## Próxima validação, ainda não executada

Combinar orçamento para uma rodada controlada dos três arquivos já conhecidos, uma execução por arquivo, sequencialmente e parando na primeira falha. Conferir dados, evidências e custo real; não repetir lotes ou promover modelo automaticamente. Antes disso, conciliar o consumo com o extrato do OpenRouter, pois custo não informado em logs não significa custo zero.
