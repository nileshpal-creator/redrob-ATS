-- Uniqueness on (templateId, language) should only apply among ACTIVE
-- versions — a full constraint would block ever creating a second draft
-- for the same language. Not representable in schema.prisma (no
-- partial-index syntax), so this is hand-written, same pattern as
-- pipeline_stage_active_name_unique.
CREATE UNIQUE INDEX "communication_template_version_active_unique"
  ON "CommunicationTemplateVersion" ("templateId", "language")
  WHERE "status" = 'ACTIVE';
