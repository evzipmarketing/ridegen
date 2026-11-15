# Ridegen Current Development Status

The active requirements are PRD v2.0, replacing the original database/authentication plan and earlier manual-entry/month/shift configuration.

## Implemented

- One open page; INR/IST fixed; no login, database, manual reference records, seed, shift, gap, day-off, or working-day controls.
- Required driver, distance-route, user-registration, and dated vehicle-idle CSV uploads, plus optional existing rides; templates, validation, and replacement previews.
- Required From/To dates, target net/gross selector, price/km, minimum fare, and maximum fare.
- Stateless server generation with internal randomization, weekly rest, 26-day monthly cap/target, overnight availability, random second-level vehicle turnarounds, and nonoverlap for vehicles/drivers/users.
- Registration-date enforcement; supplied routes/distances; whole-rupee distance-based pricing and minimum floor; at most three uses of a fare.
- Existing bookings block conflicts in every mode. Restricted mode fills only bounded between-ride gaps using existing vehicles/drivers.
- Five-percent GST and integer-paise reconciliation; partial-batch warnings and target difference rather than false success.
- Independently validated results, same-page preview, all-ride synthetic CSV export, and audit JSON.

## Verification

Verified locally: lint, TypeScript, 28 automated tests, production build, required-input errors, all four uploads, gross and net generation, existing-rides-only mode, mobile layout, and an actual downloaded CSV with synthetic markers and reconciled GST/net totals.

- Input tests cover required fields, date ordering, CSV limits, names-only drivers, dated/overlapping idle windows, combined `20:00-5:00` times, routes, user registrations, and existing-rides identities/timestamps.
- Engine tests cover multiple internal randomization values, overnight windows, overlap invariants, pricing/minimum floors, three-use fare cap, GST/net targets, partial output, registrations, rest days, existing-resource restrictions, and tampered-output detection.
- API tests cover malformed inputs, cross-origin rejection, no-store responses, and synthetic generation.
- Run lint, type checking, tests, production build, and the full browser upload/generate/download workflow after changes.

## Remaining Improvements

- Improve bounded target optimization without weakening the hard constraints; exact matching may not exist.
- Add larger-dataset performance profiling, background processing if needed, richer pilot/vehicle daily summaries, and optional Excel export.
- Add optional reviewed routing/repositioning constraints only with appropriate distance data.
- Review public hosting/access/privacy and distributed generation limits before deploying beyond loopback.

## Important Interpretation

The period selects idle **start dates**, with overnight completion allowed next morning. Twenty-six working days is a target/cap, not guaranteed work when dates/windows/rest do not support it. Fares come from distance-based pricing, not independent price randomization. A four-to-five-minute vehicle turnaround is a required minimum; actual waits may be longer due to source bookings/availability. Revenue tolerance is INR 1, and unsuccessful bounded runs remain explicitly partial.
