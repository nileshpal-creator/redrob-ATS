"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import {
  communicationTemplateCreateSchema,
  type CommunicationTemplateCreateInput,
} from "@/lib/validations/communication-template";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { TemplateVersionsDialog } from "@/components/admin/template-versions-dialog";

export type CommunicationTemplateRow = {
  id: string;
  name: string;
  channel: "EMAIL" | "SMS";
  subject: string;
  body: string;
  isActive: boolean;
};

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

function AddTemplateDialog({ onCreated }: { onCreated: (template: CommunicationTemplateRow) => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<CommunicationTemplateCreateInput>({
    resolver: zodResolver(communicationTemplateCreateSchema),
    defaultValues: { name: "", channel: "EMAIL", subject: "", body: "", isActive: true },
  });

  async function onSubmit(values: CommunicationTemplateCreateInput) {
    try {
      const template = await requestJson("/api/communication-templates", {
        method: "POST",
        body: JSON.stringify(values),
      });
      onCreated(template);
      toast.success(`Template "${template.name}" created.`);
      setOpen(false);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create template");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add communication template</DialogTitle>
          <DialogDescription>
            Email only for now — SMS is reserved for a future phase (§11.10).
          </DialogDescription>
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
                    <Input placeholder="Interview Invite" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Input placeholder="Update on your application to {{job.title}}" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Body</FormLabel>
                  <FormControl>
                    <Textarea rows={6} placeholder="Hi {{candidate.name}}, ..." {...field} />
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

function EditTemplateDialog({
  template,
  open,
  onOpenChange,
  onSaved,
}: {
  template: CommunicationTemplateRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (template: CommunicationTemplateRow) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!template) return;
    setSubject(template.subject);
    setBody(template.body);
    setIsActive(template.isActive);
  }, [template]);

  async function handleSubmit() {
    if (!template) return;
    setSubmitting(true);
    try {
      const updated = await requestJson(`/api/communication-templates/${template.id}`, {
        method: "PATCH",
        body: JSON.stringify({ subject, body, isActive }),
      });
      onSaved(updated);
      toast.success(`Template "${updated.name}" updated.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update template");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {template?.name}</DialogTitle>
          <DialogDescription>
            The name can&apos;t be changed — deactivate and create a replacement to rename.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Subject</label>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Body</label>
            <Textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            Active — inactive templates can&apos;t be picked for a new send
          </label>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!subject.trim() || !body.trim() || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Admin CRUD for CommunicationTemplate (§11.10, §10.4's minimal slice — see
 * schema.prisma's model comment). No delete: deactivate via the Active
 * switch instead, same convention as PipelineStage.
 */
export function CommunicationTemplatesClient({
  initialTemplates,
  canApprove,
}: {
  initialTemplates: CommunicationTemplateRow[];
  canApprove: boolean;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [editing, setEditing] = useState<CommunicationTemplateRow | null>(null);

  function handleSaved(updated: CommunicationTemplateRow) {
    setTemplates((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
  }

  const columns: ColumnDef<CommunicationTemplateRow, unknown>[] = [
    { header: "Name", accessorKey: "name" },
    { header: "Subject", cell: ({ row }) => <span className="text-muted-foreground">{row.original.subject}</span> },
    {
      header: "Status",
      cell: ({ row }) => <Badge variant={row.original.isActive ? "success" : "outline"}>{row.original.isActive ? "Active" : "Inactive"}</Badge>,
    },
    {
      header: "",
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <TemplateVersionsDialog templateId={row.original.id} templateName={row.original.name} canApprove={canApprove} />
          <Button variant="outline" size="sm" onClick={() => setEditing(row.original)}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddTemplateDialog onCreated={(template) => setTemplates((prev) => [...prev, template])} />
      </div>
      <DataTable columns={columns} data={templates} emptyMessage="No communication templates yet." />
      <EditTemplateDialog
        template={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}
