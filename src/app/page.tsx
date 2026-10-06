import type { Metadata } from "next";
import { Channels } from "@/components/landing/channels";
import { Faq } from "@/components/landing/faq";
import { CtaBand, LandingFooter } from "@/components/landing/footer";
import { LandingHeader } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Trust } from "@/components/landing/trust";
import { WhatYouGet } from "@/components/landing/what-you-get";

const title = "Resume Screener: AI resume screening for hiring teams";
const description =
  "Upload resumes, drop them in Google Drive or forward the email, and get a Pass, Maybe or Fail for each one with evidence quoted from the resume.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    url: "/",
    siteName: "Resume Screener",
    images: [{ url: "/landing/og.jpg", width: 1200, height: 630, alt: "Resume Screener" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/landing/og.jpg"],
  },
};

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <Channels />
        <HowItWorks />
        <WhatYouGet />
        <Trust />
        <Faq />
        <CtaBand />
      </main>
      <LandingFooter />
    </div>
  );
}
