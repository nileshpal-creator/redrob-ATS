"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type EducationEntry = {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startYear: string;
  endYear: string;
};

const EMPTY_ENTRY: EducationEntry = { institution: "", degree: "", fieldOfStudy: "", startYear: "", endYear: "" };

/** Repeatable education entries — §11.2 "store ... education ... data". */
export function EducationHistoryEditor({
  value,
  onChange,
  disabled,
}: {
  value: EducationEntry[];
  onChange: (next: EducationEntry[]) => void;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<EducationEntry>) {
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
            <Label>Institution</Label>
            <Input
              disabled={disabled}
              value={entry.institution}
              onChange={(event) => update(index, { institution: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Degree</Label>
            <Input
              disabled={disabled}
              value={entry.degree}
              onChange={(event) => update(index, { degree: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Field of study</Label>
            <Input
              disabled={disabled}
              value={entry.fieldOfStudy}
              onChange={(event) => update(index, { fieldOfStudy: event.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start year</Label>
              <Input
                type="number"
                disabled={disabled}
                value={entry.startYear}
                onChange={(event) => update(index, { startYear: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End year</Label>
              <Input
                type="number"
                disabled={disabled}
                value={entry.endYear}
                onChange={(event) => update(index, { endYear: event.target.value })}
              />
            </div>
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
          <Plus /> Add education
        </Button>
      ) : null}
      {value.length === 0 && disabled ? <p className="text-sm text-muted-foreground">No education listed.</p> : null}
    </div>
  );
}
