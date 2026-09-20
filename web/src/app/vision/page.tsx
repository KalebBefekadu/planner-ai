import { VisionUI } from '@/components/vision-ui';
import { getActiveVision } from '@/app/vision/actions';

export default async function VisionPage() {
  const initialVision = await getActiveVision();

  return <VisionUI initialVision={initialVision} />;
}
