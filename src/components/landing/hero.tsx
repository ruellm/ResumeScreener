import Image from "next/image";
import { demoMailto } from "@/lib/site-config";
import { ButtonLink, Container } from "./ui";

export function Hero() {
  return (
    <section className="py-12 sm:py-16 lg:py-20">
      <Container className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
        <div className="order-last md:order-first">
          <h1 className="text-4xl font-bold tracking-tight text-slate-800 sm:text-5xl">
            Screen every resume in minutes, not days.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Your job posts already bring in resumes from JobStreet, LinkedIn or your careers page.
            Upload them, drop them in a folder, or forward the email. Resume Screener reads each one
            against your job and tells you who fits, with the evidence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={demoMailto}>Request a demo</ButtonLink>
            <ButtonLink href="/login" variant="secondary">
              Log in
            </ButtonLink>
          </div>
        </div>
        <Image
          src="/landing/hero.webp"
          alt="Resumes arriving by upload, Drive and email and turning into a scored result"
          width={1536}
          height={1024}
          priority
          sizes="(min-width: 768px) 50vw, 100vw"
          className="h-auto w-full"
        />
      </Container>
    </section>
  );
}
