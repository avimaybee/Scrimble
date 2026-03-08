import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hexagon, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const heroContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const heroItemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: EASE_OUT_EXPO,
    },
  },
};

const featureContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
    },
  },
};

const featureItemVariants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.65,
      ease: EASE_OUT_EXPO,
    },
  },
};

type PreviewTone = 'complete' | 'active' | 'review' | 'working' | 'locked';

type PreviewStep = {
  id: string;
  stage: string;
  title: string;
  tone: PreviewTone;
  top: string;
  left: string;
  stripeClassName: string;
  labelClassName: string;
  progressClassName: string;
  badge?: string;
};

const previewStepToneClasses: Record<PreviewTone, string> = {
  complete:
    'border-[rgba(52,211,153,0.26)] shadow-[0_0_0_1px_rgba(52,211,153,0.08),0_18px_34px_rgba(0,0,0,0.30)]',
  active:
    'border-accent-border shadow-[0_0_0_1px_rgba(235,94,40,0.24),0_24px_42px_rgba(235,94,40,0.14)]',
  review:
    'border-[rgba(245,158,11,0.30)] shadow-[0_0_0_1px_rgba(245,158,11,0.14),0_20px_36px_rgba(0,0,0,0.30)]',
  working:
    'border-[rgba(56,189,248,0.24)] shadow-[0_0_0_1px_rgba(56,189,248,0.10),0_18px_34px_rgba(0,0,0,0.30)]',
  locked: 'border-border-default opacity-40',
};

const canvasPreviewSteps: PreviewStep[] = [
  {
    id: 'brief',
    stage: 'Brief',
    title: 'Shape the first project brief',
    tone: 'complete',
    top: '12%',
    left: '6%',
    stripeClassName: 'bg-stage-understand',
    labelClassName: 'text-stage-understand',
    progressClassName: 'bg-status-secure w-full',
  },
  {
    id: 'research',
    stage: 'Research',
    title: 'Compare tools and tradeoffs',
    tone: 'complete',
    top: '34%',
    left: '28%',
    stripeClassName: 'bg-stage-document',
    labelClassName: 'text-stage-document',
    progressClassName: 'bg-status-secure w-full',
  },
  {
    id: 'design',
    stage: 'Design',
    title: 'Review the user flow',
    tone: 'review',
    top: '10%',
    left: '50%',
    stripeClassName: 'bg-stage-design',
    labelClassName: 'text-stage-design',
    progressClassName: 'bg-status-warning w-[74%]',
    badge: 'Your review',
  },
  {
    id: 'build',
    stage: 'Build',
    title: 'Ship auth and onboarding',
    tone: 'active',
    top: '46%',
    left: '42%',
    stripeClassName: 'bg-stage-build',
    labelClassName: 'text-stage-build',
    progressClassName: 'bg-accent-primary w-[58%]',
  },
  {
    id: 'validate',
    stage: 'Validate',
    title: 'Test the payment states',
    tone: 'working',
    top: '64%',
    left: '64%',
    stripeClassName: 'bg-[linear-gradient(90deg,rgba(56,189,248,0.45)_0%,rgba(235,94,40,0.72)_50%,rgba(56,189,248,0.45)_100%)]',
    labelClassName: 'text-stage-validate',
    progressClassName: 'animate-pulse bg-[linear-gradient(90deg,rgba(56,189,248,0.65)_0%,rgba(235,94,40,0.88)_100%)] w-[78%]',
  },
  {
    id: 'launch',
    stage: 'Launch',
    title: 'Go live with the first release',
    tone: 'locked',
    top: '30%',
    left: '74%',
    stripeClassName: 'bg-stage-deploy',
    labelClassName: 'text-stage-deploy',
    progressClassName: 'bg-accent-primary w-[18%]',
  },
];

const canvasPreviewPaths = [
  'M 18 18 C 27 18, 27 38, 36 38',
  'M 40 42 C 49 42, 49 22, 58 22',
  'M 64 24 C 69 24, 69 34, 75 34',
  'M 58 58 C 64 58, 64 70, 70 70',
  'M 46 56 C 39 56, 39 44, 34 44',
];

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label mb-4">{children}</div>;
}

