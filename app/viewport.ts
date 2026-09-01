import type { Viewport } from "next";

/** Prevent pinch-zoom during mobile gameplay. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};
