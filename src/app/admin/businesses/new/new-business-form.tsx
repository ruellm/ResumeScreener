"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slug";
import { createBusiness } from "../../actions";

export function NewBusinessForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // The slug follows the name until the user edits it.
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function onNameChange(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createBusiness({ name, slug });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          value={slug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value.toLowerCase());
          }}
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create business"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
