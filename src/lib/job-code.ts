// The code people use to refer to a job: in an email subject, in the Drive
// folder name and when talking to each other. Made from the job's emailAlias.

const PREFIX = "JOB-";

export function jobCode(emailAlias: string) {
  return `${PREFIX}${emailAlias.toUpperCase()}`;
}

export function jobTitleWithCode(job: { title: string; emailAlias: string }) {
  return `${job.title} (${jobCode(job.emailAlias)})`;
}

// What to look for in emailAlias when someone types a code, with or without
// the prefix and in any case. Aliases are stored in lowercase.
export function aliasSearchTerm(query: string) {
  const text = query.trim().toLowerCase();
  return text.startsWith(PREFIX.toLowerCase()) ? text.slice(PREFIX.length) : text;
}
