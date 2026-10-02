import Link from "next/link";
import { notFound } from "next/navigation";
import { JobStatusBadge } from "@/components/job-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { StatusButtons } from "./status-buttons";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireBusinessUser();
  const { id } = await params;

  const job = await db.job.findFirst({
    where: { id, businessId: user.business.id },
    include: {
      skills: {
        include: { skill: true },
        orderBy: [{ skill: { category: "asc" } }, { skill: { name: "asc" } }],
      },
    },
  });
  if (!job) notFound();

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link
          href="/app"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to jobs
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{job.title}</h1>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link href={`/app/jobs/${job.id}/edit`}>Edit</Link>
            </Button>
            <StatusButtons jobId={job.id} status={job.status} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="evaluate">Evaluate</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="grid gap-6 pt-2">
          <Section title="Role overview">
            <p className="whitespace-pre-wrap">{job.roleOverview}</p>
          </Section>
          <Section title="Requirements">
            <p className="whitespace-pre-wrap">{job.requirements}</p>
          </Section>
          <Section title="Ideal candidate profile">
            <p className="whitespace-pre-wrap">{job.idealCandidateProfile}</p>
          </Section>
          <Section title="Passing criteria">
            <p className="whitespace-pre-wrap">{job.passingCriteria}</p>
          </Section>
          <Section title="Skills">
            {job.skills.length === 0 ? (
              <p className="text-muted-foreground">No skills.</p>
            ) : (
              <ul className="grid gap-1">
                {job.skills.map(({ skill, isRequired }) => (
                  <li key={skill.id} className="flex flex-wrap items-center gap-2">
                    <span>{skill.name}</span>
                    <span className="text-muted-foreground">{skill.category}</span>
                    {isRequired && <Badge variant="outline">Required</Badge>}
                    {!skill.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Job post URL">
            {job.postUrl ? (
              <a
                href={job.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all underline underline-offset-4"
              >
                {job.postUrl}
              </a>
            ) : (
              <p className="text-muted-foreground">Not set.</p>
            )}
          </Section>
          <Section title="Created">
            <p>{formatDateTime(job.createdAt)}</p>
          </Section>
          <Section title="Updated">
            <p>{formatDateTime(job.updatedAt)}</p>
          </Section>
        </TabsContent>

        <TabsContent value="evaluate" className="pt-2">
          <p className="text-muted-foreground">Coming soon.</p>
        </TabsContent>

        <TabsContent value="dashboard" className="pt-2">
          <p className="text-muted-foreground">Coming soon.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
