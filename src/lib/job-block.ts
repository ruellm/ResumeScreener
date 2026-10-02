// The job as the model sees it. The worker sends this text and stores it in
// the evaluation's snapshot. The result page builds it again from the current
// job to tell whether the job's content changed since the evaluation.

export type JobSkillRef = { name: string; isRequired: boolean };

type JobContent = {
  title: string;
  roleOverview: string;
  requirements: string;
  idealCandidateProfile: string;
  passingCriteria: string;
  skills: { isRequired: boolean; skill: { name: string } }[];
};

// A fixed order keeps the block identical for the same job content.
export function orderedJobSkills(job: Pick<JobContent, "skills">): JobSkillRef[] {
  return job.skills
    .map(({ skill, isRequired }) => ({ name: skill.name, isRequired }))
    .sort(
      (a, b) =>
        Number(b.isRequired) - Number(a.isRequired) || (a.name < b.name ? -1 : 1),
    );
}

export function buildJobBlock(job: JobContent) {
  const skills = orderedJobSkills(job);
  const skillLines =
    skills.length === 0
      ? "None listed."
      : skills
          .map((skill) => `- ${skill.name} (${skill.isRequired ? "required" : "optional"})`)
          .join("\n");

  return [
    "<job>",
    `<title>\n${job.title}\n</title>`,
    `<role_overview>\n${job.roleOverview}\n</role_overview>`,
    `<requirements>\n${job.requirements}\n</requirements>`,
    `<skills>\n${skillLines}\n</skills>`,
    `<ideal_candidate_profile>\n${job.idealCandidateProfile}\n</ideal_candidate_profile>`,
    `<passing_criteria>\n${job.passingCriteria}\n</passing_criteria>`,
    "</job>",
  ].join("\n");
}
