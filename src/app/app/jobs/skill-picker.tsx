"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type SkillOption = { id: string; name: string; category: string };

type SkillPickerProps = {
  // Active skills, sorted by category then name.
  options: SkillOption[];
  selectedIds: Set<string>;
  atLimit: boolean;
  onToggle: (skill: SkillOption) => void;
};

export function SkillPicker({ options, selectedIds, atLimit, onToggle }: SkillPickerProps) {
  const [open, setOpen] = useState(false);

  const groups = new Map<string, SkillOption[]>();
  for (const skill of options) {
    const group = groups.get(skill.category);
    if (group) group.push(skill);
    else groups.set(skill.category, [skill]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-expanded={open}>
          Add skills
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search skills..." />
          <CommandList>
            <CommandEmpty>No skills found.</CommandEmpty>
            {[...groups].map(([category, skills]) => (
              <CommandGroup key={category} heading={category}>
                {skills.map((skill) => {
                  const selected = selectedIds.has(skill.id);
                  return (
                    <CommandItem
                      key={skill.id}
                      value={skill.name}
                      keywords={[category]}
                      data-checked={selected}
                      disabled={atLimit && !selected}
                      onSelect={() => onToggle(skill)}
                    >
                      {skill.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
