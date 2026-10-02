import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { SetPasswordForm } from "./set-password-form";

export default async function SetPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
