import type { Metadata } from "next";
import Link from "next/link";
import { serverEnv } from "@/lib/env.server";

export const metadata: Metadata = {
  title: "Privacy Policy | Resume Screener",
};

const GOOGLE_POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  const contact = serverEnv.GOOGLE_SYSTEM_ACCOUNT;
  const contactLink = (
    <a href={`mailto:${contact}`} className="underline underline-offset-4">
      {contact}
    </a>
  );

  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-4 py-10 leading-relaxed">
      <p className="w-fit rounded-md border px-2 py-1 text-sm font-medium">Draft</p>
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>

      <Section title="Who we are">
        <p>
          Resume Screener is a service by OneOverZero. You can reach us at {contactLink}.
        </p>
      </Section>

      <Section title="What we collect">
        <ul className="list-disc pl-6">
          <li>Business account details</li>
          <li>Job descriptions</li>
          <li>Resumes uploaded by businesses</li>
          <li>Evaluation results</li>
          <li>Allowed-sender email addresses</li>
        </ul>
      </Section>

      <Section title="How we use it">
        <p>
          We use this information to screen resumes for the business that submitted them, and
          for nothing else.
        </p>
      </Section>

      <Section title="Service providers">
        <ul className="list-disc pl-6">
          <li>Supabase, for storage and the database</li>
          <li>Anthropic, for AI evaluation</li>
          <li>Google, for email and Drive intake</li>
        </ul>
      </Section>

      <Section title="Retention">
        <p>
          Resumes and results are deleted after the business&apos;s retention period, which is
          between 6 and 12 months.
        </p>
      </Section>

      <Section title="Google user data">
        <p>
          Resume Screener&apos;s use and transfer of information received from Google APIs
          adheres to the{" "}
          <a
            href={GOOGLE_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </Section>

      <Section title="Contact">
        <p>Questions about this policy or your data: {contactLink}.</p>
      </Section>

      <p className="text-sm text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:underline">
          Back to Resume Screener
        </Link>
      </p>
    </main>
  );
}
