"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

/**
 * §11.3: "Referral capture as a distinct source type" — one combined step
 * (candidate + application) for someone not yet in the system, source
 * fixed to "Referral" server-side. A candidate who already exists (phone
 * match) is reused, never re-created.
 */
export function ReferCandidateDialog({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setPhone("");
    setEmail("");
    setNote("");
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await requestJson("/api/referrals", {
        method: "POST",
        body: JSON.stringify({ jobId, name, phone, email: email || undefined, note: note || undefined }),
      });
      toast.success("Referral recorded.");
      reset();
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record referral");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus /> Refer a candidate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refer a candidate for this role</DialogTitle>
          <DialogDescription>
            Creates the candidate (source: Referral) and an application for this job in one step. Their fuller
            profile can be filled in later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="referral-name">Name</Label>
            <Input id="referral-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="referral-phone">Phone</Label>
            <Input id="referral-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="referral-email">Email (optional)</Label>
            <Input id="referral-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="referral-note">Note (optional)</Label>
            <Textarea
              id="referral-note"
              rows={2}
              placeholder="Why you're referring them…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!name.trim() || !phone.trim() || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Submit referral
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
