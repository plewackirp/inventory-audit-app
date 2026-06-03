import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GoBros Inventory Audit",
  description: "Upload CSV or Excel inventory files and flag common data issues."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
