import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { listCustomFieldDefinitions } from "@/lib/services/custom-fields";
import { listCustomObjectDefinitions } from "@/lib/services/custom-objects";
import { CustomFieldsClient } from "@/components/admin/custom-fields-client";

export default async function CustomFieldsPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.CUSTOM_FIELD_DEFINITION, "READ");

  const [fields, objects] = await Promise.all([
    listCustomFieldDefinitions(context),
    listCustomObjectDefinitions(context),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Custom Fields &amp; Objects</h1>
        <p className="text-muted-foreground">
          Core entities (Job, Candidate, ...) become field targets as their modules ship. Until
          then, attach custom fields to a Custom Object.
        </p>
      </div>
      <CustomFieldsClient initialFields={fields} initialObjects={objects} />
    </div>
  );
}
