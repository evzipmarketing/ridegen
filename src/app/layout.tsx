import type { Metadata } from "next";
import "./builder.css";

export const metadata: Metadata = {
  title: { default: "Ridegen | EVZIP", template: "%s | Ridegen" },
  description: "The EVZIP workspace for clearly labelled synthetic ride datasets.",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
