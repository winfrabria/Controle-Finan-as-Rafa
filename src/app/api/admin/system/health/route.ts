import { GET as getHealth } from "../../ai/health/route";

export const runtime = "nodejs";

export async function GET() {
  return getHealth();
}
