"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type InterviewStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
type InterviewMode = "ONSITE" | "VIRTUAL" | "PHONE";

type CalendarInterview = {
  id: string;
  roundName: string;
  mode: InterviewMode;
  scheduledAt: string;
  durationMinutes: number;
  status: InterviewStatus;
  scheduledBy: { id: string; name: string };
  application: { id: string; candidate: { id: string; name: string }; job: { id: string; title: string } };
};

type CalendarResult = { interviews: CalendarInterview[]; total: number; page: number; pageSize: number };

const MODE_LABEL: Record<InterviewMode, string> = { ONSITE: "Onsite", VIRTUAL: "Virtual", PHONE: "Phone" };
const STATUS_BADGE_VARIANT: Record<InterviewStatus, "default" | "secondary" | "destructive"> = {
  SCHEDULED: "default",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toUtcDateOnly(iso: string) {
  const date = new Date(iso);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatWeekLabel(start: Date) {
  const end = addDays(start, 6);
  const fmt = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}, ${end.getUTCFullYear()}`;
}

/**
 * §11.6: "Calendar view filterable by recruiter, team and job." Team has no
 * separate selector — it falls out of the caller's own TEAM-scoped RBAC
 * grant on the underlying GET /api/interviews call, the same way it already
 * narrows Jobs/Applications/Offers list views. A plain week-by-day grid
 * (not an hour grid) keeps this dependency-free per the phase's "no heavy
 * calendar dependency" instruction — interview counts per day are small
 * enough that a simple list-per-day view is more useful than a packed
 * hour-by-hour grid anyway.
 */
export function InterviewCalendarClient({
  initialResult,
  initialWeekStart,
  recruiters,
  jobs,
}: {
  initialResult: CalendarResult;
  initialWeekStart: string;
  recruiters: { id: string; name: string }[];
  jobs: { id: string; title: string }[];
}) {
  const [weekStart, setWeekStart] = useState(() => toUtcDateOnly(initialWeekStart));
  const [recruiterId, setRecruiterId] = useState("");
  const [jobId, setJobId] = useState("");
  const [result, setResult] = useState(initialResult);
  const [isPending, startTransition] = useTransition();

  const fetchWeek = useCallback(
    (start: Date, filters: { recruiterId: string; jobId: string }) => {
      const end = addDays(start, 7);
      const params = new URLSearchParams({
        dateFrom: start.toISOString(),
        dateTo: end.toISOString(),
        pageSize: "100",
      });
      if (filters.recruiterId) params.set("recruiterId", filters.recruiterId);
      if (filters.jobId) params.set("jobId", filters.jobId);

      startTransition(async () => {
        const response = await fetch(`/api/interviews?${params.toString()}`);
        if (response.ok) {
          setResult(await response.json());
        }
      });
    },
    [],
  );

  // Skip the redundant fetch on first mount — initialResult already covers
  // the initial week with no filters applied.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    if (!hasMounted) {
      setHasMounted(true);
      return;
    }
    fetchWeek(weekStart, { recruiterId, jobId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, recruiterId, jobId]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  const interviewsByDay = useMemo(() => {
    const buckets = new Map<string, CalendarInterview[]>();
    for (const interview of result.interviews) {
      const key = toUtcDateOnly(interview.scheduledAt).toISOString();
      const bucket = buckets.get(key) ?? [];
      bucket.push(interview);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      bucket.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    }
    return buckets;
  }, [result.interviews]);

  const todayKey = toUtcDateOnly(new Date().toISOString()).toISOString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStart((prev) => addDays(prev, -7))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium">{formatWeekLabel(weekStart)}</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekStart((prev) => addDays(prev, 7))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(toUtcDateOnly(new Date().toISOString()))}>
            Today
          </Button>
          {isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={recruiterId || "ANY"} onValueChange={(value) => setRecruiterId(value === "ANY" ? "" : value)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Recruiter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any recruiter</SelectItem>
              {recruiters.map((recruiter) => (
                <SelectItem key={recruiter.id} value={recruiter.id}>
                  {recruiter.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={jobId || "ANY"} onValueChange={(value) => setJobId(value === "ANY" ? "" : value)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Job" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any job</SelectItem>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day, index) => {
          const key = day.toISOString();
          const interviews = interviewsByDay.get(key) ?? [];
          const isToday = key === todayKey;

          return (
            <Card key={key} className={cn("flex flex-col gap-2 p-3", isToday ? "border-primary" : undefined)}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {DAY_LABELS[index]}
                </span>
                <span className={cn("text-sm font-medium", isToday ? "text-primary" : undefined)}>
                  {day.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {interviews.map((interview) => (
                  <Link
                    key={interview.id}
                    href={`/applications/${interview.application.id}`}
                    className="block rounded-md border p-2 text-xs transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium">
                        {new Date(interview.scheduledAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      <Badge variant={STATUS_BADGE_VARIANT[interview.status]} className="text-[10px]">
                        {interview.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate font-medium">{interview.roundName}</p>
                    <p className="truncate text-muted-foreground">{interview.application.candidate.name}</p>
                    <p className="truncate text-muted-foreground">{interview.application.job.title}</p>
                    <p className="text-muted-foreground">
                      {MODE_LABEL[interview.mode]} &middot; {interview.durationMinutes} min &middot;{" "}
                      {interview.scheduledBy.name}
                    </p>
                  </Link>
                ))}
                {interviews.length === 0 ? <p className="text-xs text-muted-foreground">No interviews.</p> : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
