import { requireSuperAdmin } from "@/lib/auth";
import { NewBusinessForm } from "./new-business-form";

export default async function NewBusinessPage() {
  await requireSuperAdmin();

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">New business</h1>
      <NewBusinessForm />
    </div>
  );
}
