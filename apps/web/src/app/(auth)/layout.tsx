import { AppTopBar } from "@/components/app-top-bar";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppTopBar />
      <main className="flex flex-1 items-center justify-center px-4 py-8 md:px-8 md:py-10">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}
