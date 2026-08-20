# Notificações do PWA

O MVP usa Web Push padrão com VAPID. Não depende de Firebase nem OneSignal.

## Quando o aviso é enviado

- somente após uma auditoria terminar como `SUSPICIOUS`;
- um envio por aparelho inscrito do perfil REVIEWER;
- o texto da tela bloqueada é genérico e não inclui fornecedor, valor, arquivo ou diagnóstico;
- o clique abre o anexo na área autenticada de Notas;
- falhas temporárias ficam na fila e não alteram o processamento da nota.

## Configuração por ambiente

Gere um par VAPID uma única vez para cada ambiente com a ferramenta do pacote
`web-push` e salve os valores diretamente no gerenciador de segredos:

```text
NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY
WEB_PUSH_VAPID_SUBJECT=mailto:suporte@winfrabr.com.br
```

A chave privada existe somente no servidor. Depois de alterar as variáveis na
Vercel, é necessário um novo deploy.

## Operação

1. Aplicar a migration `20260820123000_add_web_push_delivery`.
2. Abrir **Meu perfil** no aparelho do Rafael.
3. Tocar em **Ativar neste aparelho** e aceitar a permissão do navegador.
4. Usar **Enviar teste** para validar o aparelho.
5. Processar um anexo suspeito e conferir o clique na notificação.

O worker já existente também drena tentativas pendentes. O endpoint dedicado
`/api/internal/push/worker` aceita o mesmo bearer secret do worker de IA.

## Compatibilidade

- Android: Chrome/Edge e PWA instalado ou navegador compatível.
- iPhone/iPad: iOS/iPadOS 16.4 ou superior, aplicativo adicionado à Tela de
  Início e permissão solicitada por ação direta do usuário.
- localhost é considerado contexto seguro; para outros endereços, use HTTPS.
