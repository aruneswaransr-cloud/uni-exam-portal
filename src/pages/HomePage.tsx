import { Logo } from '@/components/Logo';
import { ShieldCheck, Users, ArrowRight, Sparkles, Clock, ListChecks } from 'lucide-react';

const features = [
  { icon: ShieldCheck, title: 'Secure & proctored', desc: 'Server-side timing, code validation, and duplicate prevention.' },
  { icon: ListChecks, title: 'Manual evaluation', desc: 'No auto-grading. Admins review and award marks by hand.' },
  { icon: Clock, title: 'Live countdown timer', desc: 'Synchronized with the server — refresh-proof and accurate.' },
  { icon: Sparkles, title: 'Randomized questions', desc: 'Each participant gets a unique, stable question order.' },
];

export function HomePage() {
  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header */}
      <header className="border-b border-ink-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Logo />
          <span className="hidden text-sm font-500 text-ink-500 sm:block">
            College Quiz Management System
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-14 pb-10 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-600 text-primary-700">
            <Sparkles className="h-3.5 w-3.5" /> Built for college events
          </span>
          <h1 className="mt-5 font-display text-4xl font-800 leading-[1.1] tracking-tight text-ink-900 sm:text-5xl">
            Run quizzes that feel
            <span className="bg-gradient-to-r from-primary-600 to-accent-500 bg-clip-text text-transparent">
              {' '}effortless
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink-500">
            Create quizzes, approve participants, run live timed sessions, and
            evaluate responses — all from one clean dashboard.
          </p>
        </div>

        {/* Role cards */}
        <div className="mx-auto mt-12 grid max-w-3xl gap-5 sm:grid-cols-2">
          <RoleCard
            to="/admin"
            icon={ShieldCheck}
            label="Admin"
            title="I'm organizing"
            desc="Create quizzes, manage questions, approve participants, and evaluate results."
            accent="primary"
          />
          <RoleCard
            to="/participant"
            icon={Users}
            label="Participant"
            title="I'm attending"
            desc="Register with a quiz code, wait for approval, and take the timed quiz."
            accent="accent"
          />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-ink-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(16,20,28,0.04)]"
            >
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50 text-primary-600">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-600 text-ink-900">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-200/70 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-sm text-ink-400 sm:flex-row">
          <Logo className="h-7" />
          <p>QuizForge &middot; College Quiz Management System</p>
        </div>
      </footer>
    </div>
  );
}

function RoleCard({
  to,
  icon: Icon,
  label,
  title,
  desc,
  accent,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  title: string;
  desc: string;
  accent: 'primary' | 'accent';
}) {
  const styles = {
    primary: {
      ring: 'hover:border-primary-300 hover:shadow-[0_8px_30px_rgba(37,70,235,0.12)]',
      badge: 'bg-primary-50 text-primary-700',
      icon: 'bg-primary-600',
      arrow: 'text-primary-600 group-hover:translate-x-0.5',
    },
    accent: {
      ring: 'hover:border-accent-300 hover:shadow-[0_8px_30px_rgba(13,168,156,0.12)]',
      badge: 'bg-accent-50 text-accent-700',
      icon: 'bg-accent-500',
      arrow: 'text-accent-600 group-hover:translate-x-0.5',
    },
  }[accent];

  return (
    <a
      href={to}
      className={`group flex flex-col rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(16,20,28,0.04)] transition-all duration-200 ${styles.ring}`}
    >
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-3 py-1 text-xs font-600 ${styles.badge}`}>
          {label}
        </span>
        <div className={`grid h-11 w-11 place-items-center rounded-xl text-white ${styles.icon}`}>
          <Icon className="h-5 w-5" strokeWidth={2.2} />
        </div>
      </div>
      <h2 className="mt-5 font-display text-xl font-700 text-ink-900">{title}</h2>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-500">{desc}</p>
      <span className={`mt-5 inline-flex items-center gap-1.5 text-sm font-600 ${styles.arrow} transition-transform`}>
        Continue <ArrowRight className="h-4 w-4" />
      </span>
    </a>
  );
}
