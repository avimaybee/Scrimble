import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { dbService } from '../../lib/db';
import {
  BUILDER_PROFILE_CATEGORIES,
  TOOL_PROFICIENCIES,
  getBuilderProfileCompletionLevel,
  getBuilderProfileReaction,
  normalizeBuilderProfileName,
  type BuilderProfileCategory,
  type BuilderProfileTool,
  type ToolProficiency,
} from '../../lib/builder-profile';
import { cn } from '../../lib/utils';
import {
  Check,
  Loader2,
  Plus,
  Terminal,
  Boxes,
  Database,
  Shield,
  CreditCard,
  Layout,
  Lightbulb,
  User,
  type LucideIcon,
} from 'lucide-react';

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

interface ToolCardProps {
  name: string;
  isSelected?: boolean;
  proficiency?: ToolProficiency;
  isSaving?: boolean;
  isPendingRemoval?: boolean;
  onToggle: () => void;
  onProficiencyChange?: (p: ToolProficiency) => void;
  onConfirmRemoval?: () => void;
  onCancelRemoval?: () => void;
}

function ToolCard({
  name,
  isSelected,
  proficiency,
  isSaving,
  isPendingRemoval,
  onToggle,
  onProficiencyChange,
  onConfirmRemoval,
  onCancelRemoval,
}: ToolCardProps) {
  const proficiencyLevel = useMemo(() => {
    if (!proficiency) return 0;
    return TOOL_PROFICIENCIES.indexOf(proficiency) + 1;
  }, [proficiency]);

  if (isPendingRemoval) {
    return (
      <motion.div
        layout
        initial={false}
        className="flex h-11 items-center gap-2 rounded-lg border border-status-error/35 bg-status-error/8 px-2.5"
      >
        <button
          type="button"
          onClick={onCancelRemoval}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border-default px-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirmRemoval}
          className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-status-error/45 px-2.5 text-xs font-semibold text-status-error transition-colors hover:bg-status-error/12"
        >
          Are you sure?
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={false}
      animate={{
        borderColor: isSelected ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
        backgroundColor: isSelected ? 'rgba(235, 94, 40, 0.08)' : 'rgba(255, 252, 242, 0.02)',
        boxShadow: isSelected
          ? 'inset 0 0 0 1px rgba(235, 94, 40, 0.16)'
          : 'inset 0 0 0 1px rgba(204, 197, 185, 0)',
      }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'group relative flex h-11 items-center justify-between overflow-hidden rounded-lg border px-3.5',
        isSelected ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        isSelected && 'border-opacity-60',
      )}
      onClick={onToggle}
    >
      <div className="flex flex-1 items-center gap-2.5 min-w-0">
        <motion.div
          layout="position"
          className={cn(
            'truncate text-[13px] font-medium transition-colors',
            isSelected ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary',
          )}
        >
          {name}
        </motion.div>

        {isSelected && (
          <motion.div
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 0.6, x: 0 }}
            whileHover={{ opacity: 1 }}
            className="flex shrink-0 items-center gap-0.5 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              if (onProficiencyChange) onProficiencyChange(getNextProficiency(proficiency!));
            }}
            title={`Proficiency: ${proficiency}`}
          >
            {[1, 2, 3].map((dot) => (
              <div
                key={dot}
                className={cn(
                  'h-1 w-2 rounded-full transition-all duration-300',
                  dot <= proficiencyLevel ? 'bg-accent-primary' : 'bg-text-primary/10',
                )}
              />
            ))}
          </motion.div>
        )}
      </div>

      <div className="flex shrink-0 items-center pl-2">
        {isSelected ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-primary text-bg-base"
          >
            <Check className="h-2.5 w-2.5" />
          </motion.div>
        ) : (
          <div className="h-4 w-4 rounded-full border border-border-default/50 bg-bg-surface/50 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>

      {isSaving && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 flex items-center justify-center backdrop-blur-[1px] bg-bg-surface/60"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-primary" />
        </motion.div>
      )}
    </motion.div>
  );
}

const SectionSkeleton = ({ count = 3 }: { count?: number }) => (
  <div className="space-y-4">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="h-20 w-full skeleton-shimmer rounded-2xl"
        style={{ animationDelay: `${i * 100}ms` }}
      />
    ))}
  </div>
);

const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border-default bg-bg-elevated/10 p-12 text-center">
    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated text-text-tertiary">
      <Icon className="h-8 w-8" />
    </div>
    <h3 className="mb-2 text-lg font-semibold text-text-primary">{title}</h3>
    <p className="mb-6 max-w-xs text-sm leading-relaxed text-text-secondary">{description}</p>
    {action}
  </div>
);

