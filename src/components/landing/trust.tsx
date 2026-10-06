import Image from "next/image";
import { CheckItem, Container, SectionHeading } from "./ui";

const points = [
  "Only your verified senders are accepted",
  "Private folders per company",
  "Automatic deletion after your retention period",
  "AI assists. Your team decides.",
];

export function Trust() {
  return (
    <section aria-labelledby="trust-heading" className="py-16 sm:py-24">
      <Container className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
        <Image
          src="/landing/trust.webp"
          alt="A locked folder of resumes behind a shield with a check mark"
          width={1024}
          height={1024}
          sizes="(min-width: 768px) 50vw, 100vw"
          className="mx-auto h-auto w-full max-w-md md:max-w-none"
        />
        <div>
          <SectionHeading id="trust-heading">Built for trust</SectionHeading>
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
