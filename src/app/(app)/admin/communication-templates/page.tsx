import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { listCommunicationTemplates } from "@/lib/services/communication-templates";
import { CommunicationTemplatesClient } from "@/components/admin/communication-templates-client";

export default async function CommunicationTemplatesPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.COMMUNICATION_TEMPLATE, "READ");

  const templates = await listCommunicationTemplates(context, {});

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Communication Templates</h1>
        <p className="text-muted-foreground">
          Email templates recruiters pick from when sending bulk email to applications. Use{" "}
          <code>{"{{candidate.name}}"}</code> and <code>{"{{job.title}}"}</code> as placeholders.
        </p>
      </div>
      <CommunicationTemplatesClient initialTemplates={templates} />
    </div>
  );
}
