import Image from "next/image";
import { Container, SectionHeading } from "./ui";

type StepProps = {
  number: number;
  title: string;
  text: string;
  imageSide: "left" | "right";
  image: { src: string; alt: string; width: number; height: number };
};

function StepNumber({ number }: { number: number }) {
  return (
    <span aria-hidden="true" className="text-5xl font-bold tabular-nums text-indigo-600">
      {number}
    </span>
  );
}

function Step({ number, title, text, imageSide, image }: StepProps) {
  return (
    <li className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      <div>
        <StepNumber number={number} />
        <h3 className="mt-3 text-2xl font-bold text-slate-800">{title}</h3>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">{text}</p>
      </div>
      <div className={imageSide === "left" ? "order-first" : "order-first md:order-last"}>
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          sizes="(min-width: 768px) 50vw, 100vw"
          className="mx-auto h-auto w-full max-w-md md:max-w-none"
        />
      </div>
    </li>
  );
}

const sendCards = [
  {
    title: "Upload",
    text: "Drag a batch of PDFs into the job page.",
    src: "/landing/send-upload.webp",
    alt: "PDF resumes being dropped into an upload area in the browser",
  },
  {
    title: "Google Drive",
    text: "Drop resumes into the job's folder, from any device.",
    src: "/landing/send-drive.webp",
    alt: "PDF resumes falling into a cloud folder",
  },
  {
    title: "Email",
    text: "Forward applicant emails with their attachments to the job's address.",
    src: "/landing/send-email.webp",
    alt: "An open envelope with PDF attachments being forwarded",
  },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="py-16 sm:py-24">
      <Container>
        <SectionHeading id="how-heading">How it works</SectionHeading>
        <ol className="mt-12 space-y-16 sm:mt-16 sm:space-y-24">
          <Step
            number={1}
            title="Create the job"
            text="Paste the link to your existing job post and we fill in the details, or write it yourself. Add the skills that matter and what a passing candidate looks like."
            imageSide="right"
            image={{
              src: "/landing/step-create.webp",
              alt: "A job post in the browser being turned into a structured job profile",
              width: 1024,
              height: 683,
            }}
          />
          <Step
            number={2}
            title="Your intake is ready"
            text="Every job gets its own code, a private email address and a private Google Drive folder, shared only with your hiring team."
            imageSide="left"
            image={{
              src: "/landing/step-intake.webp",
              alt: "A job badge linked to a private inbox and a locked folder",
              width: 1024,
              height: 1024,
            }}
          />
          <li>
            <StepNumber number={3} />
            <h3 className="mt-3 text-2xl font-bold text-slate-800">Send resumes your way</h3>
            <ul className="mt-8 grid gap-6 md:grid-cols-3">
              {sendCards.map((card) => (
                <li key={card.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                  <Image
                    src={card.src}
                    alt={card.alt}
                    width={1024}
                    height={1024}
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="mx-auto h-auto w-full max-w-xs"
                  />
                  <h4 className="mt-4 text-lg font-semibold text-slate-800">{card.title}</h4>
                  <p className="mt-2 text-slate-600">{card.text}</p>
                </li>
              ))}
            </ul>
          </li>
          <Step
            number={4}
            title="Get the results"
            text="Each resume gets a Pass, Maybe or Fail with a score, and the requirements it meets, quoted straight from the resume. Results appear in your dashboard, next to the file in Drive, and as a reply to your email."
            imageSide="right"
            image={{
              src: "/landing/step-results.webp",
              alt: "A scored result sheet with a percentage, checked requirements and a badge",
              width: 1024,
              height: 1024,
            }}
          />
        </ol>
      </Container>
    </section>
  );
}
