'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Step10Redirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/bots/new/6');
  }, [router]);
  return <main className="mx-auto max-w-3xl px-6 py-12 text-slate-500">Loading…</main>;
}
