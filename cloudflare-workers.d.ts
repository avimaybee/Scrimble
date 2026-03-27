declare module 'cloudflare:workers' {
  export class WorkerEntrypoint<Env = unknown> {
    protected readonly env: Env;
    protected readonly ctx: { waitUntil(promise: Promise<unknown>): void };
    fetch(request: Request): Response | Promise<Response>;
  }

  export type WorkflowBackoff = 'constant' | 'linear' | 'exponential';

  export type WorkflowStepConfig = {
    retries?: {
      limit: number;
      delay: string | number;
      backoff?: WorkflowBackoff;
    };
    timeout?: string | number;
  };

  export type WorkflowEvent<T = unknown> = {
    payload: Readonly<T>;
    timestamp: Date;
    instanceId: string;
  };

  export interface WorkflowStep {
    do<T>(
      name: string,
      callback: () => Promise<T> | T,
    ): Promise<T>;
    do<T>(
      name: string,
      config: WorkflowStepConfig,
      callback: () => Promise<T> | T,
    ): Promise<T>;
    sleep(name: string, duration: string | number): Promise<void>;
    sleepUntil(name: string, timestamp: Date | number): Promise<void>;
    waitForEvent<T = unknown>(
      name: string,
      options: { type: string; timeout?: string | number },
    ): Promise<T>;
  }

  export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    protected readonly env: Env;
    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }
}
