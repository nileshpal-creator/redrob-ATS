import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getOrganizationSettings } from "@/lib/services/organization";
import { InterviewReminderSettingsClient } from "@/components/admin/interview-reminder-settings-client";

export default async function InterviewReminderSettingsPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.ORGANIZATION, "READ");

  const organization = await getOrganizationSettings(context);
  const canEdit = await can(context, ENTITY.ORGANIZATION, "UPDATE");

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Interview Reminders</h1>
        <p className="text-muted-foreground">
          §11.5: automatic email reminders to the candidate and the interview panel, sent this many minutes
          before each scheduled interview. Applies to every interview org-wide — there is no per-interview
          override. An external scheduler must call <code>POST /api/scheduler/run</code> periodically for
          reminders to actually go out; see docs/api.md.
        </p>
      </div>
      <InterviewReminderSettingsClient
        initialLeadMinutes={organization.interviewReminderLeadMinutes}
        canEdit={canEdit}
      />
    </div>
  );
}
