import { GraduationCap } from 'lucide-react';

export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary-600 to-accent-500 text-white shadow-sm">
        <GraduationCap className="h-5 w-5" strokeWidth={2.2} />
      </div>
      <span className="font-display text-lg font-700 tracking-tight text-ink-900">
        Quiz<span className="text-primary-600">Forge</span>
      </span>
    </div>
  );
}
