import { useState, useCallback, useRef } from 'react';
import { auth } from '../lib/firebase';
import { toast } from 'sonner';

interface UseStepExecutionProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface ExecuteStepOptions {
  providerId?: string;
  feedback?: string;
  editedOutput?: string;
}

function extractStreamText(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const value = parsed as {
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
    content?: Array<{ text?: string }>;
    delta?: { text?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (value.choices?.[0]?.delta?.content) {
    return value.choices[0].delta.content;
  }

  if (value.choices?.[0]?.message?.content) {
    return value.choices[0].message.content;
  }

  if (value.content?.[0]?.text) {
    return value.content[0].text;
  }

  if (value.delta?.text) {
    return value.delta.text;
  }

  if (value.candidates?.[0]?.content?.parts?.[0]?.text) {
    return value.candidates[0].content.parts[0].text;
  }

  return '';
}

export function useStepExecution({ onSuccess, onError }: UseStepExecutionProps = {}) {
  const [isExecuting, setIsAgentWorking] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const executeStep = useCallback(async (stepId: string, projectId: string, options: ExecuteStepOptions = {}) => {
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
        body: JSON.stringify({
          projectId,
          providerId: options.providerId,
          feedback: options.feedback,
          editedOutput: options.editedOutput,
        }),
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
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue;
          }

          const data = trimmedLine.startsWith('data: ') ? trimmedLine.slice(6) : trimmedLine;
          if (!data || data === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = extractStreamText(parsed);
            if (!delta) {
              continue;
            }

            fullContent += delta;
            setStreamingOutput(fullContent);
          } catch {
            if (!trimmedLine.startsWith('data: ')) {
              fullContent += data;
              setStreamingOutput(fullContent);
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
