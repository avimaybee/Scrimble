// Gemini CLI preflight model used by local setup checks.

/** Status of Gemini CLI detection. */
export interface GeminiStatus {
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}

/** Status of headless authentication. */
export interface HeadlessAuthStatus {
  available: boolean;
  error?: string;
}

/** Status of folder trust configuration. */
export interface FolderTrustStatus {
  enabled: boolean;
  workspaceTrusted: boolean;
  error?: string;
}

/** Complete preflight check result. */
export interface PreflightResult {
  gemini: GeminiStatus;
  headlessAuth: HeadlessAuthStatus;
  folderTrust: FolderTrustStatus;
  canProceed: boolean;
  warnings: string[];
  errors: string[];
}