function CanvasPreview({
  variant,
  className,
}: {
  variant: 'hero' | 'feature';
  className?: string;
}) {
  const isHero = variant === 'hero';

  return (
    <div
      className={cn(
        'relative isolate overflow-visible',
        isHero ? 'h-[640px] w-full max-w-[780px]' : 'aspect-[4/3] w-full min-h-[320px]',
        className,
      )}
    >
      <div className="absolute bottom-[7%] right-[8%] h-[200px] w-[76%] bg-[radial-gradient(ellipse_at_center,rgba(235,94,40,0.20)_0%,rgba(235,94,40,0.08)_42%,transparent_78%)] blur-3xl" />
      <div
        className={cn(
          'absolute origin-bottom-right transition-transform duration-700 ease-out',
          isHero ? 'bottom-0 right-[-40px] h-full w-[120%] min-w-[840px] opacity-90' : 'inset-0',
        )}
        style={{
          transform: isHero
            ? 'perspective(1400px) rotateX(10deg) rotate(-14deg) translateY(40px) translateZ(0)'
            : 'perspective(1040px) rotateX(4deg) rotate(8deg) scale(0.95)',
        }}
      >
        <div className="relative h-full overflow-hidden rounded-[16px] border border-border-default bg-bg-base/95 px-6 py-5 shadow-[0_44px_90px_rgba(0,0,0,0.50)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,252,242,0.05)_0%,transparent_30%),radial-gradient(circle_at_bottom_right,rgba(235,94,40,0.14)_0%,transparent_32%),radial-gradient(circle,rgba(204,197,185,0.05)_1px,transparent_1px)] bg-[size:auto,auto,28px_28px]" />

          <div className="relative z-10 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent-primary/70" />
              <span className="h-2 w-2 rounded-full bg-text-tertiary/45" />
              <span className="h-2 w-2 rounded-full bg-text-tertiary/30" />
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary">
              Your plan
            </div>
          </div>

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 z-0 h-full w-full"
            aria-hidden="true"
          >
            {canvasPreviewPaths.map((path, index) => (
              <path
                key={path}
                d={path}
                fill="none"
                stroke="rgba(204,197,185,0.18)"
                strokeDasharray={index > 2 ? '4 4' : undefined}
                strokeWidth="0.35"
              />
            ))}
          </svg>

          {canvasPreviewSteps.map((step) => (
            <div
              key={step.id}
              className={cn(
                'absolute rounded-[10px] bg-bg-surface/96 p-3 backdrop-blur-sm',
                isHero ? 'w-[176px]' : 'w-[152px]',
                previewStepToneClasses[step.tone],
              )}
              style={{ top: step.top, left: step.left }}
            >
              <div className={cn('absolute inset-x-0 top-0 h-[2px] rounded-t-[10px]', step.stripeClassName)} />
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className={cn('text-label', step.labelClassName)}>{step.stage}</div>
                {step.badge ? (
                  <span className="rounded-[6px] border border-status-warning/35 bg-status-warning/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.14em] text-status-warning">
                    {step.badge}
                  </span>
                ) : null}
              </div>
              <div className={cn('mb-3 font-sans font-medium leading-[1.4] text-text-primary', isHero ? 'text-[12px]' : 'text-[11px]')}>
                {step.title}
              </div>
              <div className="h-[2px] overflow-hidden rounded-[2px] bg-[rgba(204,197,185,0.08)]">
                <div className={cn('h-full', step.progressClassName)} />
              </div>
            </div>
          ))}

          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,transparent_65%,rgba(15,14,14,0.8)_85%,rgba(15,14,14,1)_100%)]" />
        </div>
      </div>
    </div>
  );
}

