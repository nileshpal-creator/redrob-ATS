import Link from "next/link";
import { KeyRound } from "lucide-react";

import { getSessionContext } from "@/lib/authz/session-context";
import { getOwnProfile } from "@/lib/services/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ProfilePage() {
  const context = await getSessionContext();
  if (!context) return null;

  const profile = await getOwnProfile(context);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-muted-foreground">Your account details and role assignments.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{profile.name}</span>
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{profile.email}</span>
            <span className="text-muted-foreground">Roles</span>
            <div className="flex flex-wrap gap-1">
              {profile.roles.map(({ role }) => (
                <Badge key={role.id} variant={role.isSuperAdmin ? "default" : "secondary"}>
                  {role.name}
                </Badge>
              ))}
            </div>
            <span className="text-muted-foreground">Last login</span>
            <span>{profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : "Never"}</span>
            <span className="text-muted-foreground">Member since</span>
            <span>{new Date(profile.createdAt).toLocaleDateString()}</span>
          </div>

          <Button variant="outline" asChild>
            <Link href="/profile/password">
              <KeyRound /> Change password
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
