import Papa from "papaparse";
import type { GenerationResult } from "./generation";

export function exportRideCsv(result: Pick<GenerationResult, "rides" | "summary">): string {
  const fields = ["original/synthetic", "request_made_at", "vehicle_no", "user_id", "user_name", "driver_id", "driver_name", "pickup_address", "drop_address", "distance", "net fare", "gross fare"];
  const data = result.rides.map((ride) => [
    "SYNTHETIC", ride.request_at, ride.vehicle_number, ride.customer_id, ride.user_name,
    ride.pilot_id ?? "", ride.driver_name, ride.pickup, ride.drop, ride.distance_km,
    (ride.net_paise / 100).toFixed(2), ride.fare_inr,
  ]);
  return Papa.unparse({ fields, data }, { escapeFormulae: true });
}
