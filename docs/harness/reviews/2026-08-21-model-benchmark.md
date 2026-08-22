# Benchmark controlado de modelos do Harness — 2026-08-21

## Objetivo

Comparar somente a etapa de **avaliação** do Harness com as mesmas entradas
sintéticas estruturadas. Este benchmark não mede extração multimodal de PDF,
não usa notas reais, não consulta o banco, não habilita pesquisa web e não
altera o modelo de produção.

## Método

- modelos: `openai/gpt-5.6-luna`, `openai/gpt-5.6-terra`,
  `google/gemini-3.7-flash` e `openai/gpt-5.6-sol`;
- esforço `high`, até duas tentativas, sem fallback entre modelos;
- execução sequencial para não misturar latência e rate limit;
- três casos sentinela comuns: documento consistente, cobertura parcial sem
  falso `TOTAL_MISMATCH` e contradição documental explícita;
- um caso de contexto operacional legítimo repetido três vezes para medir
  estabilidade;
- relatórios brutos locais em `.codex/benchmarks/`, ignorados pelo Git.

O primeiro desenho do caso de contexto pedia um limite da obra que não aparecia
na entrada. Esse teste foi descartado por defeito da própria verdade de
referência. O caso corrigido usa uma nota sintética de alimentação com 40
refeições, sem quantidade de pessoas nem período de consumo: fatos externos que
podem mudar a avaliação e justificam uma pergunta objetiva.

## Resultados

Nos três casos comuns, os quatro modelos passaram 3/3.

| Modelo | Contexto legítimo | Latência p50 | Custo total em 3 execuções |
| --- | ---: | ---: | ---: |
| Gemini 3.7 Flash | 3/3 | 13,766 s | US$ 0,017428 |
| GPT-5.6 Luna | 2/3 | 7,690 s | US$ 0,003956 |
| GPT-5.6 Sol | 2/3 | 13,336 s | US$ 0,022138 |
| GPT-5.6 Terra | 0/3 | 3,544 s | US$ 0,011144 |

Não houve erro de provedor. As reprovações ocorreram porque o modelo devolveu
`OK` sem solicitar o contexto operacional ausente.

## Leitura técnica

- **Gemini 3.7 Flash** foi o mais estável para reconhecer contexto realmente
  externo, mas foi mais lento e mais caro que Luna nesta amostra.
- **Luna** apresentou a melhor relação custo/latência, porém oscilou em uma das
  três repetições.
- **Sol** teve a mesma estabilidade de Luna com custo maior nesta rodada.
- **Terra** foi o mais rápido, mas ignorou o contexto ausente em todas as
  repetições; nesta política ele não deve ser escolhido como avaliador apenas
  por velocidade.

## Recomendação

Não trocar produção com apenas este corpus. Manter a extração separada da
decisão e ampliar a verdade de referência sanitizada antes do corte final.
Para a próxima rodada:

1. testar Gemini 3.7 Flash e Luna como candidatos do **avaliador** em pelo menos
   30 casos representativos, com repetição e teto de custo;
2. comparar a **extração de PDF** em benchmark próprio, com os mesmos documentos
   sanitizados e campos esperados;
3. escolher o avaliador por precisão e estabilidade; usar custo e latência como
   critérios de desempate;
4. só alterar `OPENROUTER_AUDIT_MODEL` após validação humana dos resultados.

Conclusão atual: Gemini 3.7 Flash é o candidato técnico mais promissor para a
decisão contextual; Luna é o candidato econômico. A evidência ainda não é
suficiente para promover nenhum deles automaticamente à produção.
