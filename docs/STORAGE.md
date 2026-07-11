# Storage de notas fiscais

A WIN-17 usa um bucket privado do Supabase Storage para preservar os arquivos
originais enviados. PDF, JPG e PNG são aceitos até 10 MiB por padrão.

## Segurança e acesso

- Upload e geração de URL assinada acontecem exclusivamente no servidor.
- `SUPABASE_SERVICE_ROLE_KEY` nunca pode ser exposta em componentes client-side,
  respostas HTTP, logs ou variáveis com prefixo `NEXT_PUBLIC_`.
- Não existem políticas para acesso direto de `anon` ou `authenticated`. O
  bucket é privado e o backend usa a service role, que ignora RLS.
- Objetos usam o formato
  `obras/{obraId}/notas/{notaId}/{uuid}.{pdf|jpg|png}`. O nome original deve ser
  salvo como metadado da nota, não usado como chave do objeto.
- A leitura é entregue por URL assinada com cinco minutos de validade por
  padrão e limite máximo de uma hora.

## Uso no servidor

```ts
import {
  createInvoiceSignedUrl,
  uploadInvoiceFile,
} from "@/server/storage";

const stored = await uploadInvoiceFile({
  bytes: await file.arrayBuffer(),
  contentType: file.type,
  fileName: file.name,
  noteId,
  workId,
});

const preview = await createInvoiceSignedUrl({ path: stored.path });
```

O upload valida tamanho, MIME declarado, extensão e assinatura binária. A
persistência usa `upsert: false`, evitando sobrescrever um arquivo anterior.

## Provisionamento

A migration `20260711213000_configure_private_invoice_storage` cria ou corrige o
bucket `notas-fiscais` como privado, com limite de 10 MiB e os três MIME types.
Se o nome ou limite forem alterados, mantenha a migration/configuração do bucket
e as variáveis de ambiente consistentes.
