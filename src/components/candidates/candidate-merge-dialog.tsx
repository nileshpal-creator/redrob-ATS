"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Combine, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type CandidateOption = { id: string; name: string; phone: string; email: string | null };

/**
 * Merge another candidate into this one (§11.2 FR5: "duplicate detection ...
 * with merge or link"). The server owns the merge algorithm entirely — this
 * dialog only collects which candidate to merge in and the target's current
 * version for the optimistic-locking check.
 */
export function CandidateMergeDialog({
  targetCandidateId,
  version,
  defaultSourceCandidateId,
}: {
  targetCandidateId: string;
  version: number;
  defaultSourceCandidateId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CandidateOption[] | null>(null);
  const [selected, setSelected] = useState<CandidateOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!defaultSourceCandidateId) return;
    let cancelled = false;
    fetch(`/api/candidates/${defaultSourceCandidateId}`).then((response) => {
      if (cancelled || !response.ok) return;
      response.json().then((candidate: CandidateOption) => {
        if (!cancelled) {
          setSelected(candidate);
          setOpen(true);
        }
      });
    });
    return () => {
      cancelled = true;
    };
    // Only meant to run once, for the initial "possible duplicate" prompt —
    // if the flagged candidate no longer exists (e.g. already merged by a
    // stale ?possibleDuplicateOf= left in the URL after a reload), the fetch
    // above 404s and the dialog is simply never opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search() {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await fetch(`/api/candidates?q=${encodeURIComponent(query)}&pageSize=10`);
      if (!response.ok) {
        toast.error("Failed to search candidates. Please try again.");
        return;
      }
      const data = await response.json();
      setResults((data.candidates ?? []).filter((candidate: CandidateOption) => candidate.id !== targetCandidateId));
    } catch {
      toast.error("Failed to search candidates. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handleMerge() {
    if (!selected) return;
    setMerging(true);
    try {
      const response = await fetch(`/api/candidates/${targetCandidateId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCandidateId: selected.id, version }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to merge candidates");
      }
      toast.success(`Merged ${selected.name} into this candidate.`);
      setOpen(false);
      setSelected(null);
      setResults(null);
      // Replace rather than refresh: also drops a stale ?possibleDuplicateOf=
      // from the URL so a later reload doesn't try to re-open this dialog
      // for a candidate that no longer exists.
      router.replace(pathname);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to merge candidates");
    } finally {
      setMerging(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Combine /> Merge duplicate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge a duplicate candidate</DialogTitle>
          <DialogDescription>
            Find the duplicate record. Its documents and notes move here, empty fields on this candidate are filled
            in from it, and the duplicate record is then removed.
          </DialogDescription>
        </DialogHeader>

        {selected ? (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">{selected.name}</p>
            <p className="text-muted-foreground">
              {selected.phone} {selected.email ? `· ${selected.email}` : ""}
            </p>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSelected(null)}>
              Choose a different candidate
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="Search by name, phone, or email…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), search())}
              />
              <Button type="button" variant="outline" aria-label="Search candidates" onClick={search} disabled={searching}>
                <Search className="size-4" />
              </Button>
            </div>
            {results && results.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {results.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSelected(candidate)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{candidate.name}</span>{" "}
                    <span className="text-muted-foreground">{candidate.phone}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {results && results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching candidates.</p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleMerge} disabled={!selected || merging}>
            {merging ? <Loader2 className="animate-spin" /> : null}
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
