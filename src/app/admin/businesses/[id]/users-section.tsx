"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addBusinessUser, newSetPasswordLink, setUserActive } from "../../actions";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  lastLogin: string | null;
};

type UsersSectionProps = {
  businessId: string;
  users: UserRow[];
};

export function UsersSection({ businessId, users }: UsersSectionProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>();
  // Kept only in memory, so the link is gone once the dialog closes.
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onAddUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await addBusinessUser({
        businessId,
        email: form.get("email"),
        name: form.get("name"),
      });
      if (result.ok) {
        setError(undefined);
        setLink(result.link);
        formRef.current?.reset();
      } else {
        setError(result.error);
      }
    });
  }

  function onNewLink(userId: string) {
    startTransition(async () => {
      const result = await newSetPasswordLink({ userId });
      if (result.ok) setLink(result.link);
      else toast.error(result.error);
    });
  }

  function onSetActive(userId: string, isActive: boolean) {
    startTransition(async () => {
      const result = await setUserActive({ userId, isActive });
      if (!result.ok) toast.error(result.error);
    });
  }

  async function onCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success("Link copied");
  }

  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-semibold">Users</h2>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.name}</TableCell>
                <TableCell>
                  <Badge variant={user.isActive ? "default" : "secondary"}>
                    {user.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>{user.lastLogin ?? "Never"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onNewLink(user.id)}
                    >
                      New set-password link
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onSetActive(user.id, !user.isActive)}
                    >
                      {user.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <form
        ref={formRef}
        onSubmit={onAddUser}
        className="grid max-w-md gap-4 rounded-lg border p-4"
      >
        <h3 className="font-medium">Add user</h3>
        <div className="grid gap-2">
          <Label htmlFor="user-email">Email</Label>
          <Input id="user-email" name="email" type="email" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="user-name">Name</Label>
          <Input id="user-name" name="name" required />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Working..." : "Add user"}
          </Button>
        </div>
      </form>

      <Dialog
        open={link !== null}
        onOpenChange={(open) => {
          if (!open) setLink(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Set-password link</DialogTitle>
            <DialogDescription>
              Send this link to the user. It is shown only once and works a
              single time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={link ?? ""} onFocus={(event) => event.target.select()} />
            <Button type="button" onClick={onCopy}>
              Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
