import { useState, useCallback, useRef } from 'react';
import { auth } from '../lib/firebase';
import { toast } from 'sonner';

interface UseStepExecutionProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function useStepExecution({ onSuccess, onError }: UseStepExecutionProps = {}) {
  const [isExecuting, setIsAgentWorking] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const executeStep = useCallback(async (stepId: string, projectId: string, providerId: string) => {
    setIsAgentWorking(true);
    setStreamingOutput('');
    setError(null);
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');
      
      const token = await user.getIdToken();

      const response = await fetch(`/api/steps/${stepId}/enrich`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ projectId, providerId }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Enrichment failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (!reader) throw new Error('No response body');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            
            try {
              const parsed = JSON.parse(data);
              let delta = '';
              
              if (parsed.choices?.[0]?.delta?.content) {
                delta = parsed.choices[0].delta.content;
              } else if (parsed.content?.[0]?.text) {
                delta = parsed.content[0].text;
              } else if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
                delta = parsed.candidates[0].content.parts[0].text;
              }

              fullContent += delta;
              setStreamingOutput(fullContent);
            } catch (e) {
              // Ignore partial JSON or comments
            }
          }
        }
      }

      setIsAgentWorking(false);
      onSuccess?.();
      toast.success('Agent completed work on this step.');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      
      const msg = err.message || 'Something went wrong';
      setError(msg);
      setIsAgentWorking(false);
      onError?.(msg);
      toast.error(msg);
    }
  }, [onSuccess, onError]);

  const cancelExecution = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsAgentWorking(false);
    }
  }, []);

  return {
    executeStep,
    cancelExecution,
    isExecuting,
    streamingOutput,
    error
  };
}
