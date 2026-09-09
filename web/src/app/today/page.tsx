import { permanentRedirect } from 'next/navigation';

// This directory holds Today's server actions but never held a route, so
// /today -- the address a person is most likely to type or bookmark for the
// screen they use every day -- returned not-found. Today is served at / and at
// /planner/today.
//
// The missing route had already misled the code once: onboarding was calling
// revalidatePath('/today'), which could not invalidate anything because there
// was nothing there.
export default function TodayRedirect() {
  permanentRedirect('/planner/today');
}
