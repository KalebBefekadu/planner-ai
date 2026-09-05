import { getActionTemplates, getGoalsHierarchy } from '@/app/actions';
import { PlannerWorkspace } from '@/components/planner-workspace';

export default async function PlannerPage() {
  const [initialData, initialTemplates] = await Promise.all([
    getGoalsHierarchy(),
    getActionTemplates(),
  ]);

  return <PlannerWorkspace initialData={initialData} initialTemplates={initialTemplates} />;
}
