import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AuthButton from "@/components/auth-button";

export const metadata: Metadata = {
  title: "Planner AI",
  description: "Voice-First Life Operating System",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header className="glass" style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          padding: "1rem 2rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div style={{ fontWeight: 700, fontSize: "1.25rem", letterSpacing: "-0.025em" }}>
            Planner AI
          </div>
          <nav style={{ display: "flex", alignItems: "center", gap: "1.5rem", fontSize: "0.95rem", fontWeight: 500, color: "var(--text-secondary)" }}>
            <Link href="/" style={{ color: "var(--text-primary)" }}>Dump</Link>
            <Link href="/vision">Vision</Link>
            <Link href="/goals">Goals</Link>
            {user && <AuthButton email={user.email || ""} />}
          </nav>
        </header>
        
        <main style={{ 
          flex: 1, 
          display: "flex", 
          flexDirection: "column",
          maxWidth: "800px",
          width: "100%",
          margin: "0 auto",
          padding: "2rem"
        }}>
          {children}
        </main>
      </body>
    </html>
  );
}
