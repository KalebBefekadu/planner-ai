import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AuthButton from "@/components/auth-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavLinks } from "@/components/nav-links";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Planner AI",
  description: "Voice-First Life Operating System",
  manifest: "/manifest.json",
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
      <body className={inter.className}>
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
            <NavLinks />
            <ThemeToggle />
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
