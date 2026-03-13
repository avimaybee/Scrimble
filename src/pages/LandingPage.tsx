import React, { useState, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hexagon, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
const HERO_SOCIAL_PROOF_TARGET = 2000;
const PROMPT_DEMO_TEXT =
  'I want to build a booking app for independent dog walkers with recurring billing, client notes, and a clear daily checklist for each walk.';

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
  heroCardClassName?: string;
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
    stripeClassName: 'bg-[var(--color-stage-understand)]',
    labelClassName: 'text-[var(--color-stage-understand)]',
    progressClassName: 'bg-status-secure w-full',
    heroCardClassName: 'z-[0] scale-[0.70] opacity-[0.45] origin-top-left',
  },
  {
    id: 'research',
    stage: 'Research',
    title: 'Compare tools and tradeoffs',
    tone: 'complete',
    top: '34%',
    left: '28%',
    stripeClassName: 'bg-[var(--color-stage-document)]',
    labelClassName: 'text-[var(--color-stage-document)]',
    progressClassName: 'bg-status-secure w-full',
    heroCardClassName: 'z-[1] scale-[0.85] opacity-[0.75] origin-top-left',
  },
  {
    id: 'design',
    stage: 'Design',
    title: 'Review the user flow',
    tone: 'review',
    top: '10%',
    left: '50%',
    stripeClassName: 'bg-[var(--color-stage-design)]',
    labelClassName: 'text-[var(--color-stage-design)]',
    progressClassName: 'bg-status-warning w-[74%]',
    badge: 'Your review',
    heroCardClassName: 'z-[1] scale-[0.85] opacity-[0.75] origin-top-left',
  },
  {
    id: 'build',
    stage: 'Build',
    title: 'Ship sign-in and getting started',
    tone: 'active',
    top: '46%',
    left: '42%',
    stripeClassName: 'bg-[var(--color-stage-build)]',
    labelClassName: 'text-[var(--color-stage-build)]',
    progressClassName: 'bg-accent-primary w-[58%]',
    heroCardClassName: 'z-[2] scale-[1.0] opacity-100 origin-top-left',
  },
  {
    id: 'validate',
    stage: 'Validate',
    title: 'Test the payment states',
    tone: 'working',
    top: '64%',
    left: '64%',
    stripeClassName: 'bg-[linear-gradient(90deg,rgba(56,189,248,0.45)_0%,rgba(235,94,40,0.72)_50%,rgba(56,189,248,0.45)_100%)]',
    labelClassName: 'text-[var(--color-stage-validate)]',
    progressClassName: 'animate-pulse bg-[linear-gradient(90deg,rgba(56,189,248,0.65)_0%,rgba(235,94,40,0.88)_100%)] w-[78%]',
    heroCardClassName: 'z-[2] scale-[1.0] opacity-100 origin-top-left',
  },
  {
    id: 'launch',
    stage: 'Launch',
    title: 'Go live with the first release',
    tone: 'locked',
    top: '30%',
    left: '74%',
    stripeClassName: 'bg-[var(--color-stage-deploy)]',
    labelClassName: 'text-[var(--color-stage-deploy)]',
    progressClassName: 'bg-accent-primary w-[18%]',
    heroCardClassName: 'z-[0] scale-[0.70] opacity-[0.45] origin-top-left',
  },
];

const canvasPreviewPaths = [
  'M 18 18 C 27 18, 27 38, 36 38',
  'M 40 42 C 49 42, 49 22, 58 22',
  'M 64 24 C 69 24, 69 34, 75 34',
  'M 58 58 C 64 58, 64 70, 70 70',
  'M 46 56 C 39 56, 39 44, 34 44',
];

function SectionLabel({ children, variant = "default" }: { children: ReactNode, variant?: "default" | "pill" | "subtle" }) {
  if (variant === "pill") {
    return (
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border-strong bg-bg-elevated px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-primary shadow-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" />
        {children}
      </div>
    );
  }
  if (variant === "subtle") {
    return (
      <div className="mb-4 flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
        <span className="text-status-secure">✦</span>
        {children}
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-accent-soft)]">
      <span className="h-[1.5px] w-4 shrink-0 rounded-sm bg-accent-primary" />
      {children}
    </div>
  );
}

