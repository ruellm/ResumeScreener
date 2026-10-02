import { notFound } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { JobForm } from "../../job-form";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireBusinessUser();
  const { id } = await params;

  const [job, skillOptions] = await Promise.all([
    db.job.findFirst({
      where: { id, businessId: user.business.id },
      include: {
        skills: {
          include: { skill: true },
          orderBy: [{ skill: { category: "asc" } }, { skill: { name: "asc" } }],
        },
        _count: { select: { submissions: true } },
      },
    }),
    db.skill.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true },
    }),
  ]);
  if (!job) notFound();

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Edit job</h1>
      <JobForm
        skillOptions={skillOptions}
        job={{
          id: job.id,
          title: job.title,
          roleOverview: job.roleOverview,
          requirements: job.requirements,
          idealCandidateProfile: job.idealCandidateProfile,
          passingCriteria: job.passingCriteria,
          postUrl: job.postUrl ?? "",
          skills: job.skills.map(({ skill, isRequired }) => ({
            id: skill.id,
            name: skill.name,
            category: skill.category,
            isActive: skill.isActive,
            isRequired,
          })),
          hasSubmissions: job._count.submissions > 0,
        }}
      />
    </div>
  );
}
