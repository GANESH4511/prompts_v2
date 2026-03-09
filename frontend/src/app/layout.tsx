import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DashboardModeProvider } from "@/contexts/DashboardModeContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "Prompt Metadata Viewer | HR Assist",
    description: "View and manage prompt metadata for HR Assist Dashboard",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={inter.className}>
                <ThemeProvider>
                    <DashboardModeProvider>
                        {children}
                    </DashboardModeProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
