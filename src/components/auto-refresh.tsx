"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Reloads the page data on a timer, for pages that show work in progress.
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
