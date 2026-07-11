# Obras de demonstração

A WIN-23 cadastra três fixtures temporárias para permitir a demonstração do
fluxo público antes da entrega dos dados reais:

| Código estável | Nome temporário | Local temporário |
| --- | --- | --- |
| `MVP-OBRA-01` | `[DEMO] Obra 01` | `Local a confirmar` |
| `MVP-OBRA-02` | `[DEMO] Obra 02` | `Local a confirmar` |
| `MVP-OBRA-03` | `[DEMO] Obra 03` | `Local a confirmar` |

Execute `npm run db:seed:works` para cadastrá-las. O seed é idempotente: se um
código já existe, ele não altera o registro. Assim, executar o comando novamente
não duplica obras nem sobrescreve nomes reais já informados.

## Substituição pelos dados reais

Quando os nomes e locais forem confirmados, atualize `name` e `location` nos
três registros, preservando os códigos `MVP-OBRA-01` a `MVP-OBRA-03`. Não é
necessário alterar o seed: como os códigos já existem, ele não substituirá os
dados reais. Obras que não devam aparecer no envio público devem usar
`active = false`.

O endpoint público `GET /api/obras` retorna
`{ obras: [{ id, nome, local? }] }` somente para obras com `active = true`,
ordenadas por nome e código. Ele não expõe notas, regras ou outros dados
internos.
