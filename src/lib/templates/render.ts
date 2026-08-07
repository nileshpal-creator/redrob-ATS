/**
 * Minimal `{{key}}` substitution — the "template infrastructure" the bulk
 * email feature needs (§11.4), deliberately not the full Template Designer
 * (§10.4: multi-language variants, conditional blocks, approval workflow),
 * which is a separate, not-yet-built module. Unknown keys are left as-is
 * rather than throwing, so a typo in a placeholder degrades to visible text
 * instead of failing the whole render.
 */
export function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => context[key] ?? match);
}
