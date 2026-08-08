"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

/** Mirrors organizationSettingsUpdateSchema's own cap (src/lib/validations/organization.ts). */
const MAX_THRESHOLD_DAYS = 90;

/**
 * §11.6: the org-wide default TAT threshold, editable independently of
 * Interview Reminders' own settings screen — both PATCH the same
 * Organization singleton via /api/organization, but each screen sends only
 * the one field it owns (updateOrganizationSettings applies exactly what's
 * provided), so saving here never touches the reminder-lead-times setting.
 */
export function OfferTatSettingsClient({
  initialThresholdDays,
  canEdit,
}: {
  initialThresholdDays: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialThresholdDays));
  const [saving, setSaving] = useState(false);

  const parsed = Number(value);
  const isValid = Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_THRESHOLD_DAYS;

  async function handleSave() {
    if (!isValid) {
      toast.error(`Enter a whole number of days between 1 and ${MAX_THRESHOLD_DAYS}.`);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerTatThresholdDays: parsed }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to save.");
      }
      toast.success("Offer TAT threshold saved.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          <Label>Default TAT threshold (business days)</Label>
          <Input
            type="number"
            min={1}
            max={MAX_THRESHOLD_DAYS}
            value={value}
            disabled={!canEdit}
            onChange={(event) => setValue(event.target.value)}
            className="w-32"
          />
        </div>
        {canEdit ? (
          <Button onClick={handleSave} disabled={saving || !isValid}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
