import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Hexagon } from 'lucide-react';
import { motion } from 'framer-motion';
import { signInWithGoogle } from '../lib/firebase';

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

const inputClassName = 'field-input opacity-70 disabled:cursor-not-allowed disabled:bg-bg-base/60 disabled:text-text-tertiary';

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
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
    <div className="relative min-h-screen overflow-hidden bg-bg-base font-sans text-text-primary">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_14%,rgba(235,94,40,0.08)_0%,transparent_30%),radial-gradient(circle_at_18%_90%,rgba(255,252,242,0.03)_0%,transparent_24%)]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1180px] items-center justify-center px-6 py-16">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={pageVariants}
          className="w-full max-w-[460px]"
        >
          <motion.div variants={itemVariants} className="mb-8 text-center">
            <div className="mb-5 flex justify-center">
              <Hexagon className="h-9 w-9 text-accent-primary" />
            </div>
            <div className="section-label justify-center">Getting started</div>
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
            className="surface-card overflow-hidden p-7 sm:p-8"
          >
            <div className="mb-6 border-b border-border-subtle pb-6">
              <div className="mb-3 text-[13px] font-medium tracking-[-0.01em] text-text-primary">
                Continue with Google
              </div>
              <p className="mb-4 text-sm leading-6 text-text-secondary">
                Google sign-in is ready now and keeps your plan linked to one account.
              </p>

              {error ? (
                <div className="mb-4 rounded-[14px] border border-[rgba(248,113,113,0.22)] bg-status-skipped px-4 py-3 text-sm leading-6 text-status-error">
                  {error}
                </div>
              ) : null}

              <button
                onClick={handleGoogleAuth}
                disabled={loading}
                className="btn-secondary w-full justify-between px-4"
              >
                <span className="flex items-center gap-3">
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
                  <span>{loading ? 'Connecting to Google...' : 'Continue with Google'}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-accent-primary" />
              </button>
            </div>

            <div>
              <div className="mb-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-border-subtle" />
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  Email sign-in is next
                </span>
                <div className="h-px flex-1 bg-border-subtle" />
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                    Email address
                  </label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    className={inputClassName}
                    disabled
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                    Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className={inputClassName}
                    disabled
                  />
                </div>

                <button type="button" className="btn-ghost w-full" disabled>
                  Email sign-in is on the way
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
                  className="font-medium text-accent-primary transition-colors hover:text-accent-primary-hover"
                >
                  Start here
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="font-medium text-accent-primary transition-colors hover:text-accent-primary-hover"
                >
                  Sign in
                </Link>
              </>
            )}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
