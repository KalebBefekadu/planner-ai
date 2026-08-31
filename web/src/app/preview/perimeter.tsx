'use client';

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Eye,
  Github,
  Mail,
  MicVocal,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { useState } from 'react';
import styles from './preview.module.css';

/* Everything before the workspace. The preview previously began with a
   populated, signed-in account, so the first screen every real user meets had
   no design at all. Each of these is one column of quiet marketing beside one
   column of form, because the sign-in page is the only place the product gets
   to say what it is. */

export type PerimeterScreen = 'signin' | 'signup' | 'reset' | 'onboarding';

const promises = [
  {
    icon: <MicVocal size={16} aria-hidden="true" />,
    title: 'Say it once, keep it forever',
    body: 'Talk through the week. Nothing gets lost and nothing gets summarized away.',
  },
  {
    icon: <Target size={16} aria-hidden="true" />,
    title: 'Every action ladders up',
    body: 'Today connects to the month, the quarter, the year, and the life you are building.',
  },
  {
    icon: <ShieldCheck size={16} aria-hidden="true" />,
    title: 'Nothing changes without a preview',
    body: 'AI proposes exact changes with evidence. You approve, and you can always undo.',
  },
];

function Aside() {
  return (
    <aside className={styles.perimeterAside}>
      <div className={styles.perimeterBrand}>
        <span aria-hidden="true">P</span> Planner AI
      </div>
      <p className={styles.perimeterTagline}>
        Talk through your week. Planner keeps the structure — from this week&rsquo;s actions up to
        the life you&rsquo;re building.
      </p>
      <ul className={styles.perimeterPromises}>
        {promises.map((promise) => (
          <li key={promise.title}>
            <span className={styles.perimeterPromiseIcon}>{promise.icon}</span>
            <div>
              <strong>{promise.title}</strong>
              <p>{promise.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.perimeterFoot}>
        Your material stays exportable as Markdown. Delete your account and it goes with you.
      </p>
    </aside>
  );
}

export function PerimeterView({
  screen,
  onNavigate,
  onEnter,
}: {
  screen: PerimeterScreen;
  onNavigate: (next: PerimeterScreen) => void;
  onEnter: () => void;
}) {
  if (screen === 'onboarding') return <Onboarding onDone={onEnter} />;

  return (
    <div className={styles.perimeterRoot}>
      <Aside />
      <main className={styles.perimeterMain}>
        {screen === 'signin' ? <SignIn onNavigate={onNavigate} onEnter={onEnter} /> : null}
        {screen === 'signup' ? <SignUp onNavigate={onNavigate} onEnter={onEnter} /> : null}
        {screen === 'reset' ? <ResetPassword onNavigate={onNavigate} /> : null}
      </main>
    </div>
  );
}

function ProviderButtons() {
  return (
    <div className={styles.perimeterProviders}>
      <button type="button">
        <Mail size={16} aria-hidden="true" /> Continue with Google
      </button>
      <button type="button">
        <Github size={16} aria-hidden="true" /> Continue with GitHub
      </button>
      <p className={styles.perimeterDivider}>
        <span>or use your email</span>
      </p>
    </div>
  );
}

function SignIn({
  onNavigate,
  onEnter,
}: {
  onNavigate: (next: PerimeterScreen) => void;
  onEnter: () => void;
}) {
  const [error, setError] = useState(false);
  const [reveal, setReveal] = useState(false);

  return (
    <form
      className={styles.perimeterForm}
      onSubmit={(event) => {
        event.preventDefault();
        onEnter();
      }}
    >
      <h1>Welcome back</h1>
      <p className={styles.perimeterLede}>Pick up where you left off.</p>

      <ProviderButtons />

      {error ? (
        <p className={styles.perimeterError} role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          That email and password don&rsquo;t match. Check the password, or reset it below.
        </p>
      ) : null}

      <label htmlFor="signin-email">Email</label>
      <input
        id="signin-email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        aria-invalid={error || undefined}
      />

      <div className={styles.perimeterLabelRow}>
        <label htmlFor="signin-password">Password</label>
        <button type="button" onClick={() => onNavigate('reset')}>
          Forgot password?
        </button>
      </div>
      <div className={styles.perimeterInputGroup}>
        <input
          id="signin-password"
          type={reveal ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder="••••••••••"
          aria-invalid={error || undefined}
        />
        <button
          type="button"
          aria-pressed={reveal}
          aria-label={reveal ? 'Hide password' : 'Show password'}
          onClick={() => setReveal((value) => !value)}
        >
          <Eye size={16} aria-hidden="true" />
        </button>
      </div>

      <button className={styles.primaryButton} type="submit">
        Sign in
      </button>

      <p className={styles.perimeterSwitch}>
        New here?{' '}
        <button type="button" onClick={() => onNavigate('signup')}>
          Create an account
        </button>
      </p>

      <button
        className={styles.perimeterDemoToggle}
        type="button"
        onClick={() => setError((value) => !value)}
      >
        Preview: {error ? 'hide' : 'show'} the failed sign-in state
      </button>
    </form>
  );
}

const passwordRules = [
  { label: 'At least 12 characters', met: true },
  { label: 'One number or symbol', met: true },
  { label: 'Not a password you use elsewhere', met: false },
];

function SignUp({
  onNavigate,
  onEnter,
}: {
  onNavigate: (next: PerimeterScreen) => void;
  onEnter: () => void;
}) {
  return (
    <form
      className={styles.perimeterForm}
      onSubmit={(event) => {
        event.preventDefault();
        onEnter();
      }}
    >
      <h1>Start your workspace</h1>
      <p className={styles.perimeterLede}>
        One private workspace. No team setup, no template gallery to wade through.
      </p>

      <ProviderButtons />

      <label htmlFor="signup-name">Your name</label>
      <input id="signup-name" autoComplete="name" placeholder="Sam Rivera" />

      <label htmlFor="signup-email">Email</label>
      <input id="signup-email" type="email" autoComplete="email" placeholder="you@example.com" />

      <label htmlFor="signup-password">Password</label>
      <input
        id="signup-password"
        type="password"
        autoComplete="new-password"
        aria-describedby="password-rules"
        placeholder="••••••••••••"
      />
      <ul className={styles.perimeterRules} id="password-rules">
        {passwordRules.map((rule) => (
          <li key={rule.label} data-met={rule.met || undefined}>
            {rule.met ? (
              <Check size={13} aria-hidden="true" />
            ) : (
              <CircleAlert size={13} aria-hidden="true" />
            )}
            {rule.label}
          </li>
        ))}
      </ul>

      <button className={styles.primaryButton} type="submit">
        Create workspace
      </button>

      <p className={styles.perimeterFine}>
        By continuing you agree to the terms and the privacy notice. We never train models on your
        material.
      </p>

      <p className={styles.perimeterSwitch}>
        Already have an account?{' '}
        <button type="button" onClick={() => onNavigate('signin')}>
          Sign in
        </button>
      </p>
    </form>
  );
}

function ResetPassword({ onNavigate }: { onNavigate: (next: PerimeterScreen) => void }) {
  const [sent, setSent] = useState(false);

  return (
    <form
      className={styles.perimeterForm}
      onSubmit={(event) => {
        event.preventDefault();
        setSent(true);
      }}
    >
      <button className={styles.perimeterBack} type="button" onClick={() => onNavigate('signin')}>
        <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
      </button>

      <h1>Reset your password</h1>

      {sent ? (
        <div className={styles.perimeterSent} role="status">
          <Check size={18} aria-hidden="true" />
          <div>
            <strong>Check your email</strong>
            <p>
              If an account exists for that address, a reset link is on its way. The link works once
              and expires in an hour.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.perimeterLede}>
            Enter the email you signed up with and we&rsquo;ll send a link that works once.
          </p>
          <label htmlFor="reset-email">Email</label>
          <input id="reset-email" type="email" autoComplete="email" placeholder="you@example.com" />
          <button className={styles.primaryButton} type="submit">
            Send reset link
          </button>
        </>
      )}
    </form>
  );
}

const onboardingSteps = [
  {
    eyebrow: 'Step 1 of 3',
    title: 'What life are you building?',
    lede: 'One sentence is enough. You can sharpen it later, and the coach will help you.',
    placeholder:
      'Build a life where focused work, health, and the people I love reinforce each other…',
    help: 'This becomes your vision. Everything else hangs off it, which is why it comes first.',
    cta: 'Continue',
  },
  {
    eyebrow: 'Step 2 of 3',
    title: 'What has to be true this year?',
    lede: 'Name one outcome that would make the vision measurably closer.',
    placeholder: 'Ship Planner AI to 20 weekly users by December…',
    help: 'A goal with a number is one you can review honestly in twelve weeks.',
    cta: 'Continue',
  },
  {
    eyebrow: 'Step 3 of 3',
    title: 'What is the next visible action?',
    lede: 'Something you could start tomorrow morning without deciding anything else first.',
    placeholder: 'Write the one paragraph that explains what Planner is for…',
    help: 'That is the whole cascade. Vision, goal, action — the rest is repetition.',
    cta: 'Open my workspace',
  },
];

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(['', '', '']);
  const current = onboardingSteps[step];

  const setAnswer = (value: string) =>
    setAnswers((all) => all.map((item, index) => (index === step ? value : item)));

  return (
    <div className={styles.onboardingRoot}>
      <div className={styles.onboardingCard}>
        <div
          className={styles.onboardingProgress}
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={3}
          aria-label="Setup progress"
        >
          {onboardingSteps.map((item, index) => (
            <i key={item.title} data-done={index <= step || undefined} />
          ))}
        </div>

        <p className={styles.overline}>{current.eyebrow}</p>
        <h1>{current.title}</h1>
        <p className={styles.onboardingLede}>{current.lede}</p>

        <label className={styles.visuallyHidden} htmlFor="onboarding-answer">
          {current.title}
        </label>
        <textarea
          id="onboarding-answer"
          rows={3}
          value={answers[step]}
          placeholder={current.placeholder}
          onChange={(event) => setAnswer(event.target.value)}
        />

        <p className={styles.onboardingHelp}>
          <Sparkles size={13} aria-hidden="true" /> {current.help}
        </p>

        {step > 0 ? (
          <ol className={styles.onboardingRecap} aria-label="What you have written so far">
            {answers.slice(0, step).map((answer, index) => (
              <li key={onboardingSteps[index].title}>
                <span>{index === 0 ? 'Vision' : 'Goal'}</span>
                <p>{answer || <em>Left blank — you can add it later</em>}</p>
              </li>
            ))}
          </ol>
        ) : null}

        <footer className={styles.onboardingActions}>
          {step > 0 ? (
            <button className={styles.quietButton} type="button" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={15} aria-hidden="true" /> Back
            </button>
          ) : (
            <button className={styles.quietButton} type="button" onClick={onDone}>
              Skip for now
            </button>
          )}
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => (step === 2 ? onDone() : setStep(step + 1))}
          >
            {current.cta} <ArrowRight size={15} aria-hidden="true" />
          </button>
        </footer>
      </div>
    </div>
  );
}
