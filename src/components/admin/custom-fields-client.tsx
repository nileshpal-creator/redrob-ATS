"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import {
  customObjectDefinitionSchema,
  type CustomObjectDefinitionInput,
} from "@/lib/validations/custom-object";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type CustomObjectRow = {
  id: string;
  apiKey: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

type CustomFieldRow = {
  id: string;
  entityType: string;
  key: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  isActive: boolean;
};

const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "DROPDOWN", "MULTI_SELECT", "LOOKUP"] as const;

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function AddCustomObjectDialog({ onCreated }: { onCreated: (object: CustomObjectRow) => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<CustomObjectDefinitionInput>({
    resolver: zodResolver(customObjectDefinitionSchema),
    defaultValues: { apiKey: "", name: "", description: "", isActive: true },
  });

  async function onSubmit(values: CustomObjectDefinitionInput) {
    try {
      const object = await requestJson("/api/custom-objects", {
        method: "POST",
        body: JSON.stringify(values),
      });
      onCreated(object);
      toast.success(`Custom object "${object.name}" created.`);
      setOpen(false);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create custom object");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add custom object
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add custom object</DialogTitle>
          <DialogDescription>e.g. &quot;Vendor&quot; or &quot;Assessment Result&quot;.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);
                        if (!form.getFieldState("apiKey").isTouched) {
                          form.setValue("apiKey", slugify(event.target.value));
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API key</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
                Create
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function AddCustomFieldDialog({
  objects,
  onCreated,
}: {
  objects: CustomObjectRow[];
  onCreated: (field: CustomFieldRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [entityType, setEntityType] = useState("");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]>("TEXT");
  const [isRequired, setIsRequired] = useState(false);
  const [choicesText, setChoicesText] = useState("");
  const [lookupTarget, setLookupTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEntityType("");
    setKey("");
    setLabel("");
    setFieldType("TEXT");
    setIsRequired(false);
    setChoicesText("");
    setLookupTarget("");
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const options =
        fieldType === "DROPDOWN" || fieldType === "MULTI_SELECT"
          ? {
              choices: choicesText
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => ({ value: slugify(line), label: line })),
            }
          : fieldType === "LOOKUP"
            ? { targetEntityType: lookupTarget }
            : undefined;

      const field = await requestJson("/api/custom-fields", {
        method: "POST",
        body: JSON.stringify({
          entityType,
          key,
          label,
          fieldType,
          isRequired,
          isActive: true,
          sortOrder: 0,
          options,
        }),
      });
      onCreated(field);
      toast.success(`Field "${field.label}" added to ${field.entityType}.`);
      setOpen(false);
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create field");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={objects.length === 0}>
          <Plus /> Add field
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add custom field</DialogTitle>
          <DialogDescription>
            Enforced server-side on every create/update of records on this entity.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Entity</label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a custom object" />
              </SelectTrigger>
              <SelectContent>
                {objects.map((object) => (
                  <SelectItem key={object.apiKey} value={object.apiKey}>
                    {object.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Label</label>
            <Input
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setKey((prev) => (prev === "" || prev === slugify(label) ? slugify(event.target.value) : prev));
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Key</label>
            <Input value={key} onChange={(event) => setKey(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Field type</label>
            <Select value={fieldType} onValueChange={(value) => setFieldType(value as typeof fieldType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {fieldType === "DROPDOWN" || fieldType === "MULTI_SELECT" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Choices (one per line)</label>
              <Textarea
                value={choicesText}
                onChange={(event) => setChoicesText(event.target.value)}
                placeholder={"Full-time\nPart-time\nContract"}
              />
            </div>
          ) : null}

          {fieldType === "LOOKUP" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Target entity</label>
              <Input value={lookupTarget} onChange={(event) => setLookupTarget(event.target.value)} />
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isRequired} onCheckedChange={(checked) => setIsRequired(checked === true)} />
            Required
          </label>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !entityType || !key || !label}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Add field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomFieldsClient({
  initialFields,
  initialObjects,
}: {
  initialFields: CustomFieldRow[];
  initialObjects: CustomObjectRow[];
}) {
  const [fields, setFields] = useState(initialFields);
  const [objects, setObjects] = useState(initialObjects);

  async function handleDeleteField(field: CustomFieldRow) {
    try {
      await requestJson(`/api/custom-fields/${field.id}`, { method: "DELETE" });
      setFields((prev) => prev.filter((row) => row.id !== field.id));
      toast.success(`Field "${field.label}" deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete field");
    }
  }

  async function handleDeleteObject(object: CustomObjectRow) {
    try {
      await requestJson(`/api/custom-objects/${object.id}`, { method: "DELETE" });
      setObjects((prev) => prev.filter((row) => row.id !== object.id));
      toast.success(`Custom object "${object.name}" deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete custom object");
    }
  }

  const fieldColumns: ColumnDef<CustomFieldRow, unknown>[] = [
    { header: "Entity", accessorKey: "entityType" },
    { header: "Label", accessorKey: "label" },
    { header: "Key", accessorKey: "key" },
    {
      header: "Type",
      cell: ({ row }) => <Badge variant="secondary">{row.original.fieldType}</Badge>,
    },
    {
      header: "Required",
      cell: ({ row }) => (row.original.isRequired ? "Yes" : "No"),
    },
    {
      header: "",
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => handleDeleteField(row.original)}>
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  const objectColumns: ColumnDef<CustomObjectRow, unknown>[] = [
    { header: "Name", accessorKey: "name" },
    { header: "API key", accessorKey: "apiKey" },
    {
      header: "Description",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.description ?? "—"}</span>
      ),
    },
    {
      header: "",
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => handleDeleteObject(row.original)}>
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Tabs defaultValue="fields">
      <TabsList>
        <TabsTrigger value="fields">Fields</TabsTrigger>
        <TabsTrigger value="objects">Custom Objects</TabsTrigger>
      </TabsList>
      <TabsContent value="fields" className="space-y-4">
        <div className="flex justify-end">
          <AddCustomFieldDialog objects={objects} onCreated={(field) => setFields((prev) => [...prev, field])} />
        </div>
        {objects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create a custom object first — core entities become field targets as their modules ship.
          </p>
        ) : null}
        <DataTable columns={fieldColumns} data={fields} emptyMessage="No custom fields yet." />
      </TabsContent>
      <TabsContent value="objects" className="space-y-4">
        <div className="flex justify-end">
          <AddCustomObjectDialog onCreated={(object) => setObjects((prev) => [...prev, object])} />
        </div>
        <DataTable columns={objectColumns} data={objects} emptyMessage="No custom objects yet." />
      </TabsContent>
    </Tabs>
  );
}
