import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Hexagon } from 'lucide-react';
import { motion } from 'framer-motion';
import { signInWithGoogle } from '../lib/firebase';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const pageVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const panelVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.6,
      ease: EASE_OUT_EXPO,
    },
  },
};

const contentVariants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.06,
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
      duration: 0.5,
      ease: EASE_OUT_EXPO,
    },
  },
};

const inputClassName =
  'h-12 w-full rounded-[8px] border border-border-default bg-bg-elevated px-4 text-[15px] text-text-primary placeholder:text-text-tertiary shadow-[inset_0_1px_0_rgba(255,252,242,0.02)] outline-none transition-[border-color,box-shadow,background-color] duration-200 focus:border-accent-primary focus:bg-bg-overlay focus:ring-2 focus:ring-accent-primary-muted';

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
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-base font-sans text-text-primary">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(235,94,40,0.08)_0%,transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,252,242,0.03)_0%,transparent_28%)]" />
      <div className="pointer-events-none absolute left-[10%] top-[12%] h-44 w-44 rounded-full bg-accent-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[10%] right-[10%] h-56 w-56 rounded-full bg-[rgba(255,252,242,0.04)] blur-3xl" />

      <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={pageVariants}
          className="w-full max-w-[448px]"
        >
          <motion.div
            variants={panelVariants}
            className="relative overflow-hidden rounded-[16px] border border-border-default bg-[linear-gradient(180deg,rgba(30,29,27,0.98)_0%,rgba(24,23,21,0.98)_100%)] p-8 shadow-[0_32px_90px_rgba(0,0,0,0.48)] sm:p-10"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent_0%,rgba(235,94,40,0.6)_50%,transparent_100%)]" />

            <motion.div variants={contentVariants} className="relative">
              <motion.div variants={itemVariants} className="mb-8 flex flex-col items-center text-center">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-[14px] border border-accent-border bg-accent-primary-muted">
                  <Hexagon className="h-6 w-6 text-accent-primary" />
                </div>
                <h1 className="text-heading">
                  {mode === 'login' ? 'Welcome back' : 'Create an account'}
                </h1>
                <p className="mt-3 max-w-[300px] text-body">
                  {mode === 'login'
                    ? 'Sign in to pick up your plan where you left it.'
                    : 'Start with a simple description and turn it into a build plan.'}
                </p>
              </motion.div>

              {error ? (
                <motion.div
                  variants={itemVariants}
                  className="mb-6 rounded-[8px] border border-[rgba(248,113,113,0.22)] bg-status-skipped px-4 py-3 text-sm text-[#f7c4b4]"
                >
                  {error}
                </motion.div>
              ) : null}

              <motion.button
                variants={itemVariants}
                onClick={handleGoogleAuth}
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-[8px] border border-border-default bg-bg-elevated px-4 text-[15px] font-medium text-[#f0e7db] shadow-[0_1px_0_rgba(255,252,242,0.02)] transition-all duration-200 hover:border-accent-border/50 hover:bg-bg-overlay hover:shadow-[0_0_20px_rgba(235,94,40,0.05)] disabled:cursor-not-allowed disabled:opacity-60"
              >
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
                {loading ? 'Connecting to Google...' : 'Continue with Google'}
              </motion.button>

              <motion.div variants={itemVariants} className="my-6 flex items-center">
                <div className="h-px flex-1 bg-border-default" />
                <span className="px-3 text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary">
                  or continue with email
                </span>
                <div className="h-px flex-1 bg-border-default" />
              </motion.div>

              <motion.form
                variants={contentVariants}
                className="space-y-4"
                onSubmit={(event) => event.preventDefault()}
              >
                <motion.div variants={itemVariants}>
                  <label className="mb-2 block text-[13px] font-medium text-[#c5bcad]">
                    Email address
                  </label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    className={inputClassName}
                  />
                </motion.div>

                <motion.div variants={itemVariants}>
                  <label className="mb-2 block text-[13px] font-medium text-[#c5bcad]">
                    Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className={inputClassName}
                  />
                </motion.div>

                <motion.button
                  variants={itemVariants}
                  type="button"
                  className="btn-primary mt-2 flex h-11 w-full items-center justify-center rounded-[8px]"
                >
                  {mode === 'login' ? 'Sign in' : 'Sign up'}
                </motion.button>
              </motion.form>

              <motion.div
                variants={itemVariants}
                className="mt-8 text-center text-sm text-[#b6ab99]"
              >
                {mode === 'login' ? (
                  <>
                    Don't have an account?{' '}
                    <Link
                      to="/signup"
                      className="font-medium text-accent-primary transition-colors hover:text-accent-primary-hover"
                    >
                      Sign up
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
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
