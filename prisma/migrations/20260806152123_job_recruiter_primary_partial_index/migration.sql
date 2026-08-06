-- Enforce at most one primary recruiter per job at the database level.
-- Not representable in schema.prisma (no partial-index syntax), so this
-- migration is hand-written rather than generated. The service layer
-- (src/lib/services/jobs.ts#updateJobRecruiters) is still the primary
-- enforcement; this is the belt-and-suspenders backstop.
CREATE UNIQUE INDEX "job_recruiter_one_primary"
  ON "JobRecruiterAssignment" ("jobId")
  WHERE "isPrimary" = true;
