"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type JobOption = { id: string; title: string };

/** Optional parent-requisition link (§11.1: "one need splits into multiple roles"). */
export function ParentJobPicker({
  value,
  onChange,
  excludeJobId,
}: {
  value: JobOption | null;
  onChange: (job: JobOption | null) => void;
  excludeJobId?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JobOption[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await fetch(`/api/jobs?q=${encodeURIComponent(query)}&pageSize=10`);
      const data = await response.json();
      setResults((data.jobs ?? []).filter((job: JobOption) => job.id !== excludeJobId));
    } finally {
      setSearching(false);
    }
  }

  if (value) {
    return (
      <Badge variant="secondary" className="gap-1.5 py-1.5">
        {value.title}
        <button type="button" aria-label="Clear parent job" onClick={() => onChange(null)}>
          <X className="size-3" />
        </button>
      </Badge>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="Search jobs by title…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), search())}
        />
        <Button type="button" variant="outline" onClick={search} disabled={searching}>
          <Search className="size-4" />
        </Button>
      </div>
      {results && results.length > 0 ? (
        <div className="max-h-40 overflow-y-auto rounded-md border">
          {results.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => {
                onChange(job);
                setResults(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
            >
              {job.title}
            </button>
          ))}
        </div>
      ) : null}
      {results && results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching jobs.</p>
      ) : null}
    </div>
  );
}
