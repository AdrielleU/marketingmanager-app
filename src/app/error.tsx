'use client';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="page-title">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">{error.message}</p>
      <button className="btn-secondary mt-6" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
