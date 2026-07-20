import { DumpUI } from '@/components/dump-ui'
import { getTranscripts } from '@/app/actions'

export default async function DumpPage() {
  const initialTranscripts = await getTranscripts(7) // Get last 7 days/items

  return (
    <DumpUI initialTranscripts={initialTranscripts || []} />
  )
}
