# Ridegen

EVZIP's open, single-page synthetic ride generator. No login or database is required. Use CSV reference files, dated vehicle idle windows, and INR fare/revenue criteria. Every generated record is explicitly synthetic.

## Local Setup

Requirements: Node.js 22.13+ (Node 24 LTS recommended) and npm.

```powershell
npm install
npm run dev
```

Open [Ridegen](http://127.0.0.1:3000). Both local development and production servers bind to loopback. Public hosting needs a separate access/privacy review because there is no authentication.

## Required CSV Uploads

Download the current templates from each upload card. **Earlier vehicle/location/customer templates are no longer compatible.** Headers ignore case and normalize spaces/hyphens to underscores. Each file is limited to 5 MB and 10,000 records; Excel workbooks must be exported to CSV.

| Upload | Required Columns | Optional Columns |
| --- | --- | --- |
| Drivers | `name` | `pilot_id` |
| Pickup/drop routes | `pickup,drop,distance_km` | `route_id,distance_source` |
| Users | `customer_id,name,registered_at` | `phone,email` |
| Vehicle idle windows | `idle_date,registration,make,idle_start,idle_end` | `vehicle_id` |
| Existing rides (optional) | `ride_id,registration,customer_id,start_at,end_at` | `pilot_id,pilot_name`; at least one driver identity is required |

Driver IDs are generated internally when omitted. Provide IDs if existing rides use them; alternatively identify existing drivers by `pilot_name`. Conflicting driver IDs/names are rejected. Route IDs are generated when omitted.

Vehicles may use a combined `idle_timings` column instead of separate `idle_start,idle_end`, for example `20:00-5:00`. Common vehicle aliases include `idle_vehicle_number`, `vehicle_number`, and `idle_vehicle_make`. Users may use `user_id,user_name,registered_date`. See the downloadable templates for canonical headings.

Use one vehicle row per date/window. Repeated vehicles on different dates are valid; duplicate or overlapping windows and inconsistent makes are rejected. Routes need distinct endpoints and positive supplied distances up to 2000 km, with at most six decimal places. Duplicate driver names, route pairs/IDs, customer IDs, and existing ride IDs are rejected.

Dates accept `YYYY-MM-DD` or Indian `DD/MM/YYYY` / `DD-MM-YYYY`. Times accept 24-hour `HH:mm` (single-digit hours normalize automatically). Registration/existing-ride timestamps use ISO format, such as `2025-10-15T10:30:00+05:30`. Timezone-free timestamps and date-only registration values use IST; date-only means midnight. Existing booking duration is limited to 366 days as an input-processing safeguard.

## Criteria and Fixed Rules

All four primary uploads and all six form fields are required: From idle date, To idle date, target revenue, average price/km, minimum user fare, and maximum fare. Periods may include up to 366 idle start dates. The target checkbox selects net (checked) versus gross/GST-inclusive (unchecked).

- Currency/timezone are fixed to INR and Asia/Kolkata. There are no currency, working-day, shift, speed, gap, seed, or day-off inputs.
- Only uploaded idle windows whose **start dates** fall in the inclusive From/To range are eligible. `2025-10-29,20:00-05:00` means 29 October at 20:00 through 30 October at 05:00. A window on the final selected date can finish the next morning.
- Drivers have one full calendar day off per Monday-Sunday week, chosen internally and avoiding existing booked days when possible. A week already fully booked by existing rides cannot receive synthetic work. Overnight rides cannot cross a driver's day off.
- Working days have a hard cap/target of 26 per calendar month, counting dates touched by existing and generated work. A short period, sparse vehicle availability, weekly rest, or low target may make 26 days unattainable; the app warns rather than inventing availability.
- Vehicle turnaround minimums are randomized in integer seconds from 241 to 299 (4:01-4:59), not round-minute constants. Actual waiting may be longer when bookings, user registration, driver rest, or separate idle windows require it.
- Request timestamps use randomized placement, dispatch delays, trip speeds (10-80 km/h), and second-level turnarounds. All request-to-completion intervals are checked for vehicle, driver, and user conflicts.
- Users receive rides strictly after their registration timestamp. Assignments and route selection are randomized.
- Fare is `max(minimum fare, round(distance_km * average price/km))`, in whole rupees. The floor applies even below 2 km. Routes exceeding the maximum fare are excluded, not given fictitious distances. Randomizing route selection varies fares while preserving distance-based pricing.
- Each distinct fare may occur at most three times per generated batch, including the minimum-fare value. Few routes or repeated route fares can severely limit achievable revenue; this cap is never silently relaxed.
- No waiting/night surcharges. Supplied distances retain provenance; the app performs no external road-routing verification or vehicle repositioning-distance calculation.

## Existing Rides

All uploaded existing rides block overlapping vehicle, driver, and user bookings, regardless of the restriction checkbox. They are not re-exported as newly generated rides.

When **Use only vehicles and drivers found in existing rides** is checked, generation uses the intersection of uploaded reference resources and resources present in existing rides, and only bounded gaps between consecutive existing vehicle rides, intersected with uploaded idle windows. No generation before the first or after the last existing booking in that mode. Buffers next to existing vehicle rides are conservatively five minutes.

## Revenue and Downloads

GST is configured at the requested 5%: gross = net x 1.05; net = gross / 1.05. Whole-rupee gross/user fares are split into net and GST in integer paise per ride, then summed so net + GST always equals gross. The target selector determines which total is reconciled. Target equivalences are indicative rounded conversions; per-ride tax rounding can create a small difference.

The generator is bounded to 5000 rides / 60,000 scheduling attempts. It is not an exact-target optimizer. A batch is complete only when it contains rides and its selected-basis total is within INR 1 of the target; otherwise it is **partial**, with the actual signed difference and limitations shown. Partial output is never claimed to prove that no other schedule can meet the target.

The preview shows up to 50 rides. Download all generated rows as CSV and the full batch/audit JSON. Every CSV row includes unique ride/batch IDs, `synthetic=true`, `data_type=SYNTHETIC`, batch status, timestamps, identities, route distance/source, whole-rupee fare, and GST/net totals. Spreadsheet formula injection is escaped. Audit metadata includes rule/version information, input hash, driver calendar, and an internal randomization value; it is not a user-entered seed field.

## Privacy and Verification

CSV parsing and input previews happen in the browser. Selecting **Generate** sends the required generation fields to the local server for temporary in-memory processing; phone/email fields are omitted. No uploaded inputs, generated batches, or contact details are saved to a database, browser storage, or application files. Refresh/close clears inputs/results. Keep source files and download desired output before refreshing.

`POST /api/generate` revalidates inputs, limits combined JSON input to 8 MB, rejects cross-origin browser calls, and independently validates output. It is open/local, not a public authenticated service. `GET /api/status` reports the app mode without exposing uploaded records.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Generated `.next-cache-*` backups are excluded from source checks. OneDrive may lock or mark generated output directories as reparse/read-only entries; setting aside only the verified generated `.next` directory allows a fresh build without changing source files. Do not delete user data to resolve cache issues.

The lint parser uses a tested minimatch 11 override for GHSA-g3hv-75wg-m249. Revisit it when upgrading typescript-eslint. Optional Google Fonts has local font fallbacks.
