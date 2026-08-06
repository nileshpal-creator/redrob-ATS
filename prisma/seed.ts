import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Personas from PRD §8. Seeded so the org has a usable role set on day one;
// nothing in the codebase treats these names specially — admins can rename,
// delete (non-system roles), or add arbitrary roles from the Roles screen.
const SYSTEM_ROLES = [
  {
    name: "System Administrator",
    description: "Full configuration access. Cannot be locked out by permission edits.",
    isSuperAdmin: true,
  },
  { name: "Recruiter", description: "Owns requisitions end to end." },
  { name: "Hiring Manager", description: "Raises/approves requisitions, reviews shortlists." },
  { name: "Interviewer", description: "Conducts interviews, submits structured feedback." },
  { name: "Recruiting Manager", description: "Oversees a team's requisitions and workload." },
  { name: "HR / Onboarding", description: "Receives the finalized candidate record after offer acceptance." },
] as const;

// §11.13 controlled lists. Values here are sensible starting points, not
// hardcoded business logic — admins manage all of this from /admin/settings
// once that screen ships alongside the modules that consume these lists.
const CONTROLLED_LISTS = [
  {
    key: "REJECTION_REASON",
    label: "Rejection Reasons",
    values: ["Skills mismatch", "Compensation mismatch", "Withdrew", "Position on hold", "Selected another candidate"],
  },
  {
    key: "CANDIDATE_SOURCE",
    label: "Candidate Sources",
    values: ["Referral", "LinkedIn", "Indeed", "Naukri", "Career Site", "Agency", "Direct Application"],
  },
  {
    key: "DOCUMENT_TYPE",
    label: "Document Types",
    values: ["Resume", "Cover Letter", "Offer Letter", "Signed Agreement", "ID Proof", "Other"],
  },
  {
    key: "LOCATION",
    label: "Locations",
    values: ["Remote"],
  },
] as const;

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      name: "My Organization",
    },
  });
  console.log(`Organization ready: ${organization.name}`);

  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: {
        name: role.name,
        description: role.description,
        isSystem: true,
        isSuperAdmin: "isSuperAdmin" in role ? role.isSuperAdmin : false,
      },
    });
  }
  console.log(`Seeded ${SYSTEM_ROLES.length} system roles`);

  for (const list of CONTROLLED_LISTS) {
    const createdList = await prisma.controlledList.upsert({
      where: { key: list.key },
      update: {},
      create: { key: list.key, label: list.label, isSystem: true },
    });

    for (const [index, value] of list.values.entries()) {
      await prisma.controlledListValue.upsert({
        where: { listId_value: { listId: createdList.id, value } },
        update: {},
        create: { listId: createdList.id, value, label: value, sortOrder: index },
      });
    }
  }
  console.log(`Seeded ${CONTROLLED_LISTS.length} controlled lists`);

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.warn(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping admin user bootstrap.",
    );
    return;
  }

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "System Administrator" },
  });

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "System Administrator",
      passwordHash,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  console.log(`Bootstrapped admin user: ${adminEmail}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
