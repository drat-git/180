import catalog from "./starterCatalog.json" with { type: "json" };
import type { Configuration } from "./customizationTypes";
import type { AntiItemType } from "./model";

export interface StarterTemplate {
  id: string;
  version: number;
  title: string;
  description: string;
  configuration: Configuration;
  tasks: { id: string; listId: string; title: string }[];
  activities: { id: string; title: string; itemType: AntiItemType }[];
}
export interface OnboardingSelection {
  operationId: string;
  starterId: string;
  version: number;
  items: string[];
  lists: string[];
  tasks: string[];
  activities: string[];
}
export const starterTemplates = catalog as StarterTemplate[];
export function starterSelection(
  template: StarterTemplate,
  operationId = crypto.randomUUID(),
): OnboardingSelection {
  return {
    operationId,
    starterId: template.id,
    version: template.version,
    items: template.configuration.items.map((item) => item.id),
    lists: template.configuration.lists.map((list) => list.id),
    tasks: template.tasks.map((task) => task.id),
    activities: template.activities.map((activity) => activity.id),
  };
}
export function selectStarterList(
  template: StarterTemplate,
  selection: OnboardingSelection,
  listId: string,
  enabled: boolean,
): OnboardingSelection {
  return {
    ...selection,
    lists: enabled
      ? [...new Set([...selection.lists, listId])]
      : selection.lists.filter((id) => id !== listId),
    items: enabled
      ? selection.items
      : selection.items.filter(
          (id) =>
            !template.configuration.items.some(
              (item) => item.id === id && item.listId === listId,
            ),
        ),
    tasks: enabled
      ? selection.tasks
      : selection.tasks.filter(
          (id) =>
            !template.tasks.some(
              (task) => task.id === id && task.listId === listId,
            ),
        ),
  };
}
export function selectedStarterConfiguration(
  template: StarterTemplate,
  selection: OnboardingSelection,
): Configuration {
  const lists = template.configuration.lists.filter((list) =>
    selection.lists.includes(list.id),
  );
  const items = template.configuration.items.filter(
    (item) =>
      selection.items.includes(item.id) &&
      (!item.listId || selection.lists.includes(item.listId)),
  );
  return structuredClone({
    lists,
    items,
    blocks: template.configuration.blocks.filter((block) =>
      items.some((item) => item.blockId === block.id),
    ),
  });
}
