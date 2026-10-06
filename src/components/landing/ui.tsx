import Link from "next/link";
import { cn } from "@/lib/utils";

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1120px] px-4 sm:px-6", className)}>{children}</div>;
}

const buttonBase =
  "inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2";

const buttonVariants = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600",
  secondary:
    "border border-slate-200 bg-white text-slate-800 hover:bg-indigo-50 focus-visible:outline-indigo-600",
  inverted: "bg-white text-indigo-700 hover:bg-indigo-50 focus-visible:outline-white",
} as const;

type ButtonLinkProps = {
  href: string;
  variant?: keyof typeof buttonVariants;
  className?: string;
  children: React.ReactNode;
};

export function ButtonLink({ href, variant = "primary", className, children }: ButtonLinkProps) {
  const classes = cn(buttonBase, buttonVariants[variant], className);
  if (href.startsWith("mailto:")) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

export function SectionHeading({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
      {children}
    </h2>
  );
}

export function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-500 text-white"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-base text-slate-700">{children}</span>
    </li>
  );
}
