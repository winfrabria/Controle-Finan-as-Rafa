import { prisma } from "@/server/db/prisma";
import { DashboardView } from "@/features/workspace-ui/portal-views";

export default async function ReviewPage() {
  const works = await prisma.work.findMany({
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  return <DashboardView role="reviewer" works={works} />;
}
