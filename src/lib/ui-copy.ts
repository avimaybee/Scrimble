/**
 * User-facing error and status messages.
 *
 * All messages should be:
 * - Short and scannable (under 100 chars)
 * - Action-oriented (tell user what to do)
 * - Honest about what happened
 */
export const UI_COPY = {
  auth: {
    signInFailed: 'Sign-in failed. Check your connection and try again, or use a different account.',
  },
  dashboard: {
    loadProjects: 'Failed to load projects. Check your connection, then refresh the page.',
    archiveProject: 'Archive failed. Refresh and try again.',
    restoreProject: 'Restore failed. Refresh and try again.',
    deleteProject: 'Delete failed. Refresh and try again.',
  },
  newProject: {
    loadPreparation: 'Failed to load saved settings. Refresh the page to continue.',
    reopenIntake: 'Failed to reopen conversation. Refresh and try again.',
    startPlan: 'Failed to start plan. Verify your AI key in Settings, then retry.',
    missingAiKey: 'Add an AI key in Settings before creating a plan.',
    startIntake: 'Failed to start conversation. Check your connection and try again.',
    sendReply: 'Message failed to send. Check your connection and retry.',
    saveModelRoles: 'Failed to save model roles. Refresh and try again.',
  },
  settings: {
    loadAi: 'Failed to load AI setup. Refresh the page.',
    loadModelRoles: 'Failed to load model controls. Refresh the page.',
    loadResearch: 'Failed to load research connectors. Refresh the page.',
    saveAiKey: 'Failed to save AI key. Check the key format and try again.',
    removeAiKey: 'Failed to remove AI key. Refresh and try again.',
    testAiKey: 'Connection test failed. Verify the key and try again.',
    saveModelRoles: 'Failed to save model roles. Refresh and try again.',
    connectResearch: 'Failed to connect tool. Check credentials and try again.',
    updateResearch: 'Failed to update tool. Refresh and try again.',
    disconnectResearch: 'Failed to disconnect tool. Refresh and try again.',
  },
  generation: {
    loadFailed: 'Failed to load generation status. Refresh the page.',
    streamFailed: 'Lost connection to generation stream. Refresh to reconnect.',
    reviewLoadFailed: 'Failed to load review. Refresh and try again.',
    approveReviewFailed: 'Approval failed. Refresh and try again.',
    switchModelFailed: 'Failed to switch model. Try again or use a different model.',
    nudgeFailed: 'Failed to check runner status. Refresh to see latest state.',
    resumeFailed: 'Resume failed. Refresh and try again from the dashboard.',
    cancelFailed: 'Cancel failed. Refresh and check generation status.',
    stalledResume:
      'Runner was quiet too long. Scrimble resumed from the last checkpoint.',
    degradedResearch:
      'Research was limited — some fetches failed. Regenerate for deeper results.',
  },
  detailPanel: {
    loadStep: 'Failed to load step details. Refresh and try again.',
    loadProviders: 'Failed to load AI providers. Refresh the page.',
    updateTask: 'Task update failed. Refresh and try again.',
    completeStep: 'Failed to mark step complete. Refresh and retry.',
    reviewSubmit: 'Review submission failed. Refresh and try again.',
    aiRequest: 'AI request failed. Check your AI key in Settings.',
  },
  runtime: {
    migrationSensitiveFailure:
      'Server is updating. Wait a moment, then retry from the latest checkpoint.',
  },
} as const;
