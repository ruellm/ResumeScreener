import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { JobForm } from "../job-form";

export default async function NewJobPage() {
  await requireBusinessUser();

  const skillOptions = await db.skill.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, category: true },
  });

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">New job</h1>
      <JobForm
        skillOptions={skillOptions}
        emailIntake={
          <p className="text-sm text-muted-foreground">
            The email intake address is created when you save.
          </p>
        }
      />
    </div>
  );
}
