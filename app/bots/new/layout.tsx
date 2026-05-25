import { WizardProvider } from '@/lib/wizard/context.tsx';

export default function NewBotLayout({ children }: { children: React.ReactNode }) {
  return <WizardProvider>{children}</WizardProvider>;
}
