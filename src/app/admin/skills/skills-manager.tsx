"use client";

import { Fragment, useState, useTransition } from "react";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addSkill, renameSkill, setSkillActive } from "./actions";

type SkillRow = {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
  jobCount: number;
};

const NEW_CATEGORY = "__new__";

export function SkillsManager({ skills }: { skills: SkillRow[] }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [addError, setAddError] = useState<string>();
  const [renaming, setRenaming] = useState<SkillRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Skills arrive sorted by category, so groups keep that order.
  const groups = new Map<string, SkillRow[]>();
  for (const skill of skills) {
    const group = groups.get(skill.category);
    if (group) group.push(skill);
    else groups.set(skill.category, [skill]);
  }
  const categories = [...groups.keys()];

  function onAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await addSkill({
        name,
        category: category === NEW_CATEGORY ? newCategory : category,
      });
      if (result.ok) {
        setAddError(undefined);
        setName("");
        toast.success("Skill added");
      } else {
        setAddError(result.error);
      }
    });
  }

  function openRename(skill: SkillRow) {
    setRenaming(skill);
    setRenameValue(skill.name);
    setRenameError(undefined);
  }

  function onRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renaming) return;
    startTransition(async () => {
      const result = await renameSkill({ id: renaming.id, name: renameValue });
      if (result.ok) {
        setRenaming(null);
        toast.success("Skill renamed");
      } else {
        setRenameError(result.error);
      }
    });
  }

  function onSetActive(skill: SkillRow) {
    startTransition(async () => {
      const result = await setSkillActive({ id: skill.id, isActive: !skill.isActive });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={onAdd} className="grid max-w-md gap-4 rounded-lg border p-4">
        <h2 className="font-medium">Add skill</h2>
        <div className="grid gap-2">
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="skill-category">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="skill-category" className="w-full">
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectItem value={NEW_CATEGORY}>New category...</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {category === NEW_CATEGORY && (
            <Input
              aria-label="New category name"
              placeholder="New category name"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              required
            />
          )}
        </div>
        {addError && (
          <p role="alert" className="text-sm text-destructive">
            {addError}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Working..." : "Add skill"}
          </Button>
        </div>
      </form>

      {skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No skills yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Jobs</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...groups].map(([groupName, rows]) => (
              <Fragment key={groupName}>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={5} className="font-medium">
                    {groupName} ({rows.length})
                  </TableCell>
                </TableRow>
                {rows.map((skill) => (
                  <TableRow key={skill.id}>
                    <TableCell>{skill.name}</TableCell>
                    <TableCell>{skill.category}</TableCell>
                    <TableCell>
                      <Badge variant={skill.isActive ? "default" : "secondary"}>
                        {skill.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>{skill.jobCount}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => openRename(skill)}
                        >
                          Rename
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => onSetActive(skill)}
                        >
                          {skill.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename skill</DialogTitle>
            <DialogDescription>
              Jobs that use this skill will show the new name.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onRename} className="grid gap-4">
            <Input
              aria-label="Skill name"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              required
            />
            {renameError && (
              <p role="alert" className="text-sm text-destructive">
                {renameError}
              </p>
            )}
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
