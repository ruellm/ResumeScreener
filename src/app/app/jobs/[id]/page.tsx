import Link from "next/link";
import { notFound } from "next/navigation";
import { JobStatusBadge } from "@/components/job-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { intakeAddress, intakeMailbox, intakeSubjectCode } from "@/lib/email-intake";
import { formatDateTime } from "@/lib/format";
import { statusRowSelect, toStatusRow } from "@/lib/submission-status";
import { countEvaluationsThisMonth } from "@/lib/usage";
import { DashboardTab } from "./dashboard-tab";
import { EmailIntake } from "./email-intake";
import { EvaluateTab } from "./evaluate-tab";
import { JobTabs } from "./job-tabs";
import { StatusButtons } from "./status-buttons";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const TABS = ["details", "evaluate", "dashboard"];
const RECENT_SUBMISSIONS = 20;

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireBusinessUser();
  const { id } = await params;
  const query = await searchParams;
  const { tab } = query;

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

  const { monthlyEvalLimit } = user.business;
  const [settings, used, senderCount, recent] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { maxFileSizeMb: true } }),
    monthlyEvalLimit === null ? null : countEvaluationsThisMonth(user.business.id),
    db.allowedSender.count({ where: { businessId: user.business.id } }),
    // RECEIVED rows are uploads that were not confirmed, so they are left out.
    db.submission.findMany({
      where: { jobId: job.id, status: { not: "RECEIVED" } },
      orderBy: { receivedAt: "desc" },
      take: RECENT_SUBMISSIONS,
      select: statusRowSelect,
    }),
  ]);

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
            <Button asChild variant="outline">
              <a href={`/api/jobs/${job.id}/export.csv`}>Export CSV</a>
            </Button>
            <StatusButtons jobId={job.id} status={job.status} />
          </div>
        </div>
      </div>

      <JobTabs initialTab={typeof tab === "string" && TABS.includes(tab) ? tab : "details"}>
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
          <Section title="Email intake">
            <EmailIntake
              accepting={job.status === "ACTIVE"}
              address={intakeAddress(job.emailAlias)}
              mailbox={intakeMailbox()}
              subjectCode={intakeSubjectCode(job.emailAlias)}
              maxFileSizeMb={settings.maxFileSizeMb}
              hasSenders={senderCount > 0}
            />
          </Section>
          <Section title="Created">
            <p>{formatDateTime(job.createdAt)}</p>
          </Section>
          <Section title="Updated">
            <p>{formatDateTime(job.updatedAt)}</p>
          </Section>
        </TabsContent>

        {/* Stays mounted on the other tabs, so uploads and the list survive a tab switch. */}
        <TabsContent
          value="evaluate"
          forceMount
          className="pt-2 data-[state=inactive]:hidden"
        >
          <EvaluateTab
            jobId={job.id}
            active={job.status === "ACTIVE"}
            maxFileSizeMb={settings.maxFileSizeMb}
            usage={
              monthlyEvalLimit !== null && used !== null
                ? { used, limit: monthlyEvalLimit }
                : undefined
            }
            recent={recent.map(toStatusRow)}
          />
        </TabsContent>

        <TabsContent value="dashboard" className="pt-2">
          <DashboardTab jobId={job.id} query={query} />
        </TabsContent>
      </JobTabs>
    </div>
  );
}
