-- Enforce "at most one non-terminal Offer per Application" at the database
-- level. Not representable in schema.prisma (no partial-index syntax), so
-- this is hand-written, same pattern as job_recruiter_one_primary and
-- pipeline_stage_active_name_unique.
--
-- Unlike those two, this one is not just a backstop: the service-layer
-- check in createOffer (src/lib/services/offers.ts) reads other rows
-- (findFirst for an existing active offer) before writing, which is a
-- genuine check-then-create race under concurrent requests — the input
-- shape alone can't prove uniqueness the way updateJobRecruiters' "exactly
-- one isPrimary in this array" check can. createOffer catches the P2002
-- this index would raise on a race and converts it to the same
-- ValidationError the read-based check produces.
CREATE UNIQUE INDEX "offer_one_active_per_application"
  ON "Offer" ("applicationId")
  WHERE "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXTENDED');
