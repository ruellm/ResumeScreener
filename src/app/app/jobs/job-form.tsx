"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { JOB_LIMITS } from "@/lib/job-schema";
import { cn } from "@/lib/utils";
import { createJob, updateJob } from "./actions";
import { SkillPicker, type SkillOption } from "./skill-picker";

type SelectedSkill = SkillOption & { isRequired: boolean; isActive: boolean };

type JobFormProps = {
  // Active skills only.
  skillOptions: SkillOption[];
  job?: {
    id: string;
    title: string;
    roleOverview: string;
    requirements: string;
    idealCandidateProfile: string;
    passingCriteria: string;
    postUrl: string;
    skills: SelectedSkill[];
    hasSubmissions: boolean;
  };
};

const TEXT_FIELDS = [
  { name: "roleOverview", label: "Role overview", rows: 6 },
  { name: "requirements", label: "Requirements", rows: 8 },
  {
    name: "idealCandidateProfile",
    label: "Ideal candidate profile",
    rows: 6,
    help: "Describe the candidate you want. The AI uses this as its instruction when reading resumes.",
  },
  {
    name: "passingCriteria",
    label: "Passing criteria",
    rows: 6,
    help: "Describe how a resume passes, what makes it a maybe, and what makes it fail.",
  },
] as const;

export function JobForm({ skillOptions, job }: JobFormProps) {
  const [values, setValues] = useState({
    title: job?.title ?? "",
    roleOverview: job?.roleOverview ?? "",
    requirements: job?.requirements ?? "",
    idealCandidateProfile: job?.idealCandidateProfile ?? "",
    passingCriteria: job?.passingCriteria ?? "",
    postUrl: job?.postUrl ?? "",
  });
  const [skills, setSkills] = useState<SelectedSkill[]>(job?.skills ?? []);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const cancelHref = job ? `/app/jobs/${job.id}` : "/app";

  function setValue(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function toggleSkill(skill: SkillOption) {
    setSkills((current) => {
      if (current.some((item) => item.id === skill.id)) {
        return current.filter((item) => item.id !== skill.id);
      }
      if (current.length >= JOB_LIMITS.skills) return current;
      return [...current, { ...skill, isRequired: false, isActive: true }];
    });
  }

  function setRequired(skillId: string, isRequired: boolean) {
    setSkills((current) =>
      current.map((item) => (item.id === skillId ? { ...item, isRequired } : item)),
    );
  }

  function removeSkill(skillId: string) {
    setSkills((current) => current.filter((item) => item.id !== skillId));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      ...values,
      skills: skills.map((skill) => ({ skillId: skill.id, isRequired: skill.isRequired })),
    };
    startTransition(async () => {
      const result = job
        ? await updateJob({ id: job.id, ...payload })
        : await createJob(payload);
      // No result comes back when the action answers with a 404 or a redirect.
      if (result?.ok === false) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-2xl gap-6">
      {job?.hasSubmissions && (
        <p className="rounded-lg border bg-muted/50 p-3 text-sm">
          Changes apply to new evaluations only. Existing results keep the criteria
          they were scored with.
        </p>
      )}

      <div className="grid gap-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={values.title}
          onChange={(event) => setValue("title", event.target.value)}
          maxLength={JOB_LIMITS.title}
          required
        />
      </div>

      {TEXT_FIELDS.map((field) => {
        const length = values[field.name].trim().length;
        const max = JOB_LIMITS[field.name];
        return (
          <div key={field.name} className="grid gap-2">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Textarea
              id={field.name}
              rows={field.rows}
              value={values[field.name]}
              onChange={(event) => setValue(field.name, event.target.value)}
              aria-invalid={length > max}
              required
            />
            <div className="flex items-start justify-between gap-4 text-xs text-muted-foreground">
              <span>{"help" in field ? field.help : ""}</span>
              <span className={cn("shrink-0 tabular-nums", length > max && "text-destructive")}>
                {length} / {max}
              </span>
            </div>
          </div>
        );
      })}

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-4">
          <Label>Skills</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {skills.length} / {JOB_LIMITS.skills}
          </span>
        </div>
        {skills.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {skills.map((skill) => (
              <li key={skill.id} className="flex items-center justify-between gap-4 p-2 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">{skill.name}</span>
                  <span className="text-muted-foreground">{skill.category}</span>
                  {!skill.isActive && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`required-${skill.id}`}
                      checked={skill.isRequired}
                      onCheckedChange={(checked) => setRequired(skill.id, checked)}
                    />
                    <Label htmlFor={`required-${skill.id}`}>Required</Label>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSkill(skill.id)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div>
          <SkillPicker
            options={skillOptions}
            selectedIds={new Set(skills.map((skill) => skill.id))}
            atLimit={skills.length >= JOB_LIMITS.skills}
            onToggle={toggleSkill}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="postUrl">Job post URL</Label>
        <Input
          id="postUrl"
          type="url"
          placeholder="https://"
          value={values.postUrl}
          onChange={(event) => setValue("postUrl", event.target.value)}
        />
        <p className="text-xs text-muted-foreground">Stored for reference.</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : job ? "Save changes" : "Create job"}
        </Button>
        <Button asChild variant="outline">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
