import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["signup", "invite", "magiclink", "recovery", "email_change", "email"]),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (parsed.success) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp(parsed.data);
    if (!error) {
      return NextResponse.redirect(new URL("/set-password", request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
