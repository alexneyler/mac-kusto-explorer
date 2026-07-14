import type { Connection, QueryTab } from "../../types/kusto";
import type {
  AgentContextEntry,
  AgentContextTarget,
  SchemaEntityKind,
} from "../../types/agent";

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function contextKey(target: AgentContextTarget): string {
  const cluster = `cluster:${segment(target.clusterId)}`;
  if (target.scope === "cluster") return cluster;
  const database = `${cluster}/database:${segment(target.database ?? "")}`;
  if (target.scope === "database") return database;
  return `${database}/${target.entityKind ?? "table"}:${segment(
    target.entityName ?? "",
  )}`;
}

export function findContext(
  entries: AgentContextEntry[],
  target: AgentContextTarget,
): AgentContextEntry | undefined {
  const key = contextKey(target);
  return entries.find((entry) => entry.key === key);
}

export function inheritedContext(
  entries: AgentContextEntry[],
  target: AgentContextTarget,
): AgentContextEntry[] {
  const chain: AgentContextTarget[] = [
    {
      scope: "cluster",
      clusterId: target.clusterId,
      clusterName: target.clusterName,
    },
  ];
  if (target.database) {
    chain.push({
      scope: "database",
      clusterId: target.clusterId,
      clusterName: target.clusterName,
      database: target.database,
    });
  }
  if (
    target.scope === "table" &&
    target.database &&
    target.entityKind &&
    target.entityName
  ) {
    chain.push(target);
  }
  return chain
    .map((item) => findContext(entries, item))
    .filter((entry): entry is AgentContextEntry => Boolean(entry?.content.trim()));
}

export function formatEffectiveContext(entries: AgentContextEntry[]): string {
  if (entries.length === 0) return "No personal context attached.";
  return entries
    .map((entry) => {
      const label =
        entry.scope === "cluster"
          ? `Cluster ${entry.clusterName}`
          : entry.scope === "database"
            ? `Database ${entry.database}`
            : `${entityKindLabel(entry.entityKind)} ${entry.entityName}`;
      return `## ${label}\n${entry.content.trim()}`;
    })
    .join("\n\n");
}

export function buildInitialAgentContext(args: {
  tab: QueryTab;
  connection: Connection | null;
  entries: AgentContextEntry[];
}): string {
  const { tab, connection, entries } = args;
  const target =
    connection && tab.database
      ? ({
          scope: "database",
          clusterId: connection.id,
          clusterName: connection.name,
          database: tab.database,
        } satisfies AgentContextTarget)
      : connection
        ? ({
            scope: "cluster",
            clusterId: connection.id,
            clusterName: connection.name,
          } satisfies AgentContextTarget)
        : null;
  const personal = target ? inheritedContext(entries, target) : [];

  return [
    "# Focused query tab",
    `Title: ${tab.title}`,
    `Cluster: ${connection?.name ?? "none"}`,
    `Database: ${tab.database ?? "none"}`,
    "",
    "```kusto",
    tab.query,
    "```",
    "",
    "# Personal context",
    formatEffectiveContext(personal),
  ].join("\n");
}

export function entityKindLabel(kind?: SchemaEntityKind): string {
  switch (kind) {
    case "materializedView":
      return "Materialized view";
    case "externalTable":
      return "External table";
    default:
      return "Table";
  }
}
