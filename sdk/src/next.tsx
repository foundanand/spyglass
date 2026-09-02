"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { startAll } from "./start.js";
import { pageview } from "./capture.js";
import type { SpyglassConfig } from "./types.js";

export interface SpyglassProviderProps {
  config: SpyglassConfig;
  children: React.ReactNode;
}

/**
 * Wrap your layout with this component to start spyglass and get automatic
 * pageview tracking on every app-router navigation.
 *
 * Mount it *inside* your auth gate, not at the root: `config.user.id` is
 * required, and a provider above the login screen has no user to name.
 *
 * @example
 * // app/layout.tsx
 * import { SpyglassProvider } from "@spyglass/sdk/next";
 * export default function RootLayout({ children }) {
 *   return <SpyglassProvider config={sdkConfig}>{children}</SpyglassProvider>;
 * }
 */
export function SpyglassProvider({ config, children }: SpyglassProviderProps) {
  useEffect(() => {
    // startAll, not init: the provider is the documented app-router setup, and
    // it has to turn on everything init() does (errors, network, replay, the
    // report widget) or those silently never run. See start.ts.
    startAll(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams?.toString();
    pageview(pathname + (qs ? `?${qs}` : ""));
  }, [pathname, searchParams]);

  return <>{children}</>;
}
