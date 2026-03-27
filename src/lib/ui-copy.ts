export const UI_COPY = {
  auth: {
    signInFailed: 'Could not sign you in right now. Try again.',
  },
  dashboard: {
    loadProjects: 'Could not load your projects.',
    archiveProject: 'Could not archive that project.',
    restoreProject: 'Could not restore that project.',
    deleteProject: 'Could not delete project.',
  },
  newProject: {
    loadPreparation: 'Could not load your saved settings. Reload and try again.',
    reopenIntake: 'Could not reopen this intake conversation.',
    startPlan: 'Could not start your plan. Check your AI key and try again.',
    missingAiKey: 'You need to add an AI key first.',
    startIntake: 'Could not start the intake conversation. Try again.',
    sendReply: 'Could not send that reply. Try again.',
    saveModelRoles: 'Could not save model role settings.',
  },
  settings: {
    loadAi: 'Could not load your AI setup right now. Try again.',
    loadModelRoles: 'Could not load advanced model controls right now. Try again.',
    loadResearch: 'Could not load your research connectors right now. Try again.',
    saveAiKey: 'Could not save your AI key. Try again.',
    removeAiKey: 'Could not remove that AI key. Try again.',
    testAiKey: 'Could not test that AI key. Try again.',
    saveModelRoles: 'Could not save model roles. Try again.',
    connectResearch: 'Could not connect that research tool. Try again.',
    updateResearch: 'Could not update that research tool. Try again.',
    disconnectResearch: 'Could not disconnect that research tool. Try again.',
  },
  generation: {
    loadFailed: 'Could not load generation status right now.',
    streamFailed: 'Could not connect to the generation stream.',
    reviewLoadFailed: 'Could not load your review right now.',
    approveReviewFailed: 'Could not approve your review right now.',
    switchModelFailed: 'Could not switch that model right now.',
    nudgeFailed: 'Could not check in with the runner right now.',
    resumeFailed: 'Could not resume generation right now. Try again.',
    cancelFailed: 'Could not cancel generation right now. Try again.',
    stalledResume:
      'The runner stayed quiet for too long, so I asked Scrimble to resume from the last completed checkpoint.',
    degradedResearch:
      'Research was limited for this plan — some fetches failed. You can regenerate for a deeper result.',
  },
  detailPanel: {
    loadStep: 'Could not load this step right now.',
    loadProviders: 'Could not load AI providers right now.',
    updateTask: 'Could not update that task right now.',
    completeStep: 'Could not mark this step complete right now.',
    reviewSubmit: 'Could not submit this review right now.',
    aiRequest: 'Could not get an AI response right now.',
  },
  runtime: {
    migrationSensitiveFailure:
      'The server is updating runtime data. Retry in a moment and resume from the latest checkpoint if needed.',
  },
} as const;
