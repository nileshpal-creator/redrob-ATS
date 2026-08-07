import { prisma } from "@/lib/prisma";

/**
 * Business-day arithmetic for TAT/SLA reporting (§11.12's "Offer/TAT
 * compliance reporting"). Reads the single Organization row's
 * workingDays/holidays — seeded in Module 1 as "foundation for future
 * SLA/TAT clocks" (see docs/project-status.md) but never consumed by any
 * service until this module.
 */
export type WorkingCalendar = {
  /** 0=Sunday..6=Saturday, matching Date#getUTCDay() — see Organization.workingDays. */
  workingDays: number[];
  /** "YYYY-MM-DD" for one-off holidays, "*-MM-DD" for recurringYearly ones. */
  holidayKeys: Set<string>;
};

function holidayKey(date: Date, recurringYearly: boolean): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return recurringYearly ? `*-${month}-${day}` : `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * The org's calendar is a DB singleton (see the Organization model comment
 * in schema.prisma) — this reads whichever row exists, or falls back to a
 * plain Mon-Fri calendar with no holidays if the organization hasn't been
 * seeded yet, matching Organization's own column defaults exactly.
 */
export async function getWorkingCalendar(): Promise<WorkingCalendar> {
  const organization = await prisma.organization.findFirst({ include: { holidays: true } });

  const holidayKeys = new Set<string>();
  for (const holiday of organization?.holidays ?? []) {
    holidayKeys.add(holidayKey(holiday.date, holiday.recurringYearly));
  }

  return { workingDays: organization?.workingDays ?? [1, 2, 3, 4, 5], holidayKeys };
}

function isNonWorkingDay(date: Date, calendar: WorkingCalendar): boolean {
  if (!calendar.workingDays.includes(date.getUTCDay())) return true;

  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return (
    calendar.holidayKeys.has(`${date.getUTCFullYear()}-${month}-${day}`) ||
    calendar.holidayKeys.has(`*-${month}-${day}`)
  );
}

/**
 * Whole working days elapsed strictly after `from`'s calendar day, up to and
 * including `to`'s calendar day — i.e. "how many business days did this
 * take." Returns 0 whenever `to` is on or before `from`'s calendar day
 * (same-day turnaround counts as 0 business days elapsed, not 1).
 */
export function businessDaysBetween(from: Date, to: Date, calendar: WorkingCalendar): number {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  if (end.getTime() <= cursor.getTime()) return 0;

  let count = 0;
  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isNonWorkingDay(cursor, calendar)) count += 1;
  }

  return count;
}
