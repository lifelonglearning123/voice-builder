import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveAgency } from '@/lib/agency/resolve';
import { ManageBillingButton } from './ManageBillingButton';

// Dashboard renders one of two views depending on the user's role IN THE
// AGENCY whose domain they're currently on:
//
//   - Agency staff (vb.agency_members for this agency) → portfolio mode
//   - SMB client  (vb.agency_clients for this agency) → own-bots mode
//
// A user may belong to multiple agencies (e.g. staff of macaws while
// also a client of artificialignorance). The Host header decides which
// "hat" they wear in this request, so each agency's data stays isolated.
//
// If both staff and client memberships exist for the same agency, the
// staff view wins — it's the more powerful one. When the host doesn't
// resolve to any agency (preview URLs etc.), we fall back to the first
// available membership so the user still sees something.

export const runtime = 'nodejs';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware should bounce unauthenticated requests; belt-and-braces.
  if (!user) {
    redirect('/login');
  }

  // Resolve the current host to an agency in parallel with the membership
  // probes — both feed into the view selection below.
  const h = await headers();
  const [hostAgency, { data: staffRows }, { data: clientRows }] = await Promise.all([
    resolveAgency({ host: h.get('host'), querySlug: null }),
    supabase
      .from('agency_members')
      .select('role, agencies(id, name, slug)')
      .eq('user_id', user.id),
    supabase
      .from('agency_clients')
      .select('agencies(id, name, slug)')
      .eq('user_id', user.id),
  ]);

  type StaffJoin = {
    role: 'owner' | 'admin' | 'staff';
    agencies: { id: string; name: string; slug: string } | null;
  };
  type ClientJoin = {
    agencies: { id: string; name: string; slug: string } | null;
  };

  const staffOf = ((staffRows as StaffJoin[] | null) ?? [])
    .filter((r): r is StaffJoin & { agencies: NonNullable<StaffJoin['agencies']> } => !!r.agencies);
  const clientOf = ((clientRows as ClientJoin[] | null) ?? [])
    .filter((r): r is ClientJoin & { agencies: NonNullable<ClientJoin['agencies']> } => !!r.agencies);

  // Pick membership scoped to the current host's agency. If the host
  // doesn't resolve to an agency (preview URL, unconfigured domain), fall
  // back to whatever the user has so they're not stranded.
  const activeStaff = hostAgency
    ? (staffOf.find((r) => r.agencies.id === hostAgency.id) ?? null)
    : (staffOf[0] ?? null);
  const activeClient = hostAgency
    ? (clientOf.find((r) => r.agencies.id === hostAgency.id) ?? null)
    : (clientOf[0] ?? null);

  return (
    <main className="min-h-screen">
      <DashboardHeader email={user.email ?? ''} isStaff={!!activeStaff} />

      <div className="mx-auto max-w-5xl px-6 py-16">
        {activeStaff ? (
          <StaffPortfolioView
            agency={activeStaff.agencies}
            role={activeStaff.role}
            supabase={supabase}
          />
        ) : activeClient ? (
          <ClientOwnView
            userId={user.id}
            agencyId={activeClient.agencies.id}
            supabase={supabase}
          />
        ) : (
          <NoAccessState />
        )}
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------------------
 * Header
 * ------------------------------------------------------------------------- */

function DashboardHeader({
  email,
  isStaff,
}: {
  email: string;
  isStaff: boolean;
}) {
  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400">
          VOICE BUILDER
        </p>
        <div className="flex items-center gap-4">
          {isStaff && (
            <Link
              href={'/dashboard/settings' as never}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Settings
            </Link>
          )}
          <span className="text-xs text-slate-500">{email}</span>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------------------
 * Agency staff: portfolio view
 * ------------------------------------------------------------------------- */

async function StaffPortfolioView({
  agency,
  role,
  supabase,
}: {
  agency: { id: string; name: string; slug: string };
  role: 'owner' | 'admin' | 'staff';
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}) {
  // Count clients + bots for this agency.
  const [{ count: clientCount }, { data: bots }] = await Promise.all([
    supabase
      .from('agency_clients')
      .select('user_id', { count: 'exact', head: true })
      .eq('agency_id', agency.id),
    supabase
      .from('bots')
      .select('id, status, draft, updated_at')
      .eq('agency_id', agency.id)
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  return (
    <>
      <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400 wizard-fade-up">
        AGENCY PORTFOLIO · {role.toUpperCase()}
      </p>
      <h1
        className="mt-3 text-4xl font-semibold tracking-[-0.035em] text-slate-900 wizard-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        {agency.name}
      </h1>
      <p
        className="mt-2 text-base text-slate-500 wizard-fade-up"
        style={{ animationDelay: '120ms' }}
      >
        {clientCount ?? 0} client{clientCount === 1 ? '' : 's'} · {bots?.length ?? 0}{' '}
        receptionist{(bots?.length ?? 0) === 1 ? '' : 's'}
      </p>

      <section
        className="mt-10 rounded-xl border border-slate-200 bg-white p-6 wizard-fade-up"
        style={{ animationDelay: '180ms' }}
      >
        <h2 className="text-sm font-semibold text-slate-900">Recent receptionists</h2>
        {!bots || bots.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No receptionists yet. SMB clients build their own — share your sign-up URL
            with them to onboard.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {bots.map((b) => {
              const draft = b.draft as { business_name?: string } | null;
              return (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {draft?.business_name || 'Untitled receptionist'}
                    </p>
                    <p className="mt-0.5 font-mono-tight text-[11px] uppercase tracking-[0.12em] text-slate-400">
                      {b.status}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    Updated {timeAgo(b.updated_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p
        className="mt-6 text-xs text-slate-400 wizard-fade-up"
        style={{ animationDelay: '240ms' }}
      >
        Client onboarding (invite flow) ships in M2. Stripe Connect onboarding ships in M3.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * SMB client: own-bots view
 * ------------------------------------------------------------------------- */

async function ClientOwnView({
  userId,
  agencyId,
  supabase,
}: {
  userId: string;
  agencyId: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}) {
  const { data: bots } = await supabase
    .from('bots')
    .select(
      'id, status, draft, updated_at, phone_e164, client_subscription_status, client_stripe_subscription_id, cancel_at_period_end, current_period_end',
    )
    .eq('owner_user_id', userId)
    .eq('agency_id', agencyId)
    .order('updated_at', { ascending: false });

  const hasBots = (bots?.length ?? 0) > 0;

  return (
    <>
      <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400 wizard-fade-up">
        YOUR RECEPTIONIST
      </p>
      <h1
        className="mt-3 text-4xl font-semibold tracking-[-0.035em] text-slate-900 wizard-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        Welcome back.
      </h1>

      {!hasBots ? (
        <div
          className="mt-12 flex flex-col items-start gap-3 wizard-fade-up sm:flex-row sm:items-center sm:gap-4"
          style={{ animationDelay: '180ms' }}
        >
          <Link href="/bots/new" className="wizard-pill">
            Build my AI receptionist
            <span aria-hidden="true">→</span>
          </Link>
          <span className="text-xs tracking-wide text-slate-400">
            Takes about ten minutes.
          </span>
        </div>
      ) : (
        <>
          <div
            className="mt-10 flex items-center justify-between wizard-fade-up"
            style={{ animationDelay: '180ms' }}
          >
            <p className="font-mono-tight text-[11px] tracking-[0.18em] uppercase text-slate-400">
              Your receptionists
            </p>
            <Link
              href={'/bots/new' as never}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-500 hover:text-slate-900"
            >
              <span aria-hidden="true" className="text-base leading-none">＋</span>
              Build another
            </Link>
          </div>
          <section
            className="mt-3 rounded-xl border border-slate-200 bg-white p-6 wizard-fade-up"
            style={{ animationDelay: '240ms' }}
          >
            <ul className="divide-y divide-slate-100">
            {bots!.map((b) => {
              const draft = b.draft as { business_name?: string } | null;
              const subStatus = b.client_subscription_status;
              const cancelPending = !!b.cancel_at_period_end;
              const periodEnd = b.current_period_end;
              return (
                <li
                  key={b.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {draft?.business_name || 'Your receptionist'}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span>{b.phone_e164 || 'No phone number yet'}</span>
                      <span className="text-slate-300">·</span>
                      <StatusPill
                        bot={b.status}
                        sub={subStatus}
                        cancelPending={cancelPending}
                      />
                    </p>
                    {cancelPending && periodEnd && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        Cancellation scheduled — service ends {formatDate(periodEnd)}.
                        Reactivate any time before then in Manage billing.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {b.client_stripe_subscription_id && (
                      <ManageBillingButton botId={b.id} />
                    )}
                    <Link
                      href={`/bots/new?bot=${b.id}` as never}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      Edit →
                    </Link>
                  </div>
                </li>
              );
            })}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * No access — should be rare after signup auto-provisioning is wired in M2.
 * ------------------------------------------------------------------------- */

function NoAccessState() {
  return (
    <>
      <p className="font-mono-tight text-[11px] tracking-[0.18em] text-slate-400 wizard-fade-up">
        DASHBOARD
      </p>
      <h1
        className="mt-3 text-4xl font-semibold tracking-[-0.035em] text-slate-900 wizard-fade-up"
        style={{ animationDelay: '60ms' }}
      >
        Welcome back.
      </h1>
      <div
        className="mt-10 rounded-xl border border-amber-200 bg-amber-50/60 p-5 wizard-fade-up"
        style={{ animationDelay: '120ms' }}
      >
        <p className="text-sm font-medium text-amber-900">
          Your account isn&apos;t linked yet
        </p>
        <p className="mt-1 text-xs text-amber-900/80">
          You signed in successfully, but you&apos;re not registered as a client of any
          agency. Reach out to whoever invited you, or visit your agency&apos;s sign-up
          page.
        </p>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function StatusPill({
  bot,
  sub,
  cancelPending,
}: {
  bot: string;
  sub: string | null;
  cancelPending?: boolean;
}) {
  // Combined status surface: subscription state generally wins over bot
  // state when the sub is in a problem state.
  const label =
    sub === 'past_due'
      ? 'Payment failed'
      : sub === 'canceled'
        ? 'Cancelled'
        : sub === 'unpaid'
          ? 'Payment failed'
          : cancelPending && bot === 'live'
            ? 'Cancelling soon'
            : bot === 'live'
              ? 'Live'
              : bot === 'archived'
                ? 'Archived'
                : 'Draft';
  const tone =
    label === 'Payment failed'
      ? 'border-red-200 bg-red-50 text-red-800'
      : label === 'Cancelling soon'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : label === 'Cancelled' || label === 'Archived'
          ? 'border-slate-200 bg-slate-50 text-slate-500'
          : label === 'Live'
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function timeAgo(iso: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
