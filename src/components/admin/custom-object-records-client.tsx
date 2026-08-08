"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { CustomFieldsFormSection } from "@/components/custom-fields/custom-fields-form-section";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
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
import { type ColumnDef } from "@tanstack/react-table";

type CustomObjectRow = { id: string; apiKey: string; name: string };

type RelationRow = {
  id: string;
  recordId: string;
  relatedEntityType: string;
  relatedEntityId: string;
  createdAt: string;
};

type RecordRow = {
  id: string;
  definitionId: string;
  data: Record<string, unknown>;
  createdAt: string;
  relations: RelationRow[];
};

// Mirrors CUSTOM_FIELD_CAPABLE_ENTITIES in src/lib/entity-registry.ts —
// only core entities are linkable, per assertRelatedEntityExists in
// src/lib/services/custom-object-records.ts.
const RELATABLE_ENTITY_TYPES = ["JOB", "CANDIDATE", "APPLICATION", "INTERVIEW", "OFFER", "HANDOFF"] as const;

async function requestJson(url: string, init: RequestInit = {}) {
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

function AddRecordDialog({
  definitionId,
  apiKey,
  onCreated,
}: {
  definitionId: string;
  apiKey: string;
  onCreated: (record: RecordRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const record = await requestJson("/api/custom-object-records", {
        method: "POST",
        body: JSON.stringify({ definitionId, data }),
      });
      onCreated(record);
      toast.success("Record created.");
      setOpen(false);
      setData({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create record");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add record
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add record</DialogTitle>
          <DialogDescription>Values are validated against this object&apos;s active fields.</DialogDescription>
        </DialogHeader>
        <CustomFieldsFormSection entityType={apiKey} value={data} onChange={setData} />
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RelationsDialog({
  record,
  onChange,
}: {
  record: RecordRow;
  onChange: (recordId: string, relations: RelationRow[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [relatedEntityType, setRelatedEntityType] = useState<string>("");
  const [relatedEntityId, setRelatedEntityId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    setSubmitting(true);
    try {
      const relation = await requestJson(`/api/custom-object-records/${record.id}/relations`, {
        method: "POST",
        body: JSON.stringify({ relatedEntityType, relatedEntityId }),
      });
      const next = record.relations.some((r) => r.id === relation.id)
        ? record.relations
        : [...record.relations, relation];
      onChange(record.id, next);
      toast.success("Linked.");
      setRelatedEntityId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to link entity");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(relation: RelationRow) {
    try {
      await requestJson(`/api/custom-object-records/${record.id}/relations/${relation.id}`, {
        method: "DELETE",
      });
      onChange(record.id, record.relations.filter((r) => r.id !== relation.id));
      toast.success("Unlinked.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to unlink entity");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Relations ({record.relations.length})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Linked records</DialogTitle>
          <DialogDescription>Link this record to a Job, Candidate, Application, Interview, Offer, or Handoff.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {record.relations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No links yet.</p>
          ) : (
            record.relations.map((relation) => (
              <div key={relation.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>
                  {relation.relatedEntityType}: {relation.relatedEntityId}
                </span>
                <Button variant="ghost" size="sm" onClick={() => handleRemove(relation)}>
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Entity type</label>
            <Select value={relatedEntityType} onValueChange={setRelatedEntityType}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {RELATABLE_ENTITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Entity ID</label>
            <Input value={relatedEntityId} onChange={(event) => setRelatedEntityId(event.target.value)} />
          </div>
          <Button onClick={handleAdd} disabled={submitting || !relatedEntityType || !relatedEntityId}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CustomObjectRecordsClient({ objects }: { objects: CustomObjectRow[] }) {
  const [definitionId, setDefinitionId] = useState(objects[0]?.id ?? "");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedObject = objects.find((object) => object.id === definitionId);

  useEffect(() => {
    if (!definitionId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    requestJson(`/api/custom-object-records?definitionId=${definitionId}&pageSize=100`)
      .then((result) => {
        if (!cancelled) setRecords(result.records);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load records"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [definitionId]);

  async function handleDelete(record: RecordRow) {
    try {
      await requestJson(`/api/custom-object-records/${record.id}`, { method: "DELETE" });
      setRecords((prev) => prev.filter((row) => row.id !== record.id));
      toast.success("Record deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete record");
    }
  }

  function handleRelationsChange(recordId: string, relations: RelationRow[]) {
    setRecords((prev) => prev.map((row) => (row.id === recordId ? { ...row, relations } : row)));
  }

  const columns: ColumnDef<RecordRow, unknown>[] = [
    {
      header: "Data",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{JSON.stringify(row.original.data)}</span>
      ),
    },
    {
      header: "Created",
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
    },
    {
      header: "",
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <RelationsDialog record={row.original} onChange={handleRelationsChange} />
          <Button variant="outline" size="sm" onClick={() => handleDelete(row.original)}>
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  if (objects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a custom object on the Custom Objects tab first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="w-64 space-y-2">
          <Select value={definitionId} onValueChange={setDefinitionId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a custom object" />
            </SelectTrigger>
            <SelectContent>
              {objects.map((object) => (
                <SelectItem key={object.id} value={object.id}>
                  {object.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedObject ? (
          <AddRecordDialog
            definitionId={selectedObject.id}
            apiKey={selectedObject.apiKey}
            onCreated={(record) => setRecords((prev) => [record, ...prev])}
          />
        ) : null}
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DataTable columns={columns} data={records} emptyMessage="No records yet." />
      )}
    </div>
  );
}
