import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { logout } from '../lib/firebase';
import { LogOut, User, Key, Check } from 'lucide-react';
import { getKeys, saveKeys, ProviderKeys } from '../lib/ai';

export default function Settings() {
  const { user } = useAuthStore();
  const [keys, setKeys] = useState<ProviderKeys>({ gemini: '', openai: '', anthropic: '', custom: '', modal: '' });
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    const storedKeys = getKeys();
    setKeys({
      gemini: storedKeys.gemini || '',
      openai: storedKeys.openai || '',
      anthropic: storedKeys.anthropic || '',
      custom: storedKeys.custom || '',
      modal: storedKeys.modal || ''
    });
  }, []);

  const handleSaveKeys = () => {
    saveKeys(keys);
    setSaveMessage('Keys saved securely to your browser.');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  return (
    <main className="pt-16 pb-16 px-6 max-w-2xl mx-auto w-full font-sans">
      <h1 className="text-heading mb-8">Settings</h1>
      
      <div className="bg-bg-surface border border-border-default rounded-2xl p-6 mb-8 shadow-panel">
        <h2 className="text-xl font-medium text-text-primary mb-6 flex items-center gap-2">
          <User className="w-5 h-5 text-accent-primary" />
          Account Profile
        </h2>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-xl bg-bg-elevated border border-border-default overflow-hidden flex items-center justify-center">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <User className="w-8 h-8 text-text-secondary" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-medium text-text-primary">{user?.displayName || 'User'}</h3>
            <p className="text-text-secondary">{user?.email}</p>
          </div>
        </div>
        
        <div className="pt-6 border-t border-border-subtle">
          <button 
            onClick={() => logout()}
            className="btn-ghost flex items-center gap-2 text-status-secure hover:bg-status-secure/10 hover:text-status-secure"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>

      <div className="bg-bg-surface border border-border-default rounded-2xl p-6 shadow-panel">
        <div className="mb-6">
          <h2 className="text-xl font-medium text-text-primary flex items-center gap-2 mb-2">
            <Key className="w-5 h-5 text-accent-primary" />
            AI Providers (Bring Your Own Key)
          </h2>
          <p className="text-sm text-text-secondary">
            Keys are stored locally in your browser and are never sent to our servers. Your agentic workflows require at least one configured provider.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Modal GLM-5 API Key (Recommended)</label>
            <input 
              type="password" 
              value={keys.modal}
              onChange={e => setKeys(prev => ({ ...prev, modal: e.target.value }))}
              placeholder="modalresearch_..."
              className="w-full bg-bg-elevated border border-border-default focus:border-accent-primary focus:ring-1 focus:ring-accent-primary rounded-md h-11 px-4 text-text-primary placeholder:text-text-tertiary outline-none font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Google Gemini API Key</label>
            <input 
              type="password" 
              value={keys.gemini}
              onChange={e => setKeys(prev => ({ ...prev, gemini: e.target.value }))}
              placeholder="AIzaSy..."
              className="w-full bg-bg-elevated border border-border-default focus:border-accent-primary focus:ring-1 focus:ring-accent-primary rounded-md h-11 px-4 text-text-primary placeholder:text-text-tertiary outline-none font-mono text-sm"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Custom Provider Key (Optional)</label>
            <input 
              type="password" 
              value={keys.custom}
              onChange={e => setKeys(prev => ({ ...prev, custom: e.target.value }))}
              placeholder="Enter custom API key..."
              className="w-full bg-bg-elevated border border-border-default focus:border-accent-primary focus:ring-1 focus:ring-accent-primary rounded-md h-11 px-4 text-text-primary placeholder:text-text-tertiary outline-none font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">OpenAI API Key (Coming Soon)</label>
            <input 
              type="password" 
              value={keys.openai}
              onChange={e => setKeys(prev => ({ ...prev, openai: e.target.value }))}
              placeholder="sk-..."
              disabled
              className="w-full bg-bg-elevated/50 border border-border-default rounded-md h-11 px-4 text-text-primary placeholder:text-text-tertiary outline-none font-mono text-sm opacity-50 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Anthropic API Key (Coming Soon)</label>
            <input 
              type="password" 
              value={keys.anthropic}
              onChange={e => setKeys(prev => ({ ...prev, anthropic: e.target.value }))}
              placeholder="sk-ant-..."
              disabled
              className="w-full bg-bg-elevated/50 border border-border-default rounded-md h-11 px-4 text-text-primary placeholder:text-text-tertiary outline-none font-mono text-sm opacity-50 cursor-not-allowed"
            />
          </div>
        </div>

        <div className="pt-6 mt-6 border-t border-border-subtle flex items-center justify-between">
          <div className="text-sm text-status-success flex items-center gap-1 min-h-[20px]">
            {saveMessage && <><Check className="w-4 h-4" /> {saveMessage}</>}
          </div>
          <button 
            onClick={handleSaveKeys}
            className="btn-primary"
          >
            Save Keys
          </button>
        </div>
      </div>
    </main>
  );
}
