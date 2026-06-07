import { redirect } from 'next/navigation';

// The review step has been removed from the wizard. Anyone landing here —
// from an in-progress session, a stale bookmark, or the browser back/forward
// stack — is forwarded to the current next step.
export default function RemovedReviewStep() {
  redirect('/bots/new/6');
}
