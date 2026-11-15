import Link from "next/link";

export default function NotFound() {
  return <main className="loading-panel"><p className="eyebrow">404 / OFF THE MAP</p><h1>This page isn&apos;t on the route.</h1><Link className="button button-dark" href="/">Return to overview</Link></main>;
}
