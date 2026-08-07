import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_PIPELINE_STAGE_NAMES, seedDefaultPipelineStages } from "../src/lib/services/pipeline-stages";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * One-time backfill for jobs created before Module 4: Application.stageId is
 * required, so a job needs at least one PipelineStage before it can accept
 * an application. createJob (src/lib/services/jobs.ts) seeds this default
 * set going forward; this script covers jobs that predate that change.
 * Idempotent — skips any job that already has at least one stage, so it's
 * safe to re-run.
 *
 * Run once against each environment after deploying the Module 4 migration:
 *   npx tsx prisma/backfill-pipeline-stages.ts
 */
async function main() {
  const jobsWithoutStages = await prisma.job.findMany({
    where: { pipelineStages: { none: {} } },
    select: { id: true, title: true },
  });

  if (jobsWithoutStages.length === 0) {
    console.log("No jobs are missing pipeline stages — nothing to backfill.");
    return;
  }

  for (const job of jobsWithoutStages) {
    await seedDefaultPipelineStages(prisma, job.id);
    console.log(
      `Seeded default pipeline (${DEFAULT_PIPELINE_STAGE_NAMES.join(", ")}) for job "${job.title}" (${job.id})`,
    );
  }

  console.log(`Backfilled pipeline stages for ${jobsWithoutStages.length} job(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
