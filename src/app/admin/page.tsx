import { prisma } from "@/server/db/prisma";
import { DashboardView } from "@/features/workspace-ui/portal-views";
import { listReviewerDashboardNotes } from "@/features/internal-notes/reviewer-dashboard-query";

export default async function AdminPage() {
  const [works, notes] = await Promise.all([
    prisma.work.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
    listReviewerDashboardNotes(),
  ]);

  return <DashboardView role="admin" works={works} reviewerNotes={notes} />;
}
