import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FDCP S3 Uploader",
  description: "Securely upload media files to AWS S3 and generate public shareable links.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
