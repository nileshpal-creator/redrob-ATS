/**
 * Minimal `{{key}}` substitution — the "template infrastructure" the bulk
 * email feature needs (§11.4). `{{#if key}}...{{else}}...{{/if}}` and
 * `{{#if key==value}}`/`{{#if key!=value}}` conditional blocks (§10.4) are
 * evaluated first, against the exact same flat `context` map, then plain
 * `{{key}}` substitution runs over what's left — so every existing caller
 * (bulkEmailApplications, interview reminders/notifications, the workflow
 * SEND_EMAIL action) gets conditional-block support for free without
 * changing how it builds `context` or calls this function. Unknown `{{key}}`
 * placeholders are left as-is rather than throwing, so a typo degrades to
 * visible text instead of failing the whole render. Blocks don't nest —
 * same AND-only, no-nesting scope-down already used for WorkflowCondition
 * and Dashboard's own filter DSL.
 */
const CONDITIONAL_BLOCK = /\{\{#if\s+([\w.]+)\s*(==|!=)?\s*([^}]*?)\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;

function evaluateConditionalBlocks(template: string, context: Record<string, string>): string {
  return template.replace(
    CONDITIONAL_BLOCK,
    (_match, key: string, operator: "==" | "!=" | undefined, comparand: string, truthyBlock: string, falsyBlock = "") => {
      const actual = context[key];
      let matches: boolean;
      if (operator === "==") {
        matches = actual === comparand.trim();
      } else if (operator === "!=") {
        matches = actual !== comparand.trim();
      } else {
        matches = Boolean(actual) && actual !== "false" && actual !== "0";
      }
      return matches ? truthyBlock : falsyBlock;
    },
  );
}

export function renderTemplate(template: string, context: Record<string, string>): string {
  const withConditionals = evaluateConditionalBlocks(template, context);
  return withConditionals.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => context[key] ?? match);
}
