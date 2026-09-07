# Correções de runtime e smoke real — 06/09/2026

Entrega somente local, em `codex/stabilize-universal-docs`. Nenhum commit, push,
deploy ou exclusão de notas nesta rodada. Alterações anteriores preservadas.

## O que foi corrigido

1. A extração usava o validador de esforço da auditoria e rejeitava `low` antes
   de chamar a IA. Agora cada etapa valida seu próprio esforço. A auditoria
   continua restrita a `high/max/xhigh`.
2. Configurações de extração, auditoria e verificação são validadas antes do
   trabalho pago e da aquisição da nota. Falha de configuração encerra o job
   com `EXTRACTION_CONFIGURATION_INVALID`, sem recuperação incompatível.
3. A criação do registro de execução passou para dentro do tratamento de
   falha. Erro de persistência é identificado como `EXTRACTION_PERSISTENCE_FAILED`,
   sem atribuí-lo ao documento. A recuperação de um `PIPELINE_FAILED` legado
   exige o job proprietário em execução.
4. O teste online reproduziu HTTP 400 no esquema de extração completo do Gemini,
   mesmo sem raciocínio; um esquema simples com `low` respondeu 200. A versão
   estrutural do esquema completo também respondeu 200. O cliente agora adapta
   o esquema enviado ao Gemini e mantém todas as validações Zod locais.
5. O esforço efetivamente usado fica no JSON da execução e aparece nos leitores
   administrativos, inclusive no fallback. Não foi aplicada migração no banco
   compartilhado: a coluna enum legada mantém sua compatibilidade documentada
   em `docs/EXTRACTION.md`.
6. A cobertura de imagens também passa pela revisão seletiva. Isso corrigiu a
   leitura ruim de uma imagem composta: a linha foi relida como 4 × R$ 45,00 =
   R$ 180,00, sem publicar o conflito aritmético inicialmente sugerido.
7. Um único `documentGroup` em uma nota simples não a transforma em documento
   composto. No teste real, a extração simples caiu de duas chamadas e 26,7 s
   para uma chamada de aproximadamente 9,6–12,5 s. São amostras, não benchmark
   de p50/p95 nem promessa de latência.
8. Timeout durante o recebimento do corpo HTTP 200 do verificador era rotulado
   como JSON inválido. Agora aparece como `VERIFICATION_TIMEOUT`, com latência.
   Hipóteses financeiras não confirmadas continuam descartadas; regras
   determinísticas sustentadas permanecem.
9. Uma disputa esperada entre upload e polling pelo mesmo job não imprime mais
   uma falsa falha de recuperação. Falhas reais continuam sendo registradas.

## Testes automatizados

| Bateria | Aprovados | Falhas | Ignorados |
| --- | ---: | ---: | ---: |
| Harness, integrações, configuração e jobs | 313 | 0 | 3 |
| Upload/apresentação | 54 | 0 | 0 |
| Detalhe da nota | 20 | 0 | 0 |
| Autorização | 7 | 0 | 0 |
| Obras | 10 | 0 | 0 |
| Push/PWA | 40 | 0 | 0 |
| Total | 444 | 0 | 3 |

Golden cases offline: 20/20. Lint, TypeScript, build otimizado e diff-check
passaram. Os três testes ignorados não contam como validação concluída.

Os novos testes conectam o job real à extração, configuração e cliente HTTP
reais, com banco/Storage/provedor simulados. Cobrem `low` em PDF/JPG/PNG, três
uploads concorrentes, configuração inválida, persistência, recuperação legada,
HTTP 400 com fallback distinto, saldo insuficiente e timeout no corpo HTTP.
As baterias existentes também cobrem OCR reutilizado, documentos ilegíveis,
extrações parciais, duplicação, contexto e proteção contra falsos positivos.

## Smoke com internet, banco, Storage e IA reais

Fontes públicas educativas, não documentos privados do usuário:

- [NFC-e de exemplo eGestor](https://blog.egestor.com.br/wp-content/uploads/Exemplo-Nota-Fiscal-do-Consumidor-Eletronica-NFC-e.pdf).
- [Guia didático do IF Baiano, 12 páginas](https://ifbaiano.edu.br/portal/extensao/wp-content/uploads/sites/4/2019/09/guia-materiais-proex-2019.pdf): página 10 renderizada em PNG e página 11 em JPG, além do PDF integral.

Arquivos conferidos visualmente antes dos testes. Upload via API pública do
localhost, obra DEMO, cookies de capacidade mantidos somente em memória e
roteamento ZDR ativo. Os arquivos ficaram em `tmp/`, fora do repositório.

| Amostra | Resultado observado | Recebimento | Conclusão |
| --- | --- | ---: | ---: |
| JPG, pedido de venda e formulário vazio | 6 itens, R$ 984,43, data 19/06/2014; sem achado inventado por campos opcionais | 0,95 s | 15,6 s |
| PNG, duas notas no mesmo slide | itens R$ 180,00, R$ 50,00 e R$ 100,00; Sol verificou; sem suspeita indevida | 0,99 s | 49,2 s |
| PDF integral de 12 páginas | `OTHER`, sem total inventado; informação insuficiente, sem falha técnica | 1,27 s | 30,5 s |
| NFC-e simples | R$ 15,00 e data 01/01/2001 corretos; CNPJ fictício inválido e duplicação do reenvio foram identificados | 1,58 s | 64,2 s |

Na última rodada, três arquivos simultâneos concluíram com jobs `SUCCEEDED`.
O JPG foi conferido na rodada anterior; os quatro cenários foram novamente
validados sobre os resultados persistidos por `scripts/validate-public-smoke.mjs`.
Documentos de exemplo não precisam terminar todos como OK: o CNPJ fictício da
NFC-e é inválido e os slides não comprovam uma despesa real.

Falhas não omitidas: a primeira rodada real reproduziu o HTTP 400 e levou à
correção. Na rodada ampliada seguinte houve uma indisponibilidade no Storage
(HTTP 502) e uma falha de conexão com o provedor. Repetidas as amostras, elas
concluíram. Não há garantia de disponibilidade de terceiros. Em um caso final,
Sol atingiu o limite de 30 s; isso não bloqueou a nota nem publicou sua hipótese
financeira sem confirmação.

Evidências detalhadas e IDs estão em `tmp/public-invoice-smoke/`: resultados
HTTP, leitura do banco, rodadas anteriores e hashes dos arquivos. Notas de QA
permanecem identificadas com prefixo `QA-PUBLICO-`; nenhuma nota foi apagada.

## Como testar agora

Abra <http://localhost:3000/enviar-nota>, escolha uma obra e envie PDF, JPG ou PNG.
Depois do recebimento, envie outro arquivo sem esperar a conferência do primeiro.
No acesso do Rafael, abra <http://localhost:3000/revisao/notas> e confira os
campos, evidências, diagnóstico e o botão de marcar como lida.

Use uma nota nova para validar leitura sem o achado de duplicação. Reenviar uma
nota já processada pode corretamente gerar "Possível nota duplicada". Falhas
antigas não foram apagadas nem reprocessadas silenciosamente.

Esta é liberação para teste local, não aprovação de produção. Ficam pendentes
aceite humano com o corpus privado e teste em dispositivo PWA físico. O tempo
de auditoria/verificação ainda varia; os resultados não sustentam promessa de
latência máxima nem acurácia universal.
