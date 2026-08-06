"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ExperienceEntry = {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
};

const EMPTY_ENTRY: ExperienceEntry = { company: "", title: "", startDate: "", endDate: "", description: "" };

/** Repeatable work-history entries — §11.2 "store ... professional ... data". */
export function ExperienceHistoryEditor({
  value,
  onChange,
  disabled,
}: {
  value: ExperienceEntry[];
  onChange: (next: ExperienceEntry[]) => void;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<ExperienceEntry>) {
    onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {value.map((entry, index) => (
        <div key={index} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Company</Label>
            <Input
              disabled={disabled}
              value={entry.company}
              onChange={(event) => update(index, { company: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              disabled={disabled}
              value={entry.title}
              onChange={(event) => update(index, { title: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Start date</Label>
            <Input
              type="date"
              disabled={disabled}
              value={entry.startDate}
              onChange={(event) => update(index, { startDate: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End date (blank = current)</Label>
            <Input
              type="date"
              disabled={disabled}
              value={entry.endDate}
              onChange={(event) => update(index, { endDate: event.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Description</Label>
            <Textarea
              disabled={disabled}
              rows={2}
              value={entry.description}
              onChange={(event) => update(index, { description: event.target.value })}
            />
          </div>
          {!disabled ? (
            <div className="sm:col-span-2">
              <Button type="button" variant="outline" size="sm" onClick={() => remove(index)}>
                <Trash2 /> Remove
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {!disabled ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { ...EMPTY_ENTRY }])}>
          <Plus /> Add experience
        </Button>
      ) : null}
      {value.length === 0 && disabled ? <p className="text-sm text-muted-foreground">No experience listed.</p> : null}
    </div>
  );
}
