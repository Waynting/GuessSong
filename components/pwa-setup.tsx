"use client";

import { useEffect } from "react";
import { initPwa } from "@/lib/pwa";

/** Mounted once in the root layout; renders nothing. */
export function PwaSetup() {
  useEffect(() => {
    initPwa();
  }, []);
  return null;
}