function useRevealOnIntersect<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T | null>(null);
  const [hasRevealed, setHasRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || hasRevealed) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= threshold) {
          setHasRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: [threshold] },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasRevealed, threshold]);

  return { ref, hasRevealed };
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
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_60%_50%,rgba(235,94,40,0.18)_0%,transparent_70%)] blur-3xl pointer-events-none -z-10" />
      
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
        <div className="relative h-full overflow-hidden rounded-[16px] border border-border-strong/20 bg-bg-base/95 px-6 py-5 shadow-[0_44px_90px_rgba(0,0,0,0.50)]">
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

          {canvasPreviewSteps.map((step, index) => (
            <motion.div
              key={step.id}
              initial={isHero ? { opacity: 0, y: 20 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={isHero ? { duration: 0.45, delay: index * 0.08, ease: 'easeOut' } : undefined}
              className={cn(
                'absolute rounded-[10px] bg-bg-surface/96 p-3 backdrop-blur-sm',
                isHero ? 'w-[176px]' : 'w-[152px]',
                previewStepToneClasses[step.tone],
                isHero ? step.heroCardClassName : ''
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
            </motion.div>
          ))}

          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,transparent_65%,rgba(15,14,14,0.8)_85%,rgba(15,14,14,1)_100%)]" />
        </div>
      </div>
    </div>
  );
}

