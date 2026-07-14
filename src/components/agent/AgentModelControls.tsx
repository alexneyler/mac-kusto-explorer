import { useAgentStore } from "../../store/agentStore";

export function AgentModelControls() {
  const models = useAgentStore((state) => state.models);
  const configuredModel = useAgentStore((state) => state.model);
  const reasoningEffort = useAgentStore((state) => state.reasoningEffort);
  const sending = useAgentStore((state) => state.sending);
  const lifecycleBusy = useAgentStore((state) => state.lifecycleBusy);
  const setModel = useAgentStore((state) => state.setModel);
  const setReasoningEffort = useAgentStore(
    (state) => state.setReasoningEffort,
  );

  const modelId = configuredModel ?? models[0]?.id ?? "";
  const selectedModel = models.find((model) => model.id === modelId);
  if (!selectedModel) return null;

  const disabled = sending || lifecycleBusy;
  const defaultEffort = selectedModel.defaultReasoningEffort;
  const displayedEffort = reasoningEffort ?? defaultEffort ?? "";
  const supportedEfforts =
    defaultEffort &&
    !selectedModel.supportedReasoningEfforts.includes(defaultEffort)
      ? [defaultEffort, ...selectedModel.supportedReasoningEfforts]
      : selectedModel.supportedReasoningEfforts;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <select
        aria-label="Agent model"
        title={`Model: ${selectedModel.name}`}
        disabled={disabled}
        value={modelId}
        onChange={(event) => void setModel(event.target.value)}
        className="min-w-0 max-w-36 truncate rounded bg-transparent px-1.5 py-1 text-[11px] text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>

      {selectedModel.supportedReasoningEfforts.length > 0 && (
        <select
          aria-label="Agent thinking level"
          title="Thinking level"
          disabled={disabled}
          value={displayedEffort}
          onChange={(event) => {
            const effort = event.target.value;
            void setReasoningEffort(
              effort === defaultEffort || !effort ? null : effort,
            );
          }}
          className="min-w-0 max-w-24 truncate rounded bg-transparent px-1.5 py-1 text-[11px] text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
        >
          {!defaultEffort && <option value="">Default</option>}
          {supportedEfforts.map((effort) => (
            <option key={effort} value={effort}>
              {formatReasoningEffort(effort)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function formatReasoningEffort(effort: string): string {
  const labels: Record<string, string> = {
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
  };
  return labels[effort] ?? effort.replace(/(^|[_-])(\w)/g, (_, _separator, letter) =>
    letter.toUpperCase(),
  );
}
