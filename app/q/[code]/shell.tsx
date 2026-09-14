/** The centred, full-height page frame both quiz pages sit in. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 bg-background text-foreground">
      {children}
    </main>
  );
}