function PromptPreview() {
  return (
    <div className="relative overflow-hidden rounded-[16px] border border-border-default bg-bg-surface p-6 shadow-panel">
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent_0%,rgba(235,94,40,0.52)_50%,transparent_100%)]" />
      <div className="absolute -right-14 top-[-30px] h-40 w-40 rounded-full bg-accent-primary/10 blur-3xl" />

      <div className="relative rounded-[16px] border border-border-default bg-bg-surface p-2">
        <div className="rounded-[14px] border border-border-default bg-bg-elevated/70 p-5">
          <div className="mb-3 text-[13px] font-medium tracking-tight text-text-primary">
            What do you want to build?
          </div>
          <div className="mb-5 max-w-[320px] text-[13px] leading-[1.6] text-text-secondary">
            Describe it in your own words. The more detail you give, the better your plan will be.
          </div>
          <div className="min-h-[152px] rounded-[12px] border border-border-default bg-bg-base/50 px-4 py-4 text-[15px] leading-relaxed text-text-primary">
            I want to build a booking app for independent dog walkers with recurring billing, client notes, and a clear daily checklist for each walk.
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 pb-3 pt-4">
          <div className="text-xs text-text-tertiary">Powered by your AI key</div>
          <div className="btn-primary pointer-events-none inline-flex items-center gap-2 opacity-90">
            Build my plan
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MorningPreview() {
  return (
    <div className="rounded-[16px] border border-border-default bg-bg-surface p-6 shadow-panel">
      <div className="rounded-[16px] border border-border-default bg-bg-elevated/80 p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-label">Good morning</div>
            <div className="font-serif text-[28px] leading-none tracking-[-0.03em] text-text-primary">
              Dog Walker SaaS
            </div>
          </div>
          <div className="flex gap-1 pt-1">
            {[1, 2, 3, 4, 5, 6].map((stage) => (
              <span
                key={stage}
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  stage <= 4
                    ? 'bg-accent-primary shadow-[0_0_8px_rgba(235,94,40,0.44)]'
                    : 'bg-bg-base',
                )}
              />
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-[12px] font-medium text-text-secondary">
            <span>Progress</span>
            <span className="font-mono text-accent-primary">42%</span>
          </div>
          <div className="h-[3px] overflow-hidden rounded-full bg-bg-base">
            <div className="h-full w-[42%] rounded-full bg-accent-primary" />
          </div>
        </div>

        <div className="rounded-[12px] border border-accent-border bg-accent-primary-muted/55 px-4 py-3">
          <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.16em] text-accent-primary">
            Next up
          </div>
          <div className="flex items-center gap-2 text-[14px] font-medium text-text-primary">
            <ArrowRight className="h-4 w-4 text-accent-primary" />
            Set up your client database
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 text-[11px] font-mono uppercase tracking-[0.12em] text-text-tertiary">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-[6px] bg-bg-base px-2 py-1">Next.js</span>
            <span className="rounded-[6px] bg-bg-base px-2 py-1">Supabase</span>
            <span className="rounded-[6px] bg-bg-base px-2 py-1">Stripe</span>
          </div>
          <span>Updated today</span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-bg-base font-sans text-text-primary selection:bg-accent-primary-muted selection:text-accent-primary">
      <nav className="fixed left-0 right-0 top-0 z-50 flex h-[60px] items-center justify-between border-b border-border-subtle bg-bg-base/80 px-6 backdrop-blur-lg sm:px-10 lg:px-20">
        <div className="flex items-center gap-2">
          <Hexagon className="h-5 w-5 text-accent-primary" />
          <span className="text-[15px] font-semibold tracking-tight text-text-primary">Scrimble</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/login" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
            Sign in
          </Link>
          <Link to="/signup" className="btn-primary">
            Get started
          </Link>
        </div>
      </nav>

      <main className="relative pt-[60px]">
        <div className="pointer-events-none absolute right-[-140px] top-[-220px] h-[720px] w-[720px] bg-[radial-gradient(ellipse_at_center,rgba(235,94,40,0.06)_0%,transparent_70%)]" />

        <section className="mx-auto grid min-h-[calc(100vh-60px)] max-w-[1440px] items-stretch gap-12 px-6 pb-12 pt-14 sm:px-10 sm:pt-[72px] lg:grid-cols-[52fr_48fr] lg:gap-16 lg:px-20 lg:pb-0 lg:pt-10">
          <motion.div
            className="flex flex-col justify-center lg:pb-16"
            initial="hidden"
            animate="visible"
            variants={heroContainerVariants}
          >
            <motion.div variants={heroItemVariants} className="badge mb-8">
              Now in beta
            </motion.div>

            <motion.h1 variants={heroItemVariants} className="text-hero">
              <span className="display-bold">Build it. Ship it.</span>
              <span className="display-italic">Don't lose the thread.</span>
            </motion.h1>

            <motion.p variants={heroItemVariants} className="mb-10 max-w-[420px] text-body text-[17px] leading-relaxed">
              Scrimble keeps vibe coders on track — one step at a time,{' '}
              <span className="whitespace-nowrap">powered by AI.</span>
            </motion.p>

            <motion.div
              variants={heroItemVariants}
              className="flex flex-wrap items-center gap-4"
            >
              <Link to="/signup" className="btn-primary rounded-[8px]">
                Start building
              </Link>
              <Link
                to="#how-it-works"
                className="group flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                See how it works
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.95, delay: 0.22, ease: EASE_OUT_EXPO }}
            className="hidden self-stretch lg:flex lg:items-end lg:justify-end"
          >
            <CanvasPreview variant="hero" />
          </motion.div>
        </section>

        <section id="how-it-works" className="border-t border-border-subtle py-[100px]">
          <div className="mx-auto max-w-[1200px] space-y-[100px] px-6 sm:px-10 lg:px-20">
            <motion.div
              className="grid items-center gap-14 md:grid-cols-2 lg:gap-20"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.35 }}
              variants={featureContainerVariants}
            >
              <motion.div variants={featureItemVariants}>
                <SectionLabel>Your plan</SectionLabel>
                <h2 className="mb-5 text-heading">Your entire project, in one view</h2>
                <p className="max-w-[390px] text-body">
                  Every step stays visible from the first idea to launch. Finish one thing, unlock the next, and keep the whole build in frame.
                </p>
              </motion.div>
              <motion.div variants={featureItemVariants}>
                <CanvasPreview variant="feature" />
              </motion.div>
            </motion.div>

            <motion.div
              className="grid items-center gap-14 md:grid-cols-2 lg:gap-20"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.35 }}
              variants={featureContainerVariants}
            >
              <motion.div variants={featureItemVariants} className="order-1 md:order-2">
                <SectionLabel>Your AI</SectionLabel>
                <h2 className="mb-5 text-heading">Tell it what you're building. It handles the rest.</h2>
                <p className="max-w-[390px] text-body">
                  No forms, no dropdowns, no picking from canned categories. You describe the idea naturally and Scrimble turns it into a plan you can follow.
                </p>
              </motion.div>
              <motion.div variants={featureItemVariants} className="order-2 md:order-1">
                <PromptPreview />
              </motion.div>
            </motion.div>

            <motion.div
              className="grid items-center gap-14 md:grid-cols-2 lg:gap-20"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.35 }}
              variants={featureContainerVariants}
            >
              <motion.div variants={featureItemVariants}>
                <SectionLabel>Every morning</SectionLabel>
                <h2 className="mb-5 text-heading">Open it every morning. Know exactly what's next.</h2>
                <p className="max-w-[390px] text-body">
                  Your project state stays current, your next move stays obvious, and the work picks up exactly where you left it.
                </p>
              </motion.div>
              <motion.div variants={featureItemVariants}>
                <MorningPreview />
              </motion.div>
            </motion.div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-subtle px-6 py-8 sm:px-10 lg:px-20">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2 text-text-tertiary">
            <Hexagon className="h-4 w-4" />
            <span className="text-sm font-sans">© 2026 Scrimble</span>
          </div>
          <div className="flex gap-6 text-sm font-sans text-text-tertiary">
            <a href="#" className="transition-colors hover:text-text-primary">
              Privacy
            </a>
            <a href="#" className="transition-colors hover:text-text-primary">
              Terms
            </a>
            <a href="#" className="transition-colors hover:text-text-primary">
              Twitter/X
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
