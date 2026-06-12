"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { init } from "./core.js";
import { registerBeacon } from "./beacon.js";
import { pageview } from "./capture.js";
import type { SpyglassConfig } from "./types.js";

export interface SpyglassProviderProps {
  config: SpyglassConfig;
  children: React.ReactNode;
}

/**
 * Wrap your root layout with this component to get automatic pageview tracking
 * on every app-router navigation.
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
    init(config);
    registerBeacon();
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
