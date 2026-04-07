import type { ChildProcess } from 'node:child_process';
import type {
  ContextArtifact,
  ExecutionHandle,
  ExecutionOptions,
  ExecutionResult,
  FailureClassification,
  LedgerState,
  LedgerTask,
  ParsedOutput,
  WorkerCapabilities,
  WorkerDriver,
  WorkerKind,
  WorkerPreflightResult,
} from '@scrimble/shared';

export type {
  ContextArtifact,
  ExecutionHandle,
  ExecutionOptions,
  ExecutionResult,
  FailureClassification,
  LedgerState,
  LedgerTask,
  ParsedOutput,
  WorkerCapabilities,
  WorkerDriver,
  WorkerKind,
  WorkerPreflightResult,
};

export interface DriverExecutionSession {
  handle: ExecutionHandle;
  process: ChildProcess;
  completion: Promise<ExecutionResult>;
  options: ExecutionOptions;
}

