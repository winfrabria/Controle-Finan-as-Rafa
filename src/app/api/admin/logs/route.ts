import { GET as listLogs } from "../ai/logs/route";

export const runtime = "nodejs";

export async function GET(request: Parameters<typeof listLogs>[0]) {
  return listLogs(request);
}
