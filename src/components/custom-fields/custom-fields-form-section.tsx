"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

type DropdownOptions = { choices: { value: string; label: string }[] };

type CustomFieldDefinition = {
  id: string;
  key: string;
  label: string;
  fieldType: "TEXT" | "NUMBER" | "DATE" | "DROPDOWN" | "MULTI_SELECT" | "LOOKUP";
  isRequired: boolean;
  isActive: boolean;
  options: DropdownOptions | { targetEntityType: string } | null;
};

/**
 * Renders one input per active CustomFieldDefinition for `entityType`
 * (§10.1: fields an admin added without engineering involvement). Generic
 * across entities — Job is the first consumer, any later module's
 * create/edit form reuses this unchanged by passing its own entityType.
 */
export function CustomFieldsFormSection({
  entityType,
  value,
  onChange,
  disabled,
}: {
  entityType: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/custom-fields?entityType=${encodeURIComponent(entityType)}`)
      .then((response) => response.json())
      .then((data: CustomFieldDefinition[]) => {
        if (!cancelled) setDefinitions(data.filter((definition) => definition.isActive));
      });
    return () => {
      cancelled = true;
    };
  }, [entityType]);

  if (definitions === null) {
    return <Skeleton className="h-20 w-full" />;
  }

  if (definitions.length === 0) {
    return null;
  }

  function setField(key: string, fieldValue: unknown) {
    onChange({ ...value, [key]: fieldValue });
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <p className="text-sm font-medium text-muted-foreground">Additional fields</p>
      {definitions.map((definition) => (
        <div key={definition.id} className="space-y-2">
          <Label>
            {definition.label}
            {definition.isRequired ? <span className="text-destructive"> *</span> : null}
          </Label>
          <CustomFieldInput
            definition={definition}
            value={value[definition.key]}
            onChange={(next) => setField(definition.key, next)}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}

function CustomFieldInput({
  definition,
  value,
  onChange,
  disabled,
}: {
  definition: CustomFieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  switch (definition.fieldType) {
    case "NUMBER":
      return (
        <Input
          type="number"
          disabled={disabled}
          value={typeof value === "number" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      );
    case "DATE":
      return (
        <Input
          type="date"
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "DROPDOWN": {
      const options = (definition.options as DropdownOptions | null)?.choices ?? [];
      return (
        <Select
          disabled={disabled}
          value={typeof value === "string" ? value : undefined}
          onValueChange={onChange}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "MULTI_SELECT": {
      const options = (definition.options as DropdownOptions | null)?.choices ?? [];
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1.5 rounded-md border p-2">
          {options.map((choice) => (
            <label key={choice.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                disabled={disabled}
                checked={selected.includes(choice.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...selected, choice.value]
                      : selected.filter((item) => item !== choice.value),
                  )
                }
              />
              {choice.label}
            </label>
          ))}
        </div>
      );
    }
    case "LOOKUP":
    case "TEXT":
    default:
      return (
        <Input
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
