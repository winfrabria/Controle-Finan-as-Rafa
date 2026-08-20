import "server-only";

export type WebPushConfig = {
  privateKey: string;
  publicKey: string;
  subject: string;
};

function validSubject(value: string) {
  return value.startsWith("mailto:") || value.startsWith("https://");
}

export function getWebPushConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebPushConfig | null {
  const publicKey = environment.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = environment.WEB_PUSH_VAPID_SUBJECT?.trim();

  if (
    !publicKey ||
    publicKey.length < 80 ||
    !privateKey ||
    privateKey.length < 40 ||
    !subject ||
    !validSubject(subject)
  ) {
    return null;
  }

  return { privateKey, publicKey, subject };
}

export function getWebPushPublicStatus(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = getWebPushConfig(environment);
  return {
    configured: Boolean(config),
    publicKey: config?.publicKey ?? null,
  };
}
