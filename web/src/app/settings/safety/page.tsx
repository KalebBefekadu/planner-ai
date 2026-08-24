import { SettingsTabs } from '@/components/settings-tabs';

export default function SafetySettingsPage() {
  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Safety</h1>
          <p className="lede">Planner AI is a private planning workspace for adults.</p>
        </div>
      </header>
      <SettingsTabs showCanonical={process.env.PLANNER_DATA_MODEL === 'canonical'} />
      <section className="preference-section" aria-labelledby="safety-scope">
        <div className="preference-heading">
          <p className="eyebrow">Scope</p>
          <h2 id="safety-scope">Planning support, not professional advice</h2>
        </div>
        <p>
          Planner AI does not provide medical, legal, financial, diagnostic, or crisis care. For
          high-stakes decisions, use an appropriately qualified professional. The assistant can
          still help you organize ordinary next steps and questions to bring to that person.
        </p>
      </section>
      <section className="preference-section" aria-labelledby="crisis-support">
        <div className="preference-heading">
          <p className="eyebrow">Immediate support</p>
          <h2 id="crisis-support">When personal safety is at risk</h2>
        </div>
        <p>
          If you may hurt yourself or someone else, call local emergency services or go to the
          nearest emergency department. In the US or Canada, call or text 988. Elsewhere, contact
          your local crisis line and ask a trusted person to stay with you.
        </p>
      </section>
    </div>
  );
}
