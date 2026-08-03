"use client";

import { useEffect, useState } from "react";
import { detectErrorLocale, type ErrorLocale } from "@/lib/error-messages";

/**
 * The language this device reads errors in.
 *
 * Starts at "en" and moves to the detected locale in an effect rather than
 * reading `navigator` during render: the setup page and both join pages are
 * server-rendered, and a render that disagreed with the server's would be a
 * hydration mismatch. Nothing flashes, because an error slot is empty on the
 * first paint by definition — there is no error yet.
 */
export function useErrorLocale(): ErrorLocale {
  const [locale, setLocale] = useState<ErrorLocale>("en");
  useEffect(() => {
    setLocale(detectErrorLocale());
  }, []);
  return locale;
}
