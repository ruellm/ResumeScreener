import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";

export default async function AdminHomePage() {
  await requireSuperAdmin();

  const businesses = await db.business.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { users: true } } },
  });

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Businesses</h1>
        <Button asChild>
          <Link href="/admin/businesses/new">New business</Link>
        </Button>
      </div>

      {businesses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No businesses yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {businesses.map((business) => (
              <TableRow key={business.id}>
                <TableCell>
                  <Link
                    href={`/admin/businesses/${business.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {business.name}
                  </Link>
                </TableCell>
                <TableCell>{business.slug}</TableCell>
                <TableCell>
                  <Badge variant={business.isActive ? "default" : "secondary"}>
                    {business.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>{business._count.users}</TableCell>
                <TableCell>{formatDate(business.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
