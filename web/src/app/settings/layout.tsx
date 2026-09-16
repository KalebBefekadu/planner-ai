import { SettingsRelatedLinks } from '@/components/settings-tabs';

/* Every Settings page ends with the same question — "where do I change the
   thing this page only reports?" — so the answer belongs to the whole area
   rather than to any one page. Putting it in the layout also means a new
   Settings section cannot ship without it. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SettingsRelatedLinks canonical={process.env.PLANNER_DATA_MODEL === 'canonical'} />
    </>
  );
}
