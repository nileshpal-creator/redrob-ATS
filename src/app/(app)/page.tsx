import Link from "next/link";

import { getSessionContext } from "@/lib/authz/session-context";
import { adminNav } from "@/config/nav";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const context = await getSessionContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {context?.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground">
          Module 1 (Foundation, RBAC & Customization Engine) is live. Recruiting
          modules — requisitions, candidates, pipeline — land in the next modules.
        </p>
      </div>

      {context?.isSuperAdmin ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {adminNav.map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardHeader>
                  <item.icon className="size-5 text-muted-foreground" />
                  <CardTitle className="text-base">{item.title}</CardTitle>
                  <CardDescription>Manage from the admin area</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
