import { RESUMES_BUCKET } from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PermanentError } from "./errors";

export async function downloadResume(storageKey: string | null) {
  if (!storageKey) throw new PermanentError("Uploaded file not found.");

  const { data, error } = await supabaseAdmin.storage
    .from(RESUMES_BUCKET)
    .download(storageKey);
  if (error) {
    const { code, statusCode } = error as { code?: string; statusCode?: string };
    if (code === "NoSuchKey" || statusCode === "404") {
      throw new PermanentError("Uploaded file not found.");
    }
    throw new Error(`Storage download failed: ${error.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}
