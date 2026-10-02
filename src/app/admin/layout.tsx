import { AreaHeader } from "@/components/area-header";
import { requireSuperAdmin } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSuperAdmin();

  return (
    <>
      <AreaHeader
        title="Resume Screener Admin"
        href="/admin"
        email={user.email}
        links={[
          { href: "/admin", label: "Businesses" },
          { href: "/admin/skills", label: "Skills" },
        ]}
      />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
