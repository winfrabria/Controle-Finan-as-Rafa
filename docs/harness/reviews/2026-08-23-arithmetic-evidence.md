# Revisão de evidência aritmética 2026-08-23

## Problema reproduzido

Três dígitos lidos incorretamente em linhas fiscais alteraram os totais dos
itens. A diferença acumulada coincidiu com a divergência entre a soma extraída
e o total da nota, criando quatro falsos positivos a partir do mesmo erro de
leitura.

## Correção estrutural

1. `ITEM_ARITHMETIC_MISMATCH` exige `arithmeticVerified=true`.
2. `TOTAL_MISMATCH` é interrompido quando a camada selecionada contém uma
   divergência aritmética ainda não confirmada na imagem.
3. Valores acessórios como multa não são comparados ao total do boleto.
4. Vencimento não é comparado a emissão ou datas operacionais.
5. Nenhuma regra usa fornecedor, número, nome de arquivo ou valor real fixo.

## Regressão

O caso persistido que gerava quatro apontamentos foi reavaliado localmente e
passou a gerar zero achados determinísticos. Divergências aritméticas marcadas
como visualmente confirmadas continuam sendo detectadas.
