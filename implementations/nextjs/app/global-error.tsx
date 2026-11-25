'use client';

// Replaces the root layout when it fails (for example, the database is down
// while reading the session), so it renders its own <html> and <body>.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <main>
          <h1>The application is unavailable</h1>
          <p>Please try again in a moment.</p>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
