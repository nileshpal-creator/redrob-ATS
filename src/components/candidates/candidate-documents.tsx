"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ListValue = { id: string; label: string };

type CandidateDocument = {
  id: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  documentType: { label: string };
  uploadedBy: { name: string };
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Multi-document attachment (§11.2 FR8) — upload, download, and delete. */
export function CandidateDocuments({
  candidateId,
  documents,
  documentTypes,
  canManage,
}: {
  candidateId: string;
  documents: CandidateDocument[];
  documentTypes: ListValue[];
  canManage: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documentTypeId, setDocumentTypeId] = useState(documentTypes[0]?.id ?? "");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a file first.");
      return;
    }
    if (!documentTypeId) {
      toast.error("Choose a document type.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentTypeId", documentTypeId);
      const response = await fetch(`/api/candidates/${candidateId}/documents`, {
        method: "POST",
        body: formData,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Upload failed");
      }
      toast.success("Document uploaded.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(documentId: string) {
    setDeletingId(documentId);
    try {
      const response = await fetch(`/api/candidates/${candidateId}/documents/${documentId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Failed to delete document");
      }
      toast.success("Document removed.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete document");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {documents.map((document) => (
        <div key={document.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
          <div className="flex items-center gap-2 overflow-hidden">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="overflow-hidden">
              <p className="truncate font-medium">{document.fileName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {document.documentType.label} &middot; {formatBytes(document.fileSize)} &middot;{" "}
                {document.uploadedBy.name} &middot; {new Date(document.uploadedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" asChild>
              <a href={`/api/candidates/${candidateId}/documents/${document.id}`} download>
                <Download className="size-4" />
              </a>
            </Button>
            {canManage ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={deletingId === document.id}
                onClick={() => handleDelete(document.id)}
              >
                {deletingId === document.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4 text-destructive" />
                )}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      {documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents attached yet.</p> : null}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <input ref={fileInputRef} type="file" className="max-w-56 text-sm" />
          <Select value={documentTypeId} onValueChange={setDocumentTypeId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Document type" />
            </SelectTrigger>
            <SelectContent>
              {documentTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleUpload} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            Upload
          </Button>
        </div>
      ) : null}
    </div>
  );
}
