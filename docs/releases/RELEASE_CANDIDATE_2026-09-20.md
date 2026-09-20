# Release candidate — auditoria de notas — 2026-09-20

## Estado

**Código pronto para homologação controlada. Produção ainda não foi alterada.** A promoção exige confirmação explícita e a execução dos passos de pré-deploy abaixo.

## O que mudou

- Extração e auditoria passaram a trabalhar por janelas de páginas, checkpoint e consolidação, evitando o corte fixo de evidências que escondia itens de documentos longos.
- A decisão final separa documento sem achado, achado suspeito e falha técnica real. Ausência de cobertura não é convertida silenciosamente em `OK`.
- Uma saída interna `INFORMATION_INSUFFICIENT` passa a persistir como `READ_FAILED`, e registros legados equivalentes deixam de ser exibidos como `OK`.
- Comparações de valor e data usam a hierarquia documental e preservam as fontes observadas. A interface apresenta `Encontrado`, `Esperado/referência`, diferença e localização quando há base comprovável; quando não há referência confiável, não inventa um esperado.
- Falsos positivos de soma de itens foram corrigidos: linhas componentes que fecham o total não são tratadas como divergência do próprio comprovante.
- Duplicidade passou a exigir identidade fiscal/financeira suficiente, reduzindo associação apenas por valor ou texto parecido.
- A tela de revisão e o PWA foram simplificados: estado `OK` não ocupa um card grande, falha técnica não aparece como diagnóstico válido e o documento completo tem visualizador/fallback próprios.
- Upload público ganhou limite atômico por janela, global e por obra, com resposta HTTP `429` e `Retry-After`.
- O build recebeu cabeçalhos globais de segurança e empacotamento verificável do visualizador PDF.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| Harness completo com integrações locais | 737/737 testes aprovados |
| Detalhe da nota | 44/44 aprovados |
| Upload e revisão | 77/77 aprovados |
| Fluxo público | 10/10 aprovados |
| PWA | 37/37 aprovados |
| Push e políticas HTTP | 41/41 aprovados |
| Autorização | 8/8 aprovados |
| Obras com banco isolado | 10/10 aprovados |
| Limite concorrente de upload | 2 aceitos e 3 bloqueados para limite 2; sem Note, Event, Job ou Storage nos bloqueados |
| ESLint | aprovado com zero warnings |
| TypeScript | aprovado |
| Prisma format/validate/migrate | aprovado no banco local isolado |
| Build Next de produção | aprovado; 44 páginas geradas |
| Worker de PDF pós-build | aprovado em página completa 2400x1800 e sem chamada de modelo |
| Segurança do repositório | uma falha alta encontrada e corrigida: exaustão por upload público |

## Validação real isolada

A nota `000.001.282`, de Neuracy Argolo Costa, foi reprocessada de ponta a ponta no ambiente isolado depois da correção do estado inconclusivo. O processamento terminou como `OK`, sem achados abertos, com garantia `MEDIUM` e sem código de falha. Esse resultado veio de uma nova extração, auditoria e verificação; não foi conversão visual de um diagnóstico incompleto.

- Tempo total: 133,3 s.
- Extração (`google/gemini-3.7-flash`, `HIGH`): 58,5 s e US$ 0,044336.
- Auditoria (`google/gemini-3.8-flash`, `LOW`): 8,9 s e US$ 0,011772.
- Verificação (`google/gemini-3.8-flash`, `MEDIUM`): 64,2 s e US$ 0,0444015.
- Custo total observado: aproximadamente US$ 0,10051.

O gargalo medido está na extração e na verificação, não na auditoria. Uma única nota não sustenta trocar o modelo ou reduzir o esforço do verificador globalmente sem risco de regressão. Portanto, esta release preserva a rota de maior qualidade e registra latência como ponto de otimização posterior por benchmark de corpus, com teto de custo e critérios de cobertura.

## Dependências

O `npm audit --omit=dev` ainda lista quatro registros `high`, sem `critical`, nas cadeias do CLI Prisma. Nenhum dos pacotes afetados apareceu nos 61 traces do servidor compilado e a aplicação usa PostgreSQL, não MySQL. A decisão, os controles e o prazo estão registrados em `docs/security/EXCECAO_DEPENDENCIAS_2026-09-20.md`.

## Configuração obrigatória

Definir explicitamente no ambiente de produção:

```text
PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS=3600
PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL=120
PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK=30
```

Os valores são ponto de partida conservador e devem ser ajustados com métricas reais. A proteção da aplicação não substitui rate limit no proxy/CDN/WAF.

## Pré-deploy obrigatório

1. Confirmar backup recente do PostgreSQL e testar que o procedimento de restauração está acessível.
2. Validar secrets e URLs do Supabase/OpenRouter sem imprimi-los em log.
3. Aplicar `prisma migrate deploy`; as migrações adicionam o índice em `notes.created_at` e normalizam resultados legados inconclusivos, sem apagar documentos ou achados.
4. Garantir que o runtime web não instala nem executa o CLI Prisma.
5. Publicar primeiro em homologação com configuração equivalente à produção.
6. Executar um upload canário, acompanhar extração, auditoria, fila, custo e visualização do PDF.
7. Validar instalação/atualização do PWA em pelo menos um Android físico e um iPhone físico.
8. Conferir `429` e `Retry-After` no edge, além do limite interno.
9. Promover para produção somente após confirmação explícita do responsável pela release.

## Rollback

- Reverter o artefato da aplicação para a versão anterior.
- Manter o índice `notes_created_at_idx`: ele é aditivo e não altera dados nem contratos.
- Se a fila crescer ou o provedor degradar, interromper novos uploads no edge antes de drenar/reprocessar jobs.
- Não apagar notas, evidências ou execuções durante rollback; preservar material de diagnóstico.

## Limites desta conclusão

Testes locais e build aprovado não comprovam comportamento do provedor, rede, secrets, CDN/WAF, banco e dispositivos reais de produção. A latência real de 133,3 s também ainda precisa ser confrontada com o SLA esperado. Por isso o estado é **GO condicional para homologação**, não autorização automática de produção.
