import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center bg-muted/30 p-6">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
