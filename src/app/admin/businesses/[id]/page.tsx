import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { BusinessForm } from "./business-form";
import { UsersSection } from "./users-section";

export default async function BusinessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;

  const [business, settings] = await Promise.all([
    db.business.findUnique({
      where: { id },
      include: { users: { orderBy: { createdAt: "asc" } } },
    }),
    db.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  if (!business) notFound();

  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <Link
          href="/admin"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to businesses
        </Link>
        <h1 className="text-xl font-semibold">{business.name}</h1>
        <p className="text-sm text-muted-foreground">Slug: {business.slug}</p>
      </div>

      <BusinessForm
        business={{
          id: business.id,
          name: business.name,
          isActive: business.isActive,
          retentionDays: business.retentionDays,
          monthlyEvalLimit: business.monthlyEvalLimit,
          storageLimitMb: business.storageLimitMb,
        }}
        retention={{
          min: settings.minRetentionDays,
          max: settings.maxRetentionDays,
          default: settings.defaultRetentionDays,
        }}
      />

      <UsersSection
        businessId={business.id}
        users={business.users.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          isActive: user.isActive,
          lastLogin: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : null,
        }))}
      />
    </div>
  );
}
