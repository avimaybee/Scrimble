import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { dbService } from '../../lib/db';
import {
  BUILDER_PROFILE_CATEGORIES,
  TOOL_PROFICIENCIES,
  getBuilderProfileCompletionLevel,
  getBuilderProfileCompletionProgress,
  getBuilderProfileReaction,
  normalizeBuilderProfileName,
  type BuilderProfileCategory,
  type BuilderProfileTool,
  type ToolProficiency,
} from '../../lib/builder-profile';
import { cn } from '../../lib/utils';

const proficiencyOptions: Array<{
  value: ToolProficiency;
  short: 'L' | 'C' | 'E';
  label: string;
}> = [
  { value: 'learning', short: 'L', label: 'Learning' },
  { value: 'comfortable', short: 'C', label: 'Comfortable' },
  { value: 'expert', short: 'E', label: 'Expert' },
];

function createCategoryRecord<T>(factory: () => T) {
  return BUILDER_PROFILE_CATEGORIES.reduce(
    (accumulator, category) => {
      accumulator[category.key] = factory();
      return accumulator;
    },
    {} as Record<BuilderProfileCategory, T>,
  );
}

function sortTools(tools: BuilderProfileTool[]) {
  return [...tools].sort((left, right) => {
    if (left.category === right.category) {
      return left.name.localeCompare(right.name);
    }

    return left.category.localeCompare(right.category);
  });
}

function getNextProficiency(current: ToolProficiency) {
  const currentIndex = TOOL_PROFICIENCIES.indexOf(current);
  return TOOL_PROFICIENCIES[(currentIndex + 1) % TOOL_PROFICIENCIES.length];
}

type BuilderProfileSectionProps = {
  onToolCountChange?: (count: number) => void;
};

