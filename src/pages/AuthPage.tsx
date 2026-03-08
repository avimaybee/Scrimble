import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Hexagon } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';
import { motion } from 'framer-motion';

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
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-6 font-sans">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-[420px] bg-bg-surface border border-border-default rounded-[24px] p-10 shadow-panel"
      >
        <div className="flex flex-col items-center mb-8">
          <Hexagon className="w-10 h-10 text-accent-primary mb-4" />
          <h1 className="text-heading text-center">
            {mode === 'login' ? 'Welcome back' : 'Create an account'}
          </h1>
          <p className="text-body mt-2 text-center">
            {mode === 'login' ? 'Sign in to continue to Scrimble' : 'Start building your next project'}
          </p>
        </div>

        {error && (
          <div className="bg-status-skipped border border-status-secure text-status-secure px-4 py-3 rounded-lg text-sm mb-6">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleAuth}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white text-black hover:bg-gray-100 font-medium px-4 py-3 rounded-xl transition-colors disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center my-6">
          <div className="flex-1 border-t border-border-default"></div>
          <span className="px-3 text-xs text-text-tertiary uppercase tracking-wider">or continue with email</span>
          <div className="flex-1 border-t border-border-default"></div>
        </div>

        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Email address</label>
            <input 
              type="email" 
              placeholder="you@example.com"
              className="w-full bg-bg-elevated border border-border-default focus:border-accent-primary focus:ring-2 focus:ring-accent-primary-muted rounded-md h-11 px-4 text-text-primary placeholder:text-text-tertiary transition-all duration-200 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Password</label>
            <input 
              type="password" 
              placeholder="••••••••"
              className="w-full bg-bg-elevated border border-border-default focus:border-accent-primary focus:ring-2 focus:ring-accent-primary-muted rounded-md h-11 px-4 text-text-primary placeholder:text-text-tertiary transition-all duration-200 outline-none"
            />
          </div>
          <button 
            type="button"
            className="w-full bg-accent-primary hover:bg-accent-primary-hover text-white font-medium h-11 rounded-xl transition-colors mt-2"
          >
            {mode === 'login' ? 'Sign in' : 'Sign up'}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-text-secondary">
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <Link to="/signup" className="text-accent-primary hover:text-accent-primary-hover font-medium transition-colors">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <Link to="/login" className="text-accent-primary hover:text-accent-primary-hover font-medium transition-colors">
                Sign in
              </Link>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
