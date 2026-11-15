import { z } from "zod";
import { calendarDate, DAY_MS, timestamp } from "./ride-time";

const amount = z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/, "Enter a positive amount with at most two decimal places.").refine((value) => Number(value) > 0, "Enter an amount greater than zero.");
const wholeFare = z.string().regex(/^\d{1,6}$/, "Enter a whole-rupee fare without decimals.").refine((value) => Number(value) > 0, "Fare must be greater than zero.");
const date = z.string().refine((value) => calendarDate(value) === value, "Choose a valid date.");
export const criteriaSchema = z.object({
  fromDate: date, toDate: date, targetRevenue: amount, revenueBasis: z.enum(["net", "gross"]), averagePricePerKm: amount, minimumFare: wholeFare, maximumFare: wholeFare, onlyExistingResources: z.boolean()
}).superRefine((values, context) => {
  if (values.toDate < values.fromDate) context.addIssue({ code: "custom", path: ["toDate"], message: "To date must be on or after From date." });
  if ((timestamp(values.toDate) - timestamp(values.fromDate)) / DAY_MS > 365) context.addIssue({ code: "custom", path: ["toDate"], message: "Select no more than 366 idle start dates per batch." });
  if (Number(values.minimumFare) > Number(values.maximumFare)) context.addIssue({ code: "custom", path: ["maximumFare"], message: "Maximum fare must be at least the minimum fare." });
});
export type RideCriteria = z.infer<typeof criteriaSchema>;
export type CriteriaInput = RideCriteria;
export function defaultCriteria(date: string): CriteriaInput { return { fromDate: date, toDate: date, targetRevenue: "", revenueBasis: "gross", averagePricePerKm: "", minimumFare: "", maximumFare: "", onlyExistingResources: false }; }
export function toMinorUnits(value: string): number { const [whole, fraction = ""] = value.split("."); return Number(whole) * 100 + Number(fraction.padEnd(2, "0")); }
export function checkCriteria(input: CriteriaInput, counts: { pilots: number; vehicles: number; locations: number; customers: number; existing: number }) {
  const result = criteriaSchema.safeParse(input);
  const errors = result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(" ").replace(/([A-Z])/g, " $1").toLowerCase()}: ${issue.message}`);
  for (const [key, label] of [["pilots", "driver names"], ["vehicles", "dated vehicle idle windows"], ["locations", "pickup/drop routes with distances"], ["customers", "users with IDs and registration dates"]] as const) if (!counts[key]) errors.push(`Upload ${label}.`);
  if (input.onlyExistingResources && !counts.existing) errors.push("Upload existing rides before selecting the existing-resources-only option.");
  return { errors, warnings: ["Idle dates select window start dates; overnight windows finish the following morning.", "26 working days per calendar month is a target/cap, with one day off per week. Limited idle dates can prevent reaching the target.", "Fare is rounded from distance x price/km, with the minimum-fare floor and maximum limit. Routes are randomized; no fare is used more than three times. These constraints can make revenue targets unreachable."] };
}