function PromptPreview({
  typedPrompt,
  showCursor,
}: {
  typedPrompt: string;
  showCursor: boolean;
}) {
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
            <span className="whitespace-pre-wrap">{typedPrompt}</span>
            {showCursor ? (
              <span className="ml-0.5 inline-block h-[18px] w-px animate-pulse bg-accent-primary align-middle" />
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 pb-3 pt-4">
          <div className="text-xs text-text-tertiary">Powered by your AI key</div>
          <div className="btn-primary pointer-events-none inline-flex items-center gap-2 rounded-[8px] opacity-90">
            Build my plan
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MorningPreview({ revealProgress }: { revealProgress: boolean }) {
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
            <span className="font-mono text-[12px] font-normal text-text-muted">42%</span>
          </div>
          <div className="h-[3px] overflow-hidden rounded-full bg-bg-base">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: revealProgress ? '42%' : '0%' }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full rounded-full bg-accent-primary"
            />
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
          <span className="rounded-[6px] border border-border-default bg-transparent px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-text-tertiary">
            Updated today
          </span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [isScrolled, setIsScrolled] = useState(false);
  const { ref: planSectionRef, hasRevealed: hasPlanRevealed } = useRevealOnIntersect<HTMLDivElement>(0.2);
  const { ref: aiSectionRef, hasRevealed: hasAiRevealed } = useRevealOnIntersect<HTMLDivElement>(0.2);
  const { ref: morningSectionRef, hasRevealed: hasMorningRevealed } = useRevealOnIntersect<HTMLDivElement>(0.2);
  const heroBuilderCount = HERO_SOCIAL_PROOF_TARGET;
  const [typedPrompt, setTypedPrompt] = useState('');

  useEffect(() => {
    document.title = 'Scrimble — Build it. Ship it.';
  }, []);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!hasAiRevealed || typedPrompt.length >= PROMPT_DEMO_TEXT.length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTypedPrompt(PROMPT_DEMO_TEXT.slice(0, typedPrompt.length + 1));
    }, 40);

    return () => window.clearTimeout(timeoutId);
  }, [hasAiRevealed, typedPrompt.length]);

  return (
    <div className="min-h-screen overflow-x-clip bg-bg-base font-sans text-text-primary">
      <nav className={cn("sticky top-0 z-[100] flex h-[64px] items-center justify-between px-6 sm:px-10 lg:px-20 transition-all duration-200", isScrolled ? "bg-[rgba(10,10,10,0.85)] backdrop-blur-[12px] border-b border-[rgba(255,255,255,0.06)]" : "bg-transparent border-b-transparent")}>
        <div className="flex items-center gap-2">
          <Hexagon className="h-5 w-5 text-accent-primary" />
          <span className="text-[15px] font-semibold tracking-[-0.03em] text-text-primary">Scrimble</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/login" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-primary">
            Sign in
          </Link>
          <Link to="/signup" className="btn-primary flex items-center justify-center h-[36px] px-4 rounded-[8px]">
            Get started
          </Link>
        </div>
      </nav>

      <main className="relative">
        <div className="pointer-events-none absolute right-[-140px] top-[-220px] h-[720px] w-[720px] bg-[radial-gradient(ellipse_at_center,rgba(235,94,40,0.06)_0%,transparent_70%)]" />

        <section className="mx-auto grid max-w-[1480px] gap-12 px-6 pb-6 pt-6 sm:px-10 sm:pt-6 lg:min-h-[720px] lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:items-center lg:gap-24 lg:px-20 lg:pb-0 lg:pt-0 xl:min-h-[760px] xl:grid-cols-[minmax(0,37rem)_minmax(0,1fr)] xl:gap-28">
          <motion.div
            className="relative z-10 flex max-w-[540px] flex-col items-start justify-center lg:pb-10 xl:pb-14"
            initial="hidden"
            animate="visible"
            variants={heroContainerVariants}
          >
            <motion.div variants={heroItemVariants} className="mb-8 self-start inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent-primary-muted/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent-primary shadow-[0_0_15px_rgba(235,94,40,0.15)]"><Hexagon className="h-3 w-3 fill-accent-primary opacity-50" /> Now in beta</motion.div>

            <motion.h1 variants={heroItemVariants} className="text-hero max-w-[11.2ch]" style={{ textWrap: 'balance' }}>
              <span className="display-bold block">Build it. Ship it.</span>
              <span className="display-bold block text-text-secondary">Don't lose the thread.</span>
            </motion.h1>

            <motion.p 
              variants={heroItemVariants} 
              className="mb-10 max-w-[440px] text-body text-[17px] leading-relaxed" 
              style={{ textWrap: 'pretty' }}
            >
              The AI project planner built for solo builders.
            </motion.p>

            <motion.div
              variants={heroItemVariants}
              className="flex flex-col items-start gap-4"
            >
              <div className="flex flex-wrap items-center gap-4">
                <Link to="/signup" className="btn-primary flex items-center justify-center h-[40px] px-6 rounded-[8px]">
                  Start building
                </Link>
                <a
                  href="#how-it-works"
                  className="group flex items-center justify-center h-[40px] gap-2 px-5 rounded-[8px] text-sm font-medium text-text-primary border border-border-default hover:bg-bg-elevated/50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-primary"
                >
                  See how it works
                  <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </a>
              </div>
              <div className="flex items-center gap-2 text-[12px] font-medium text-text-secondary mt-2">
                <span className="tracking-tight">⚡ AI-generated plans</span>
                <span className="text-text-tertiary">·</span>
                <span className="tracking-tight">🔑 Bring your own key</span>
                <span className="text-text-tertiary">·</span>
                <span className="tracking-tight">🔒 No subscription required</span>
              </div>
            </motion.div>
              <motion.div variants={heroItemVariants} className="mt-8 flex items-center gap-3">
                <div className="flex -space-x-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-8 w-8 rounded-full border-2 border-bg-base bg-bg-surface flex items-center justify-center text-[10px] font-bold text-text-secondary overflow-hidden">
                      <img src={`https://i.pravatar.cc/100?img=${i + 10}`} alt={`User ${i}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
                <div className="text-sm font-medium text-text-secondary">
                  Join <span className="text-text-primary">{heroBuilderCount.toLocaleString()}+</span> solo builders
                </div>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.95, delay: 0.22, ease: EASE_OUT_EXPO }}
            className="hidden self-end lg:flex lg:min-h-[720px] lg:items-end lg:justify-end xl:min-h-[780px] relative"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(235,94,40,0.15)_0%,transparent_60%)] scale-150 blur-3xl rounded-full z-0 opacity-60"></div>
            <CanvasPreview variant="hero" className="lg:-mr-6 xl:mr-0 relative z-10" />
          </motion.div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 border-t border-border-subtle pb-[100px] pt-[100px]">
          <div className="mx-auto max-w-[1200px] space-y-[100px] px-6 sm:px-10 lg:px-20">
            <motion.div
              ref={planSectionRef}
              className="grid items-center gap-14 md:grid-cols-2 lg:gap-20"
              initial="hidden"
              animate={hasPlanRevealed ? 'visible' : 'hidden'}
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
              ref={aiSectionRef}
              className="grid items-center gap-14 md:grid-cols-2 lg:gap-20"
              initial="hidden"
              animate={hasAiRevealed ? 'visible' : 'hidden'}
              variants={featureContainerVariants}
            >
              <motion.div variants={featureItemVariants} className="order-1 md:order-2 text-right md:text-left flex flex-col md:items-start items-end">
                <SectionLabel variant="pill">Your AI</SectionLabel>
                <h2 className="mb-5 text-heading">Tell it what you're building. It handles the rest.</h2>
                <p className="max-w-[390px] text-body">
                  No forms, no dropdowns, no lists to pick from. You describe the idea naturally and Scrimble turns it into a plan you can follow.
                </p>
              </motion.div>
              <motion.div variants={featureItemVariants} className="order-2 md:order-1">
                <PromptPreview
                  typedPrompt={typedPrompt}
                  showCursor={hasAiRevealed && typedPrompt.length < PROMPT_DEMO_TEXT.length}
                />
              </motion.div>
            </motion.div>

            <motion.div
              ref={morningSectionRef}
              className="grid items-center gap-14 md:grid-cols-2 lg:gap-20"
              initial="hidden"
              animate={hasMorningRevealed ? 'visible' : 'hidden'}
              variants={featureContainerVariants}
            >
              <motion.div variants={featureItemVariants}>
                <SectionLabel variant="subtle">Every morning</SectionLabel>
                <h2 className="mb-5 text-heading">Open it every morning. Know exactly what's next.</h2>
                <p className="max-w-[390px] text-body">
                  Your project state stays current, your next move stays obvious, and the work picks up exactly where you left it.
                </p>
              </motion.div>
              <motion.div variants={featureItemVariants}>
                <MorningPreview revealProgress={hasMorningRevealed} />
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Step 5 — Social Proof Section */}
        <section className="mx-auto max-w-[1200px] px-6 sm:px-10 lg:px-20 pb-[100px]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-[14px] bg-[#161616] border border-[rgba(255,255,255,0.06)] p-6 flex flex-col justify-between">
              <p className="font-serif italic text-text-primary text-[17px] leading-relaxed mb-6">
                “I've started ten projects this year and finished none. Scrimble actually forced me to ship by breaking my monolithic anxiety into tiny steps.”
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="h-8 w-8 rounded-full overflow-hidden bg-bg-surface">
                  <img src="https://i.pravatar.cc/100?img=33" alt="Builder" className="w-full h-full object-cover" />
                </div>
                <div className="text-[13px] font-medium text-text-muted">
                  @mkdev · Full-stack dev
                </div>
              </div>
            </div>

            <div className="rounded-[14px] bg-[#161616] border border-[rgba(255,255,255,0.06)] p-6 flex flex-col justify-between">
              <p className="font-serif italic text-text-primary text-[17px] leading-relaxed mb-6">
                “The AI planning is magical. It spotted edge cases in my auth flow that I hadn't even considered. Finally, an AI tool that organizes instead of just generating code.”
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="h-8 w-8 rounded-full overflow-hidden bg-bg-surface">
                  <img src="https://i.pravatar.cc/100?img=12" alt="Builder" className="w-full h-full object-cover" />
                </div>
                <div className="text-[13px] font-medium text-text-muted">
                  @sarah_codes · Indie hacker
                </div>
              </div>
            </div>

            <div className="rounded-[14px] bg-[#161616] border border-[rgba(255,255,255,0.06)] p-6 flex flex-col justify-between">
              <p className="font-serif italic text-text-primary text-[17px] leading-relaxed mb-6">
                “Bring your own key is the best part. I'm not trapped in another $20/mo subscription just to have a competent project manager.”
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="h-8 w-8 rounded-full overflow-hidden bg-bg-surface">
                  <img src="https://i.pravatar.cc/100?img=68" alt="Builder" className="w-full h-full object-cover" />
                </div>
                <div className="text-[13px] font-medium text-text-muted">
                  @joshbuilds · Solo founder
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Step 6 — Bottom CTA Section */}
        <section className="relative w-full border-t border-[rgba(255,255,255,0.06)] bg-bg-base overflow-hidden py-24 sm:py-32">
          <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(ellipse_at_center,rgba(230,100,30,0.06)_0%,transparent_70%)]" />
          
          <div className="relative z-10 mx-auto max-w-[600px] px-6 text-center flex flex-col items-center">
            <h2 className="font-serif text-[32px] font-bold text-text-primary mb-4">Start your first project free.</h2>
            <p className="text-body text-[17px] text-text-secondary mb-10">No subscription. Bring your own AI key.</p>
            
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link to="/signup" className="btn-primary flex items-center justify-center h-[44px] px-6 rounded-[8px] text-[15px]">
                Start building
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link
                to="/login"
                className="group flex items-center justify-center h-[44px] px-6 rounded-[8px] text-[15px] font-medium text-text-primary border border-border-default hover:bg-bg-elevated/50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-subtle bg-bg-base/50 pt-16 pb-8 px-6 sm:px-10 lg:px-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <Hexagon aria-hidden="true" className="h-5 w-5 text-accent-primary" />
                <span className="text-[15px] font-semibold tracking-[-0.03em] text-text-primary">Scrimble</span>
              </div>
              <p className="text-sm text-text-secondary max-w-xs mb-6">The technical planner and operating system for solo builders shipping software with AI.</p>
            </div>
            
            <div>
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-text-primary mb-4 font-semibold">Product</h3>
              <ul className="space-y-3 text-sm text-text-secondary">
                <li><a href="#" className="hover:text-text-primary transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-text-primary transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-text-primary transition-colors">Changelog</a></li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-text-primary mb-4 font-semibold">Legal</h3>
              <ul className="space-y-3 text-sm text-text-secondary">
                <li><a href="#" className="hover:text-text-primary transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-text-primary transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-text-primary transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
          
          <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-border-subtle text-xs text-text-tertiary">
            <p>© 2026 Scrimble Inc. All rights reserved.</p>
            <div className="flex gap-4 mt-4 md:mt-0">
              <a href="#" className="hover:text-text-primary transition-colors">Twitter</a>
              <a href="#" className="hover:text-text-primary transition-colors">GitHub</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}












