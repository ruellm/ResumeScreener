import { AreaHeader } from "@/components/area-header";
import { requireBusinessUser } from "@/lib/auth";

export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireBusinessUser();

  return (
    <>
      <AreaHeader
        title="Resume Screener"
        href="/app"
        email={user.email}
        businessName={user.business.name}
        links={[
          { href: "/app", label: "Jobs" },
          { href: "/app/settings", label: "Settings" },
        ]}
      />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
