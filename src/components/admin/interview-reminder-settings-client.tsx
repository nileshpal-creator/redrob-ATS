"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";

const PRESETS = [
  { label: "15 minutes before", minutes: 15 },
  { label: "30 minutes before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "2 hours before", minutes: 120 },
  { label: "4 hours before", minutes: 240 },
  { label: "1 day before", minutes: 1440 },
  { label: "2 days before", minutes: 2880 },
];

/**
 * A fixed preset list rather than free-text minute entry — simpler and
 * error-proof for the one setting this page exposes (§11.5: "configurable
 * intervals"), without inventing a general-purpose duration-picker
 * component this codebase has no other use for yet.
 */
export function InterviewReminderSettingsClient({
  initialLeadMinutes,
  canEdit,
}: {
  initialLeadMinutes: number[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set(initialLeadMinutes));
  const [saving, setSaving] = useState(false);

  function toggle(minutes: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(minutes)) next.delete(minutes);
      else next.add(minutes);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const response = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewReminderLeadMinutes: Array.from(selected) }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to save.");
      }
      toast.success("Interview reminder settings saved.");
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
          {PRESETS.map((preset) => (
            <label key={preset.minutes} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(preset.minutes)}
                disabled={!canEdit}
                onCheckedChange={() => toggle(preset.minutes)}
              />
              {preset.label}
            </label>
          ))}
        </div>
        {selected.size === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders selected — automatic reminders are off.</p>
        ) : null}
        {canEdit ? (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
