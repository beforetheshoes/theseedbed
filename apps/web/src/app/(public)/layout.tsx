import { AppTopBar } from "@/components/app-top-bar";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <AppTopBar />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
