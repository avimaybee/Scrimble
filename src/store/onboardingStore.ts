import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OnboardingStep = 'key' | 'profile' | 'project';

export interface OnboardingState {
  isOnboarded: boolean;
  currentStep: number;
  completedSteps: number[];
  isDismissed: boolean;
  hasSeenWelcome: boolean;
  completeStep: (step: OnboardingStep) => void;
  setCurrentStep: (step: number) => void;
  dismiss: () => void;
  markOnboarded: () => void;
  reset: () => void;
}

const STORAGE_KEY = 'scrimble_onboarding';

const initialState = {
  isOnboarded: false,
  currentStep: 0,
  completedSteps: [] as number[],
  isDismissed: false,
  hasSeenWelcome: false,
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      ...initialState,

      completeStep: (step: OnboardingStep) => {
        const stepIndex = { key: 0, profile: 1, project: 2 }[step];
        const { completedSteps } = get();
        
        if (!completedSteps.includes(stepIndex)) {
          set({
            completedSteps: [...completedSteps, stepIndex],
          });
        }
      },

      setCurrentStep: (step: number) => {
        set({ currentStep: step, hasSeenWelcome: true });
      },

      dismiss: () => {
        set({ isDismissed: true });
      },

      markOnboarded: () => {
        set({ isOnboarded: true });
      },

      reset: () => {
        set(initialState);
      },
    }),
    {
      name: STORAGE_KEY,
    }
  )
);

export const ONBOARDING_STEPS: OnboardingStep[] = ['key', 'profile', 'project'];

export function getOnboardingProgress(state: OnboardingState): number {
  if (state.isOnboarded || state.completedSteps.length === 3) {
    return 100;
  }
  return Math.round((state.completedSteps.length / 3) * 100);
}

export function checkOnboardingComplete(
  hasAIKey: boolean,
  hasBuilderProfile: boolean,
  hasProjects: boolean
): boolean {
  return hasAIKey && hasBuilderProfile && hasProjects;
}
