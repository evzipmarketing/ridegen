"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="panel loading-panel" role="alert"><p className="eyebrow">SOMETHING INTERRUPTED THE JOURNEY</p><h2>We couldn&apos;t load this view.</h2><p className="muted">Please try again. If it continues, check the application setup.</p><button onClick={reset} className="button button-dark">Try again</button></section>;
}
