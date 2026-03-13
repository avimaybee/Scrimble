import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Hexagon, LayoutDashboard, CheckCircle2, Zap, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { signInWithGoogle } from '../lib/firebase';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const pageVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.48,
      ease: EASE_OUT_EXPO,
    },
  },
};

const carouselSlides = [
  {
    id: 'dashboard',
    title: 'Your projects',
    description: 'Pick up where you left off',
    icon: LayoutDashboard,
    color: '#eb5e28',
  },
  {
    id: 'step',
    title: 'Focus on one step',
    description: 'AI guides you through the build',
    icon: Zap,
    color: '#34d399',
  },
  {
    id: 'complete',
    title: 'Ship finished projects',
    description: 'No more 70% done forever',
    icon: CheckCircle2,
    color: '#a78bfa',
  },
];

function LeftPanel() {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % carouselSlides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const activeItem = carouselSlides[activeSlide];
  const Icon = activeItem.icon;

  return (
    <div className="hidden lg:flex lg:w-1/2 lg:flex-col lg:items-center lg:justify-center lg:bg-bg-base lg:px-12 lg:py-16">
      <div className="relative w-full max-w-[400px]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
          className="mb-12 flex flex-col items-center"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-primary text-white shadow-[0_0_20px_rgba(235,94,40,0.35)]">
            <Hexagon className="h-7 w-7" />
          </div>
          <span className="font-display text-2xl font-bold tracking-tight text-text-primary">Scrimble</span>
        </motion.div>

        <div className="relative mb-10 h-[280px] w-full overflow-hidden rounded-2xl border border-white/8 bg-bg-surface shadow-[0_0_60px_rgba(0,0,0,0.5)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(235,94,40,0.08)_0%,transparent_50%)]" />

          <AnimatePresence mode="wait">
            <motion.div
              key={activeSlide}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.04 }}
              transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
              className="flex h-full flex-col items-center justify-center p-8"
            >
              <div
                className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ backgroundColor: `${activeItem.color}15`, boxShadow: `0 0 30px ${activeItem.color}20` }}
              >
                <Icon className="h-8 w-8" style={{ color: activeItem.color }} />
              </div>
              <h3 className="mb-2 text-center font-display text-xl font-semibold text-text-primary">
                {activeItem.title}
              </h3>
              <p className="text-center text-sm text-text-secondary">{activeItem.description}</p>

              <div className="mt-8 flex w-full flex-col gap-3">
                <div className="h-2 w-full rounded-full bg-bg-elevated">
                  <motion.div
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 6, ease: 'linear' }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: activeItem.color }}
                  />
                </div>
                <div className="flex justify-center gap-2">
                  {carouselSlides.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActiveSlide(idx)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        idx === activeSlide ? 'w-6' : 'w-1.5'
                      }`}
                      style={{ backgroundColor: idx === activeSlide ? activeItem.color : 'rgba(255,255,255,0.2)' }}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="absolute bottom-4 left-6 right-6">
            <div className="rounded-lg border border-white/5 bg-bg-base/80 px-4 py-3 backdrop-blur-sm">
              <p className="text-xs text-text-tertiary">
                <span className="font-medium text-text-secondary">Pro tip:</span> Scrimble works with your existing AI tools — Claude, Cursor, Copilot, whatever you use.
              </p>
            </div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="text-center"
        >
          <p className="text-sm text-text-muted">
            Already trusted by builders shipping real products
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function RightPanel({ mode }: { mode: 'login' | 'signup' }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError(null);

    try {
      await signInWithGoogle();
      navigate(mode === 'signup' ? '/new' : '/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not sign you in right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2 lg:px-12 lg:py-16">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={pageVariants}
        className="w-full max-w-[400px]"
      >
        <Link
          to="/"
          className="absolute left-6 top-6 flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary lg:left-12 lg:top-12"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <motion.div variants={itemVariants} className="mb-8">
          <div className="section-label">Getting started</div>
          <h1 className="mt-4 text-heading">
            {mode === 'login' ? 'Pick up where you left off.' : 'Start your first plan.'}
          </h1>
          <p className="mt-3 text-body">
            {mode === 'login'
              ? 'Sign in and get straight back to the next step.'
              : 'Sign in once, describe what you want to build, and let Scrimble do the heavy lifting.'}
          </p>
        </motion.div>

        <motion.section
          variants={itemVariants}
          className="surface-card overflow-hidden border border-white/8 p-7 sm:p-8"
        >
          <div className="mb-6 border-b border-border-subtle pb-6">
            {error ? (
              <div className="mb-4 rounded-[14px] border border-[rgba(248,113,113,0.22)] bg-status-skipped px-4 py-3 text-sm leading-6 text-status-error">
                {error}
              </div>
            ) : null}

            <button
              onClick={handleGoogleAuth}
              disabled={loading}
              className={`group flex w-full items-center justify-center gap-3 rounded-lg border border-transparent bg-white px-4 py-3 text-sm font-medium text-[#0f0e0e] transition-all hover:bg-[#f5f5f5] hover:shadow-lg focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary disabled:cursor-not-allowed disabled:opacity-70 ${
                loading ? 'bg-white' : ''
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Signing you in...</span>
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span>Continue with Google</span>
                  <ArrowRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>

          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border-subtle" />
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                or
              </span>
              <div className="h-px flex-1 bg-border-subtle" />
            </div>

            <div className="space-y-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                  <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                    Email address
                  </label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    className="field-input cursor-not-allowed opacity-40"
                    disabled
                    readOnly
                  />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Email sign-in coming soon — use Google for now.</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                  <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                    Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="field-input cursor-not-allowed opacity-40"
                    disabled
                    readOnly
                  />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Email sign-in coming soon — use Google for now.</TooltipContent>
              </Tooltip>

              <button
                type="button"
                className="btn-ghost w-full cursor-not-allowed opacity-40"
                disabled
              >
                Sign in with email
              </button>
            </div>
          </div>
        </motion.section>

        <motion.div variants={itemVariants} className="mt-6 text-center text-sm text-text-secondary">
          {mode === 'login' ? (
            <>
              Don&apos;t have an account yet?{' '}
              <Link
                to="/signup"
                className="inline-link"
              >
                Create account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <Link
                to="/login"
                className="inline-link"
              >
                Sign in
              </Link>
            </>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  useEffect(() => {
    document.title = mode === 'login' ? 'Sign in — Scrimble' : 'Create account — Scrimble';
  }, [mode]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-base font-sans text-text-primary">
      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(235,94,40,0.08)_0%,transparent_50%),radial-gradient(circle_at_78%_14%,rgba(235,94,40,0.1)_0%,transparent_30%),radial-gradient(circle_at_18%_90%,rgba(255,252,242,0.03)_0%,transparent_24%)]" />
      </div>

      <div className="flex min-h-screen flex-col lg:flex-row">
        <LeftPanel />
        <RightPanel mode={mode} />
      </div>
    </div>
  );
}
