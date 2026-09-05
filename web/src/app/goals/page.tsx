import { permanentRedirect } from 'next/navigation';

export default async function GoalsPage() {
  permanentRedirect('/planner');
}
