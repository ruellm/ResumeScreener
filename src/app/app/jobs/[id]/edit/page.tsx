import { notFound } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { intakeAddress, intakeMailbox, intakeSubjectCode } from "@/lib/email-intake";
import { JobForm } from "../../job-form";
import { EmailIntake } from "../email-intake";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireBusinessUser();
  const { id } = await params;

  const [job, skillOptions, settings, senderCount] = await Promise.all([
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
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { maxFileSizeMb: true } }),
    db.allowedSender.count({ where: { businessId: user.business.id } }),
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
        emailIntake={
          <EmailIntake
            accepting={job.status === "ACTIVE"}
            address={intakeAddress(job.emailAlias)}
            mailbox={intakeMailbox()}
            subjectCode={intakeSubjectCode(job.emailAlias)}
            maxFileSizeMb={settings.maxFileSizeMb}
            hasSenders={senderCount > 0}
          />
        }
      />
    </div>
  );
}
