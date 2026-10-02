import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError =
    error === "link" ? "This link is invalid or has expired." : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Resume Screener</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm initialError={initialError} />
        </CardContent>
      </Card>
    </main>
  );
}
