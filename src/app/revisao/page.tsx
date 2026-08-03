import { prisma } from "@/server/db/prisma";
import { DashboardView } from "@/features/workspace-ui/portal-views";
import { listReviewerDashboardNotes } from "@/features/internal-notes/reviewer-dashboard-query";

export default async function ReviewPage() {
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
    listReviewerDashboardNotes({ sanitizeForReviewer: true }),
  ]);

  return <DashboardView role="reviewer" works={works} reviewerNotes={notes} />;
}
