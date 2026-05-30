export class LocalDB {
  constructor(private projectId: string, private runId: string) {}
  
  prepare(query: string) {
    return {
      bind: (...args: any[]) => ({
        first: async () => {
          if (query.includes('FROM projects')) {
            return {
              id: this.projectId,
              user_id: 'local-user',
              name: 'local-project',
              description: 'Local project generation',
              intake_answers: '{}',
              project_type: 'web',
              stack: '[]',
              current_generation_run_id: this.runId
            };
          }
          if (query.includes('FROM generation_runs')) {
            return {
              id: this.runId,
              status: 'running',
              current_batch: null,
              heartbeat_at: null,
              error_message: null,
              provider_id: null,
              review_draft: null
            };
          }
          if (query.includes('FROM builder_profiles')) {
            return {
              declared_tools: '[]'
            };
          }
          if (query.includes('FROM generation_checkpoints')) {
             return {
                payload_r2_key: 'fake-r2-key'
             };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
  }
}