export function BuilderProfileSection() {
  const [tools, setTools] = useState<BuilderProfileTool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const removeIntentTimeoutRef = useRef<number | null>(null);
  const [expandedCustomCategory, setExpandedCustomCategory] = useState<BuilderProfileCategory | null>(
    null,
  );
  const [customInputs, setCustomInputs] = useState<Record<BuilderProfileCategory, string>>(() =>
    createCategoryRecord(() => ''),
  );
  const [reactionFocus, setReactionFocus] = useState<Partial<Record<BuilderProfileCategory, string>>>(
    {},
  );
  const [pendingToolRemovalKey, setPendingToolRemovalKey] = useState<string | null>(null);

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

  useEffect(() => {
    return () => {
      if (removeIntentTimeoutRef.current !== null) {
        window.clearTimeout(removeIntentTimeoutRef.current);
      }
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

  const replaceTool = (nextTool: BuilderProfileTool) => {
    setTools((current) => sortTools([...current.filter((tool) => tool.id !== nextTool.id), nextTool]));
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

  const clearPendingToolRemoval = () => {
    if (removeIntentTimeoutRef.current !== null) {
      window.clearTimeout(removeIntentTimeoutRef.current);
      removeIntentTimeoutRef.current = null;
    }

    setPendingToolRemovalKey(null);
  };

  const requestToolRemoval = (removalKey: string) => {
    if (pendingToolRemovalKey === removalKey) {
      return;
    }

    if (removeIntentTimeoutRef.current !== null) {
      window.clearTimeout(removeIntentTimeoutRef.current);
    }

    setPendingToolRemovalKey(removalKey);
    removeIntentTimeoutRef.current = window.setTimeout(() => {
      setPendingToolRemovalKey(null);
      removeIntentTimeoutRef.current = null;
    }, 4000);
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
        clearPendingToolRemoval();
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
      clearPendingToolRemoval();
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

  const handleCustomSubmit = async (
    event: FormEvent<HTMLFormElement>,
    category: BuilderProfileCategory,
  ) => {
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
    const nextProficiency =
      requested === tool.proficiency ? getNextProficiency(tool.proficiency) : requested;
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

  const handleReorder = (category: BuilderProfileCategory, reordered: BuilderProfileTool[]) => {
    setTools((current) => {
      const otherTools = current.filter((t) => t.category !== category);
      return [...otherTools, ...reordered];
    });
  };

  return (
    <section id="builder-profile" className="surface-card pt-0 p-8 font-sans">
      <div className="sticky top-0 z-10 -mx-8 mb-6 flex items-start justify-between gap-4 border-b border-transparent bg-bg-surface/80 px-8 py-6 text-left transition-all duration-300 backdrop-blur-md group-data-[stuck]:border-border-default">
        <div>
          <h2 className="text-xl font-medium tracking-tight text-text-primary">Builder Profile</h2>
          <p className="mt-1 text-sm text-text-secondary">
            The more I know about your setup, the more specific every plan becomes.
          </p>
        </div>
      </div>

      <div className="flex flex-col overflow-hidden border border-border-default bg-bg-elevated/40 rounded-xl">
        {isLoading ? (
          <div className="p-8">
            <SectionSkeleton count={4} />
          </div>
        ) : toolCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border-default bg-bg-elevated/10 p-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-elevated text-text-tertiary">
              <Terminal className="h-7 w-7" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-text-primary">No coding tools added yet</h3>
            <p className="mb-5 max-w-xs text-sm leading-relaxed text-text-secondary">Build your profile by adding the tools you use every day.</p>
            
            <div className="mb-6 flex flex-wrap justify-center gap-2">
              {BUILDER_PROFILE_CATEGORIES.slice(0, 4).flatMap(cat => 
                cat.presets.slice(0, 2).map(preset => (
                  <button
                    key={`${cat.key}-${preset}`}
                    onClick={() => setExpandedCustomCategory(cat.key as BuilderProfileCategory)}
                    className="inline-flex items-center rounded-full border border-border-default bg-bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent-primary hover:text-accent-primary"
                  >
                    {preset}
                  </button>
                ))
              )}
            </div>

            <button
              onClick={() => {
                const firstCategory = BUILDER_PROFILE_CATEGORIES[0];
                if (firstCategory) {
                  setExpandedCustomCategory(firstCategory.key);
                }
              }}
              className="btn-secondary"
            >
              <Plus className="h-4 w-4" />
              Add your first tool
            </button>
          </div>
        ) : (
          BUILDER_PROFILE_CATEGORIES.map((category, idx) => {
            const selectedTools = toolsByCategory[category.key];
            const focusedToolName = reactionFocus[category.key];
            const reactionTool =
              selectedTools.find(
                (tool) =>
                  normalizeBuilderProfileName(tool.name) ===
                  normalizeBuilderProfileName(focusedToolName || ''),
              ) ||
              selectedTools[selectedTools.length - 1] ||
              null;
            const reaction = reactionTool
              ? getBuilderProfileReaction(reactionTool.name, category.key)
              : null;

            const Icon = (() => {
              switch (category.key) {
                case 'coding_environment':
                  return Terminal;
                case 'ai_assistants':
                  return Lightbulb;
                case 'frontend':
                  return Layout;
                case 'backend_hosting':
                  return Boxes;
                case 'database':
                  return Database;
                case 'auth':
                  return Shield;
                case 'payments':
                  return CreditCard;
                default:
                  return User;
              }
            })();

            return (
              <div key={category.key}>
                <div className="px-6 py-8 text-left">
                  <div className="mb-5 flex items-center justify-between gap-3 px-1">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border-default bg-bg-surface text-text-primary/50">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <h3 className="text-[12px] font-bold uppercase tracking-widest opacity-60 text-text-primary">
                        {category.label}
                      </h3>
                    </div>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-text-primary/20">
                      {selectedTools.length} saved
                    </span>
                  </div>

                  {/* Grid Layout with Grouping */}
                  <div className="space-y-8">
                    {/* Your Stack Section (if tools selected) */}
                    {selectedTools.length > 0 && (
                      <div className="space-y-3">
                        <div className="px-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-text-primary/40">
                          Your Stack (Drag to reorder)
                        </div>
                        <Reorder.Group
                          axis="x"
                          values={selectedTools}
                          onReorder={(next) => handleReorder(category.key, next)}
                          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
                        >
                          {selectedTools.map((tool) => {
                            const removalKey = `${category.key}:${normalizeBuilderProfileName(tool.name)}`;
                            const isPendingRemoval = pendingToolRemovalKey === removalKey;

                            return (
                              <Reorder.Item
                                key={tool.id}
                                value={tool}
                                className="drag-handle cursor-grab active:cursor-grabbing"
                              >
                                <ToolCard
                                  name={tool.name}
                                  isSelected={true}
                                  proficiency={tool.proficiency}
                                  isSaving={
                                    savingKey === `proficiency:${tool.id}` ||
                                    savingKey ===
                                      `toggle:${category.key}:${normalizeBuilderProfileName(tool.name)}`
                                  }
                                  isPendingRemoval={isPendingRemoval}
                                  onToggle={() => {
                                    if (isPendingRemoval) {
                                      void handleToggleTool(category.key, tool.name);
                                      return;
                                    }

                                    requestToolRemoval(removalKey);
                                  }}
                                  onConfirmRemoval={() => void handleToggleTool(category.key, tool.name)}
                                  onCancelRemoval={clearPendingToolRemoval}
                                  onProficiencyChange={(p) => void handleUpdateProficiency(tool, p)}
                                />
                              </Reorder.Item>
                            );
                          })}
                        </Reorder.Group>
                      </div>
                    )}

                    {/* Available/Presets Section */}
                    <div className="space-y-3">
                      {selectedTools.length > 0 && (
                        <div className="px-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-text-primary/40">
                          Available ecosystem
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {/* Presets that aren't selected yet */}
                        <AnimatePresence mode="popLayout">
                          {category.presets
                            .filter(
                              (preset) =>
                                !selectedTools.some(
                                  (t) =>
                                    normalizeBuilderProfileName(t.name) ===
                                    normalizeBuilderProfileName(preset),
                                ),
                            )
                            .map((preset) => (
                              <motion.div
                                key={preset}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                              >
                                <ToolCard
                                  name={preset}
                                  isSelected={false}
                                  isSaving={
                                    savingKey ===
                                    `toggle:${category.key}:${normalizeBuilderProfileName(preset)}`
                                  }
                                  onToggle={() => void handleToggleTool(category.key, preset)}
                                />
                              </motion.div>
                            ))}
                        </AnimatePresence>

                        {/* Add Custom Button */}
                        {!expandedCustomCategory && (
                          <button
                            type="button"
                            onClick={() => setExpandedCustomCategory(category.key)}
                            className="group flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-transparent px-4 transition-all hover:border-accent-primary hover:bg-accent-primary-muted/5 text-text-secondary hover:text-text-primary"
                          >
                            <Plus className="h-3.5 w-3.5 transition-colors group-hover:text-accent-primary" />
                            <span className="text-[13px] font-medium">Add tool</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {expandedCustomCategory === category.key ? (
                    <form
                      onSubmit={(event) => void handleCustomSubmit(event, category.key)}
                      className="mt-6 flex flex-col gap-3 border border-border-default bg-bg-surface p-4 sm:flex-row rounded-2xl"
                    >
                      <input
                        autoFocus
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
                          disabled={
                            savingKey ===
                            `custom:${category.key}:${normalizeBuilderProfileName(customInputs[category.key])}`
                          }
                          className="btn-primary h-10 px-5"
                        >
                          {savingKey ===
                          `custom:${category.key}:${normalizeBuilderProfileName(customInputs[category.key])}` ? (
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
                          className="btn-secondary h-10 px-4"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {reaction ? (
                    <div className="mt-8 border border-border-default/80 bg-bg-base/45 px-4 py-3 rounded-xl">
                      <p className="font-mono text-[10px] uppercase tracking-wider leading-5 text-text-primary/40">
                        {reaction}
                      </p>
                    </div>
                  ) : null}
                </div>
                {idx < BUILDER_PROFILE_CATEGORIES.length - 1 && (
                  <hr className="border-border-default" />
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