export function BuilderProfileSection({ onToolCountChange }: BuilderProfileSectionProps = {}) {
  const [tools, setTools] = useState<BuilderProfileTool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [expandedCustomCategory, setExpandedCustomCategory] = useState<BuilderProfileCategory | null>(null);
  const [customInputs, setCustomInputs] = useState<Record<BuilderProfileCategory, string>>(
    () => createCategoryRecord(() => ''),
  );
  const [reactionFocus, setReactionFocus] = useState<Partial<Record<BuilderProfileCategory, string>>>({});

  useEffect(() => {
    onToolCountChange?.(tools.length);
  }, [onToolCountChange, tools.length]);

  useEffect(() => {
    let isMounted = true;

    const loadTools = async () => {
      try {
        const result = await dbService.getUserTools();
        if (!isMounted) {
          return;
        }

        setTools(sortTools(result));
      } catch (error: unknown) {
        if (!isMounted) {
          return;
        }

        toast.error(
          error instanceof Error ? error.message : 'Could not load your builder profile right now.',
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadTools();

    return () => {
      isMounted = false;
    };
  }, []);

  const toolsByCategory = useMemo(() => {
    return BUILDER_PROFILE_CATEGORIES.reduce(
      (accumulator, category) => {
        accumulator[category.key] = tools.filter((tool) => tool.category === category.key);
        return accumulator;
      },
      {} as Record<BuilderProfileCategory, BuilderProfileTool[]>,
    );
  }, [tools]);

  const toolCount = tools.length;
  const completionLevel = getBuilderProfileCompletionLevel(toolCount);
  const completionProgress = getBuilderProfileCompletionProgress(toolCount);

  const replaceTool = (nextTool: BuilderProfileTool) => {
    setTools((current) =>
      sortTools([
        ...current.filter((tool) => tool.id !== nextTool.id),
        nextTool,
      ]),
    );
  };

  const removeToolFromState = (toolToRemove: BuilderProfileTool) => {
    setTools((current) => current.filter((tool) => tool.id !== toolToRemove.id));
    setReactionFocus((current) => {
      const remainingInCategory = toolsByCategory[toolToRemove.category].filter(
        (tool) => tool.id !== toolToRemove.id,
      );

      return {
        ...current,
        [toolToRemove.category]: remainingInCategory[remainingInCategory.length - 1]?.name,
      };
    });
  };

  const handleToggleTool = async (category: BuilderProfileCategory, name: string) => {
    const normalizedName = normalizeBuilderProfileName(name);
    const existing = toolsByCategory[category].find(
      (tool) => normalizeBuilderProfileName(tool.name) === normalizedName,
    );
    const key = `toggle:${category}:${normalizedName}`;
    setSavingKey(key);

    try {
      if (existing) {
        await dbService.deleteUserTool(existing.id);
        removeToolFromState(existing);
        toast.success(`${existing.name} removed from your builder profile.`);
        return;
      }

      const saved = await dbService.saveUserTool({
        category,
        name,
        proficiency: 'comfortable',
      });

      replaceTool(saved);
      setReactionFocus((current) => ({
        ...current,
        [category]: saved.name,
      }));
      toast.success(`${saved.name} added to your builder profile.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not update your builder profile.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleCustomSubmit = async (event: FormEvent<HTMLFormElement>, category: BuilderProfileCategory) => {
    event.preventDefault();
    const name = customInputs[category].trim();

    if (!name) {
      toast.error('Add a tool name first.');
      return;
    }

    const key = `custom:${category}:${normalizeBuilderProfileName(name)}`;
    setSavingKey(key);

    try {
      const saved = await dbService.saveUserTool({
        category,
        name,
        proficiency: 'comfortable',
      });

      replaceTool(saved);
      setCustomInputs((current) => ({
        ...current,
        [category]: '',
      }));
      setExpandedCustomCategory(null);
      setReactionFocus((current) => ({
        ...current,
        [category]: saved.name,
      }));
      toast.success(`${saved.name} added to your builder profile.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not add that tool.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleUpdateProficiency = async (tool: BuilderProfileTool, requested: ToolProficiency) => {
    const nextProficiency = requested === tool.proficiency ? getNextProficiency(tool.proficiency) : requested;
    const key = `proficiency:${tool.id}`;
    setSavingKey(key);

    try {
      const updated = await dbService.updateUserTool(tool.id, {
        proficiency: nextProficiency,
      });

      replaceTool(updated);
      setReactionFocus((current) => ({
        ...current,
        [tool.category]: tool.name,
      }));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not save that proficiency level.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <section
      id="workspace"
      className="rounded-[16px] border border-border-default bg-bg-surface p-6 shadow-panel"
    >
      <span id="builder-profile" className="sr-only" aria-hidden="true" />
      <div className="mb-6 flex items-center gap-3">
        <span className="h-px w-8 bg-accent-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-primary">
          My Builder Profile
        </span>
      </div>

      <div className="mb-6 max-w-[700px]">
        <h2 className="text-[30px] font-serif tracking-[-0.035em] text-text-primary">
          The more I know about your setup, the more specific every plan becomes.
        </h2>
        <p className="mt-3 max-w-[620px] text-body">
          This is saved permanently - you never repeat yourself.
        </p>
      </div>

      <div className="mb-8 rounded-[16px] border border-border-default bg-bg-elevated/55 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[12px] font-medium text-text-secondary">Profile completeness</div>
            <div className="mt-1 text-[15px] tracking-[-0.02em] text-text-primary">
              {toolCount === 0
                ? 'Start with the tools you use every day.'
                : `${toolCount} tool${toolCount === 1 ? '' : 's'} saved - ${completionLevel || 'Basic'}.`}
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent-primary-muted px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-primary">
            <Sparkles className="h-3.5 w-3.5" />
            {completionLevel || 'Ready to start'}
          </div>
        </div>

        <div className="mt-4 h-[6px] overflow-hidden rounded-full bg-bg-base">
          <div
            className="h-full rounded-full bg-accent-primary transition-[width] duration-300 ease-out"
            style={{ width: `${completionProgress}%` }}
          />
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
          {[
            { label: 'Basic', active: toolCount >= 1 && toolCount <= 3 },
            { label: 'Good', active: toolCount >= 4 && toolCount <= 7 },
            { label: 'Dialled in', active: toolCount >= 8 && toolCount <= 12 },
            { label: 'Fully loaded', active: toolCount >= 13 },
          ].map((item) => (
            <span
              key={item.label}
              className={cn(item.active ? 'text-accent-primary' : 'text-text-muted')}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {BUILDER_PROFILE_CATEGORIES.map((category) => {
          const selectedTools = toolsByCategory[category.key];
          const focusedToolName = reactionFocus[category.key];
          const reactionTool =
            selectedTools.find(
              (tool) => normalizeBuilderProfileName(tool.name) === normalizeBuilderProfileName(focusedToolName || ''),
            ) || selectedTools[selectedTools.length - 1] || null;
          const reaction = reactionTool
            ? getBuilderProfileReaction(reactionTool.name, category.key)
            : null;

          return (
            <div
              key={category.key}
              className="rounded-[16px] border border-border-default bg-bg-elevated/35 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[12px] font-medium text-text-secondary">{category.label}</h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  {selectedTools.length} saved
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {category.presets.map((preset) => {
                  const normalizedPreset = normalizeBuilderProfileName(preset);
                  const selected = selectedTools.some(
                    (tool) => normalizeBuilderProfileName(tool.name) === normalizedPreset,
                  );
                  const isSavingChip = savingKey === `toggle:${category.key}:${normalizedPreset}`;

                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => void handleToggleTool(category.key, preset)}
                      disabled={Boolean(savingKey)}
                      className={cn(
                        'inline-flex min-h-[34px] items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        selected
                          ? 'border-accent-border bg-accent-primary-muted text-accent-primary'
                          : 'border-border-default bg-bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary',
                      )}
                    >
                      {isSavingChip ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {preset}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() =>
                    setExpandedCustomCategory((current) => (current === category.key ? null : category.key))
                  }
                  className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-dashed border-accent-border bg-bg-surface px-3 py-1.5 text-[13px] font-medium text-accent-primary transition-colors hover:bg-accent-primary-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add your own
                </button>
              </div>

              {expandedCustomCategory === category.key ? (
                <form
                  onSubmit={(event) => void handleCustomSubmit(event, category.key)}
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                >
                  <input
                    value={customInputs[category.key]}
                    onChange={(event) =>
                      setCustomInputs((current) => ({
                        ...current,
                        [category.key]: event.target.value,
                      }))
                    }
                    placeholder={
                      category.key === 'other_subscriptions'
                        ? 'e.g. GitHub Copilot Pro'
                        : `Add a ${category.label.toLowerCase()} tool`
                    }
                    className="field-input h-10 flex-1"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={savingKey === `custom:${category.key}:${normalizeBuilderProfileName(customInputs[category.key])}`}
                      className="btn-primary h-10 px-4 py-0"
                    >
                      {savingKey === `custom:${category.key}:${normalizeBuilderProfileName(customInputs[category.key])}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedCustomCategory(null);
                        setCustomInputs((current) => ({
                          ...current,
                          [category.key]: '',
                        }));
                      }}
                      className="inline-flex h-10 items-center justify-center rounded-[10px] border border-border-default px-4 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}

              {selectedTools.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  {selectedTools.map((tool) => {
                    const isUpdating = savingKey === `proficiency:${tool.id}`;

                    return (
                      <div
                        key={tool.id}
                        className="min-w-[190px] rounded-[14px] border border-accent-border bg-accent-primary-muted/70 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[14px] font-medium text-text-primary">{tool.name}</div>
                            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-primary">
                              {tool.proficiency}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleToggleTool(tool.category, tool.name)}
                            disabled={Boolean(savingKey)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-text-muted transition-colors hover:border-border-default hover:text-text-primary"
                            aria-label={`Remove ${tool.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="mt-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                          {proficiencyOptions.map((option) => {
                            const active = tool.proficiency === option.value;

                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => void handleUpdateProficiency(tool, option.value)}
                                disabled={Boolean(savingKey)}
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-full border px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                  active
                                    ? 'border-accent-border bg-bg-surface text-accent-primary'
                                    : 'border-transparent bg-bg-surface/60 text-text-muted hover:border-border-default hover:text-text-primary',
                                )}
                                aria-label={`${tool.name}: ${option.label}`}
                              >
                                <span
                                  className={cn(
                                    'h-2 w-2 rounded-full',
                                    active ? 'bg-accent-primary' : 'bg-text-muted/40',
                                  )}
                                />
                                {option.short}
                              </button>
                            );
                          })}
                          {isUpdating ? <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-accent-primary" /> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {reaction ? (
                <div className="mt-4 rounded-[12px] border border-border-default/80 bg-bg-base/45 px-3 py-2">
                  <p className="font-mono text-[10px] leading-5 text-text-muted">{reaction}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
