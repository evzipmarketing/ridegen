import type { Metadata } from "next";
import "./builder.css";

export const metadata: Metadata = {
  title: { default: "Ridegen | EVZIP", template: "%s | Ridegen" },
  description: "",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Extensions can inject body attributes before hydration; keep suppression at this level only.
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
