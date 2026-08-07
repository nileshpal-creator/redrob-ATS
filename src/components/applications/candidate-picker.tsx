"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type CandidateOption = { id: string; name: string; phone: string; email: string | null };

/**
 * Search-and-select a candidate — the Application create form's first
 * field. Modeled directly on ParentJobPicker's search/select/clear shape
 * (jobs/parent-job-picker.tsx); no existing candidate picker to reuse, so
 * this is the one genuinely new picker Module 4 needs.
 */
export function CandidatePicker({
  value,
  onChange,
}: {
  value: CandidateOption | null;
  onChange: (candidate: CandidateOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CandidateOption[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await fetch(`/api/candidates?q=${encodeURIComponent(query)}&pageSize=10`);
      const data = await response.json();
      setResults(data.candidates ?? []);
    } finally {
      setSearching(false);
    }
  }

  if (value) {
    return (
      <Badge variant="secondary" className="gap-1.5 py-1.5">
        {value.name} &middot; {value.phone}
        <button type="button" aria-label="Clear candidate" onClick={() => onChange(null)}>
          <X className="size-3" />
        </button>
      </Badge>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="Search candidates by name, phone, or email…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), search())}
        />
        <Button type="button" variant="outline" onClick={search} disabled={searching}>
          <Search className="size-4" />
        </Button>
      </div>
      {results && results.length > 0 ? (
        <div className="max-h-48 overflow-y-auto rounded-md border">
          {results.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => {
                onChange(candidate);
                setResults(null);
              }}
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
  );
}
