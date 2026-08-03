# Dados de demonstração

`npm run db:seed:demo` cria um conjunto determinístico de anexos fictícios
anteriores a ontem para apresentação e QA. O seed é executado dentro de uma
transação e é idempotente pelo protocolo `DEMO-...`.

Os fixtures cobrem: anexo OK, suspeita confirmada, falso positivo, necessidade
de informação, falha de leitura, anexo ainda em análise, falha técnica e uma
segunda nota OK. Também são criados itens extraídos, achados, execuções do
Harness com custo zero, histórico, notificações e logs administrativos. Nenhum
`ProcessingJob` é criado para os fixtures; portanto eles não acionam o worker e
não consomem OpenRouter.

Os nomes das obras de demonstração começam com `[DEMO]` e os protocolos e
arquivos com `DEMO-`, para que os registros fictícios não sejam confundidos com
dados reais. O seed preserva as marcações de “lido” existentes. Para reiniciar
também esse estado durante uma apresentação, execute:

```bash
npm run db:seed:demo -- --reset-reads
```

Quando as notas reais estiverem disponíveis, os fixtures podem ser removidos
por protocolo `DEMO-%` sem afetar anexos reais.
