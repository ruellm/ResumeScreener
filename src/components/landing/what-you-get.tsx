import { CheckItem, Container, SectionHeading } from "./ui";

const points = [
  "Evidence for every rating, quoted from the resume",
  "Required-skill checks that cap the verdict",
  "Detects resumes that try to trick AI screeners",
  "A result PDF per candidate and a CSV export",
  "A dashboard per job with filters and search",
];

const rows = [
  {
    ok: true,
    requirement: "5+ years with React",
    evidence: "Led the React rewrite of the checkout app, 2019 to present",
  },
  {
    ok: true,
    requirement: "REST API design",
    evidence: "Designed and documented the public orders API",
  },
  {
    ok: true,
    requirement: "Mentored engineers",
    evidence: "Mentored four junior developers through onboarding",
  },
  {
    ok: false,
    requirement: "Kubernetes in production",
    evidence: "Mentions Docker only, no cluster experience found",
  },
];

function SampleResult() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-slate-800">Sample Candidate</p>
          <p className="text-sm text-slate-500">sample-candidate.pdf</p>
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">
          Pass
        </span>
      </div>
      <div className="mt-6 flex items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full border-4 border-teal-500 text-xl font-bold text-slate-800">
          92
        </div>
        <p className="text-sm text-slate-600">Score out of 100. Three of four requirements met.</p>
      </div>
      <ul className="mt-6 divide-y divide-slate-200 border-t border-slate-200">
        {rows.map((row) => (
          <li key={row.requirement} className="flex items-start gap-3 py-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                row.ok ? "bg-teal-500 text-white" : "bg-amber-500 text-slate-800"
              }`}
            >
              {row.ok ? (
                <svg
                  viewBox="0 0 16 16"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                "!"
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {row.requirement}
                <span className="sr-only">{row.ok ? ": met" : ": not confirmed"}</span>
              </p>
              <p className="text-sm text-slate-600">&ldquo;{row.evidence}&rdquo;</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhatYouGet() {
  return (
    <section aria-labelledby="get-heading" className="bg-indigo-50 py-16 sm:py-24">
      <Container className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
        <div className="order-first md:order-last">
          <SampleResult />
        </div>
        <div>
          <SectionHeading id="get-heading">What you get</SectionHeading>
          <ul className="mt-8 space-y-4">
            {points.map((point) => (
              <CheckItem key={point}>{point}</CheckItem>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
