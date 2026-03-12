import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { dbService } from '../lib/db';

interface UseStepExecutionProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface ExecuteStepOptions {
  providerId?: string;
  feedback?: string;
  editedOutput?: string;
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
      await dbService.streamStepEnrichment(
        stepId,
        {
          projectId,
          providerId: options.providerId,
          feedback: options.feedback,
          editedOutput: options.editedOutput,
        },
        {
          signal: abortControllerRef.current.signal,
          onOutput: setStreamingOutput,
        },
      );

      onSuccess?.();
      toast.success('Agent completed work on this step.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      const msg = error instanceof Error ? error.message : 'Something went wrong';
      setError(msg);
      onError?.(msg);
      toast.error(msg);
    } finally {
      abortControllerRef.current = null;
      setIsAgentWorking(false);
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
