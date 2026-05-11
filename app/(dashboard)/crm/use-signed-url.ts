"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Resolve a Storage path to a short-lived signed URL. Returns null while
 * loading or if the path is null. Refetches when path changes.
 */
export function useSignedUrl(
  path: string | null | undefined,
  expiresInSec = 3600,
): string | null {
  const supabase = useMemo(() => createClient(), []);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    supabase.storage
      .from("wa-media")
      .createSignedUrl(path, expiresInSec)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path, expiresInSec, supabase]);

  return url;
}
