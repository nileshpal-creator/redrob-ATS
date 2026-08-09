import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * This repo has no component-rendering test harness (no jsdom/React
 * Testing Library — every other test in tests/services is a Node-runtime
 * service-layer test against a real Postgres instance). The fixes these
 * tests guard are pure client-component wiring (an aria-label, a
 * confirmation dialog, a .catch handler, a new link) with no service-layer
 * counterpart to exercise instead. Rather than skip regression coverage
 * for that reason, these read each file's actual source and assert the
 * specific markers the fix introduced are still present — a real, if
 * lightweight, guard against someone reverting the wiring later, even
 * though it can't verify runtime behavior the way a rendered-component
 * test would.
 */
function readSrc(relativePath: string): string {
  return readFileSync(join(process.cwd(), "src", relativePath), "utf8");
}

describe("Destructive-delete confirmation + accessibility (audit fixes)", () => {
  it("Roles: delete button has an aria-label and is wrapped in a confirmation dialog", () => {
    const source = readSrc("components/admin/roles-client.tsx");
    expect(source).toContain("ConfirmDeleteDialog");
    expect(source).toMatch(/aria-label=\{`Delete \$\{row\.original\.name\}`\}/);
    // handleDelete must rethrow so ConfirmDeleteDialog knows to keep the
    // dialog open on failure instead of closing on both outcomes.
    expect(source).toMatch(/catch \(error\) \{\s*toast\.error\([^)]*\);\s*throw error;/);
  });

  it("Custom Fields & Objects: both field and object delete buttons are labeled and confirmed", () => {
    const source = readSrc("components/admin/custom-fields-client.tsx");
    const confirmDialogUsages = source.match(/ConfirmDeleteDialog/g) ?? [];
    expect(confirmDialogUsages.length).toBeGreaterThanOrEqual(2); // import + at least 2 usages, or 3 total
    expect(source).toMatch(/aria-label=\{`Delete \$\{row\.original\.label\}`\}/);
    expect(source).toMatch(/aria-label=\{`Delete \$\{row\.original\.name\}`\}/);
    expect(source.match(/throw error;/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("Custom Object Records: record delete and relation unlink are both labeled and confirmed", () => {
    const source = readSrc("components/admin/custom-object-records-client.tsx");
    expect(source).toContain("ConfirmDeleteDialog");
    expect(source).toMatch(/aria-label=\{`Delete record \$\{row\.original\.id\}`\}/);
    expect(source).toMatch(/aria-label=\{`Unlink \$\{relation\.relatedEntityType\}/);
    expect(source.match(/throw error;/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Picker fetch-error handling (audit fixes)", () => {
  const pickers = [
    "components/interviews/panelist-picker.tsx",
    "components/jobs/recruiter-picker.tsx",
    "components/custom-fields/custom-fields-form-section.tsx",
  ];

  it.each(pickers)("%s checks response.ok, catches failures, and surfaces a toast + fallback UI", (path) => {
    const source = readSrc(path);
    expect(source).toContain("if (!response.ok) throw new Error(");
    expect(source).toContain(".catch(");
    expect(source).toContain("toast.error(");
    expect(source).toContain("loadError");
  });
});

describe("Job detail: direct application-creation action (audit fix)", () => {
  it("links to the application form pre-filled with this job", () => {
    const source = readSrc("components/jobs/job-detail-client.tsx");
    expect(source).toContain("/applications/new?jobId=${job.id}");
    expect(source).toContain("canCreateApplication");
  });

  it("the job detail page computes and passes canCreateApplication down", () => {
    const source = readSrc("app/(app)/jobs/[id]/page.tsx");
    expect(source).toMatch(/can\(context, ENTITY\.APPLICATION, "CREATE"\)/);
    expect(source).toContain("canCreateApplication={canCreateApplication}");
  });
});
