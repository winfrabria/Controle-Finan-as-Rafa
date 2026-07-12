import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; erro?: string }>;
};

export default async function LoginRedirect({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const queryParts: string[] = [];
  if (params.next) queryParts.push(`next=${encodeURIComponent(params.next)}`);
  if (params.erro) queryParts.push(`erro=${encodeURIComponent(params.erro)}`);
  const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
  redirect(`/${query}`);
}
