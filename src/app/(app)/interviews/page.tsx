import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { listInterviews } from "@/lib/services/interviews";
import { listUsers } from "@/lib/services/users";
import { listJobs } from "@/lib/services/jobs";
import { interviewQuerySchema } from "@/lib/validations/interview";
import { jobQuerySchema } from "@/lib/validations/job";
import { InterviewCalendarClient } from "@/components/interviews/interview-calendar-client";

/** Monday-start week containing `date`, at UTC day boundaries — matches how scheduledAt is stored/compared. */
function weekRange(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDayOfWeek = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (isoDayOfWeek - 1));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

export default async function InterviewsPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.INTERVIEW, "READ");

  const { start, end } = weekRange(new Date());

  const [result, canViewUsers, jobsResult] = await Promise.all([
    listInterviews(
      context,
      interviewQuerySchema.parse({ dateFrom: start.toISOString(), dateTo: end.toISOString(), pageSize: 100 }),
    ),
    can(context, ENTITY.USER, "READ"),
    listJobs(context, jobQuerySchema.parse({ pageSize: 100 })),
  ]);
  const users = canViewUsers ? await listUsers(context) : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Interview Calendar</h1>
        <p className="text-muted-foreground">
          Interviews you can see, based on your role&apos;s access. Filter by recruiter or job to narrow the week.
        </p>
      </div>
      <InterviewCalendarClient
        initialResult={JSON.parse(JSON.stringify(result))}
        initialWeekStart={start.toISOString()}
        recruiters={users.filter((user) => user.isActive).map((user) => ({ id: user.id, name: user.name }))}
        jobs={jobsResult.jobs.map((job) => ({ id: job.id, title: job.title }))}
      />
    </div>
  );
}
