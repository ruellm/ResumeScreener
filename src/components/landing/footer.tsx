import Link from "next/link";
import { demoMailto, siteConfig } from "@/lib/site-config";
import { ButtonLink, Container } from "./ui";

export function CtaBand() {
  return (
    <section aria-labelledby="cta-heading" className="bg-indigo-600 py-16 text-white sm:py-20">
      <Container className="flex flex-col items-center gap-8 text-center sm:flex-row sm:justify-between sm:text-left">
        <h2 id="cta-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          See it on your own job posts.
        </h2>
        <ButtonLink href={demoMailto} variant="inverted">
          Request a demo
        </ButtonLink>
      </Container>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-8">
      <Container className="flex flex-col items-center justify-between gap-4 text-sm text-slate-600 sm:flex-row">
        <p>
          &copy; {new Date().getFullYear()} {siteConfig.company}
        </p>
        <Link
          href="/privacy"
          className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
        >
          Privacy
        </Link>
      </Container>
    </footer>
  );
}
