import { db } from "@/lib/db";

const PREVIEW_CHARS = 300;

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: npm run show-extraction -- <submissionId>");

  const submission = await db.submission.findUnique({
    where: { id },
    select: {
      originalFilename: true,
      status: true,
      attempts: true,
      error: true,
      extractionMethod: true,
      extractionMeta: true,
      hiddenTextFlagsJson: true,
      extractedText: true,
    },
  });
  if (!submission) throw new Error(`Submission ${id} not found.`);

  const text = submission.extractedText;
  console.log(`file:             ${submission.originalFilename}`);
  console.log(`status:           ${submission.status} (attempts ${submission.attempts})`);
  console.log(`error:            ${submission.error ?? "none"}`);
  console.log(`extractionMethod: ${submission.extractionMethod ?? "none"}`);
  console.log(`extractionMeta:   ${JSON.stringify(submission.extractionMeta)}`);
  console.log(`hiddenTextFlagsJson: ${JSON.stringify(submission.hiddenTextFlagsJson, null, 2)}`);
  console.log(
    text === null
      ? "extractedText:    none"
      : `extractedText (first ${PREVIEW_CHARS} of ${text.length} characters):\n${text.slice(0, PREVIEW_CHARS)}`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
