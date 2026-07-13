import { GET as listRuns } from "../ai/runs/route";

export const runtime = "nodejs";

export async function GET(request: Parameters<typeof listRuns>[0]) {
  return listRuns(request);
}
