import Link from "next/link";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { siteConfig } from "@/lib/site-config";
import { Container } from "./ui";

async function headerLink() {
  try {
    const user = await getCurrentUser();
    if (user) return { href: homeFor(user.role), label: "Go to dashboard" };
  } catch {
    // Auth not reachable: show the public link.
  }
  return { href: "/login", label: "Log in" };
}

export async function LandingHeader() {
  const link = await headerLink();
  return (
    <header className="border-b border-slate-200 bg-white">
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          className="flex items-baseline gap-2 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
        >
          <span className="text-lg font-bold tracking-tight text-slate-800">{siteConfig.productName}</span>
          <span className="text-xs font-medium text-slate-500">by {siteConfig.company}</span>
        </Link>
        <Link
          href={link.href}
          className="inline-flex h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-800 outline-none transition-colors hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          {link.label}
        </Link>
      </Container>
    </header>
  );
}
