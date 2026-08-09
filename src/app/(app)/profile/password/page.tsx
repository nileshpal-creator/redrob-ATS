import { getSessionContext } from "@/lib/authz/session-context";
import { BackLink } from "@/components/layout/back-link";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export default async function ChangePasswordPage() {
  const context = await getSessionContext();
  if (!context) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <BackLink href="/profile" label="My profile" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Change password</h1>
        <p className="text-muted-foreground">You&apos;ll need your current password to set a new one.</p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
