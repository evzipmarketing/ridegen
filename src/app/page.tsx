import { SessionDataProvider } from "@/components/session-data";
import { GenerationBuilder } from "@/components/generation-builder";

export default function HomePage() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  const day = parts.find((part) => part.type === "day")!.value;
  return <SessionDataProvider><GenerationBuilder initialDate={`${year}-${month}-${day}`} /></SessionDataProvider>;
}
