import { GoalsUI } from '@/components/goals-ui';
import { getActionTemplates, getGoalsHierarchy } from '@/app/actions';

export default async function GoalsPage() {
  const [initialData, initialTemplates] = await Promise.all([
    getGoalsHierarchy(),
    getActionTemplates(),
  ]);

  return <GoalsUI initialData={initialData} initialTemplates={initialTemplates} />;
}
