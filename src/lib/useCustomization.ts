import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { resolveConfiguration } from "./customization";
import { configurationRevision } from "./customizationStore";
export function useCustomization(userId: string, date: string) {
  const changes = useLiveQuery(
    () => db.configurations.where("userId").equals(userId).toArray(),
    [userId],
  );
  return {
    configuration: resolveConfiguration(userId, date, changes ?? []),
    changes: changes ?? [],
    revision: configurationRevision(changes ?? []),
    ready: changes !== undefined,
  };
}
