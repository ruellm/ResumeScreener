import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4 text-center">
        <h1 className="text-3xl font-semibold">Resume Screener</h1>
        <p className="max-w-md text-muted-foreground">
          AI resume screening for hiring teams. Upload, email or drop resumes in Google Drive and
          get evidence-based results.
        </p>
        <Button asChild>
          <Link href="/login">Log in</Link>
        </Button>
      </main>
      <footer className="p-4 text-center text-sm text-muted-foreground">
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
