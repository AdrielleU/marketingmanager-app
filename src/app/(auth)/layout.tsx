export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-semibold text-brand-700">Marketing Manager</p>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
