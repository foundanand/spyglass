import type { ReactNode } from "react";

export const metadata = {
  title: "spyglass demo",
  description: "Throwaway app that exercises the spyglass SDK.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          margin: 0,
          padding: "3rem",
        }}
      >
        {children}
      </body>
    </html>
  );
}
