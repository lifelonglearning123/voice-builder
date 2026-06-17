import './globals.css';
import type { Metadata } from 'next';
import { PostHogProvider } from '@/components/analytics/PostHogProvider';

export const metadata: Metadata = {
  title: 'Voice Builder',
  description: 'Build inbound AI receptionists from a brief description.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900" suppressHydrationWarning>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
