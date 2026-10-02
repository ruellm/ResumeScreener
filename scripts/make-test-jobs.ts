import { db } from "@/lib/db";
import { generateEmailAlias } from "@/lib/email-alias";

// Creates two jobs for trying out evaluation.
//   npm run make-test-jobs -- <businessId>

type TestJob = {
  title: string;
  roleOverview: string;
  requirements: string;
  idealCandidateProfile: string;
  passingCriteria: string;
  skills: { name: string; category: string; isRequired: boolean }[];
};

const JOBS: TestJob[] = [
  {
    title: "Frontend Developer (React)",
    roleOverview:
      "We are a small product team building a web dashboard for logistics clients. " +
      "You will build and maintain customer-facing features in React and TypeScript, " +
      "working with one designer and two backend developers.",
    requirements: [
      "- At least 2 years of professional experience building web applications with React",
      "- TypeScript used in production code",
      "- Experience consuming REST APIs",
      "- Writes automated tests for frontend code",
      "- Uses Git with code review",
    ].join("\n"),
    idealCandidateProfile:
      "Someone who has shipped and maintained React applications in a real product, " +
      "not only in tutorials or school projects. They write TypeScript as a matter of " +
      "course, care about page speed and tested code, and can take a feature from a " +
      "design to production with little supervision. Next.js and Tailwind CSS " +
      "experience is a plus because our app uses both, but we can teach them.",
    passingCriteria:
      "PASS: at least 2 years of professional React work and clear TypeScript use in " +
      "a job or a shipped project.\n" +
      "MAYBE: real React experience but under 2 years, or TypeScript is only light or " +
      "recent, or the resume is too thin to be sure.\n" +
      "FAIL: no professional React experience, or neither React nor TypeScript is shown.",
    skills: [
      { name: "React", category: "Software Development", isRequired: true },
      { name: "TypeScript", category: "Software Development", isRequired: true },
      { name: "Next.js", category: "Software Development", isRequired: false },
      { name: "Tailwind CSS", category: "Software Development", isRequired: false },
    ],
  },
  {
    title: "Warehouse Forklift Operator",
    roleOverview:
      "Our distribution warehouse in Bulacan moves palletised consumer goods for " +
      "retail clients. You will load and unload trucks, put pallets away in racking " +
      "and keep stock moving safely during your shift.",
    requirements: [
      "- At least 1 year of experience operating a forklift in a warehouse",
      "- A forklift certificate, such as TESDA NC II, or documented company training",
      "- Experience loading and unloading trucks",
      "- Follows warehouse safety procedures, including pre-use equipment checks",
    ].join("\n"),
    idealCandidateProfile:
      "An operator who has driven a reach truck or counterbalance forklift every " +
      "working day, handles racking at height with confidence and has a clean safety " +
      "record. Experience with inventory counts or a warehouse system is a plus " +
      "because operators here also record stock movements.",
    passingCriteria:
      "PASS: at least 1 year of hands-on forklift operation in a warehouse and a " +
      "certificate or documented training.\n" +
      "MAYBE: forklift experience under 1 year, or experience is clear but no " +
      "certificate or training is mentioned.\n" +
      "FAIL: no forklift operation shown.",
    skills: [
      { name: "Forklift Operation", category: "Logistics & Warehouse", isRequired: true },
      { name: "Inventory Management", category: "Logistics & Warehouse", isRequired: false },
    ],
  },
];

async function main() {
  const businessId = process.argv[2];
  if (!businessId) throw new Error("Usage: npm run make-test-jobs -- <businessId>");

  const business = await db.business.findUnique({
    where: { id: businessId },
    include: { users: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!business) throw new Error(`Business ${businessId} not found.`);
  const [creator] = business.users;
  if (!creator) throw new Error("The business needs a user to own the jobs.");

  for (const job of JOBS) {
    const { skills, ...fields } = job;
    const jobSkills = [];
    for (const { name, category, isRequired } of skills) {
      let skill = await db.skill.findUnique({ where: { name } });
      if (!skill) {
        skill = await db.skill.create({ data: { name, category } });
        console.log(`Added skill "${name}" to the catalogue.`);
      }
      jobSkills.push({ skillId: skill.id, isRequired });
    }

    const created = await db.job.create({
      data: {
        ...fields,
        businessId: business.id,
        createdById: creator.id,
        emailAlias: generateEmailAlias(),
        skills: { create: jobSkills },
      },
    });
    console.log(`${created.id}  ${created.title}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
