import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { SkillsManager } from "./skills-manager";

export default async function SkillsPage() {
  await requireSuperAdmin();

  const skills = await db.skill.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: { _count: { select: { jobs: true } } },
  });

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Skills</h1>
      <SkillsManager
        skills={skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          category: skill.category,
          isActive: skill.isActive,
          jobCount: skill._count.jobs,
        }))}
      />
    </div>
  );
}
