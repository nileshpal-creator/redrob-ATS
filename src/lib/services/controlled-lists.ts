import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";

/**
 * Not permission-gated, same reasoning as listCustomFieldDefinitions: a
 * list's active values are reference data every form needs to render a
 * dropdown (Department, Location, a hold/close/cancel reason), not
 * business data. Managing lists (create/rename/deactivate a value) would
 * be a separate, admin-gated capability if/when that admin screen ships —
 * this only ever reads.
 */
export async function getControlledListValues(key: string) {
  const list = await prisma.controlledList.findUnique({
    where: { key },
    include: { values: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
  });

  if (!list) {
    throw new NotFoundError(`Controlled list "${key}" not found.`);
  }

  return { key: list.key, label: list.label, values: list.values };
}
