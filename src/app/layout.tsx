import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Marketing Manager',
  description: 'Plan, schedule and measure your social posts',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
