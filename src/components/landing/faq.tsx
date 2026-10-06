import { ChevronDown } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const items = [
  {
    q: "What files are accepted?",
    a: "PDF resumes up to 10 MB each, including scanned PDFs.",
  },
  {
    q: "Where do my resumes come from?",
    a: "Wherever you already receive them: JobStreet, LinkedIn, your careers page or your inbox. Upload them, drop them in your job's Drive folder, or forward the emails.",
  },
  {
    q: "Who can send to my job?",
    a: "Only the email addresses your company approves. Every email is checked to confirm the sender is genuine.",
  },
  {
    q: "How long is data kept?",
    a: "Resumes and results are deleted automatically after your retention period, between 6 and 12 months.",
  },
  {
    q: "Can it read scanned resumes?",
    a: "Yes. Image-only PDFs are read from the page images.",
  },
];

export function Faq() {
  return (
    <section aria-labelledby="faq-heading" className="bg-indigo-50 py-16 sm:py-24">
      <Container className="max-w-3xl">
        <SectionHeading id="faq-heading">FAQ</SectionHeading>
        <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {items.map((item) => (
            <details key={item.q} className="group px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-base font-semibold text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 text-indigo-600 transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="pb-5 leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
