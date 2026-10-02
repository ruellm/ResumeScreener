import { PrismaClient } from "@prisma/client";
import skills from "./seed-data/skills.json";

const prisma = new PrismaClient();

async function seedSkills() {
  const names = new Set<string>();
  for (const skill of skills) {
    if (names.has(skill.name)) {
      throw new Error(`Duplicate skill in skills.json: ${skill.name}`);
    }
    names.add(skill.name);
  }

  // Only adds skills or moves them to the category in the file.
  // isActive is left alone so an admin's deactivation survives a reseed.
  for (const { name, category } of skills) {
    await prisma.skill.upsert({
      where: { name },
      update: { category },
      create: { name, category },
    });
  }

  const counts = await prisma.skill.groupBy({
    by: ["category"],
    _count: true,
    orderBy: { category: "asc" },
  });
  console.log("Skills per category:");
  for (const row of counts) {
    console.log(`  ${row.category}: ${row._count}`);
  }
  const total = counts.reduce((sum, row) => sum + row._count, 0);
  console.log(`  Total: ${total}`);
}

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, evalModel: "claude-sonnet-5" },
  });

  await seedSkills();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
