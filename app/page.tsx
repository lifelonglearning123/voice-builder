import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Voice Builder</h1>
      <p className="mt-3 text-lg text-slate-600">
        Build an inbound AI receptionist from a brief description. The wizard
        handles the rest — knowledge, voice, transfer, booking, and post-call
        analysis.
      </p>
      <div className="mt-10 flex items-center gap-4">
        {user ? (
          <Link
            href={'/dashboard' as never}
            className="inline-flex items-center rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go to dashboard →
          </Link>
        ) : (
          <>
            <Link
              href={'/signup' as never}
              className="inline-flex items-center rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Get started →
            </Link>
            <Link
              href={'/login' as never}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
