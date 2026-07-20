import { GoalsUI } from '@/components/goals-ui'
import { getGoalsHierarchy } from '@/app/actions'

export default async function GoalsPage() {
  const initialData = await getGoalsHierarchy()

  return (
    <GoalsUI initialData={initialData} />
  )
}
