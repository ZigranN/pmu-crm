"use client";

import { useEffect, useRef } from "react";
import { clearActiveStudioAction } from "@/features/auth/server/actions";

export function AutoClearStaleCookie() {
  const calledRef = useRef(false);
  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      clearActiveStudioAction().catch(() => {});
    }
  }, []);
  return null;
}
