import { headers } from 'next/headers';
import { resolveAgency } from '@/lib/agency/resolve';
import { WizardProvider } from '@/lib/wizard/context.tsx';

export default async function NewBotLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const agency = await resolveAgency({ host: hdrs.get('host'), querySlug: null });
  return <WizardProvider initialAgencyId={agency?.id ?? null}>{children}</WizardProvider>;
}
