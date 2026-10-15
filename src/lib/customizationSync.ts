import { db } from "./db";
import { supabase } from "./supabase";
import type { Json, Tables } from "./database.types";
import type {
  ConfigChange,
  ConfigurationPatch,
  CustomAnswerRecord,
  ItemAnswer,
} from "./customizationTypes";
import type { PendingOperation } from "./model";
import { mergeAnswer } from "./customizationStore";
import { mergeTaskSelections } from "./taskDaily";

export type WireCustomAnswer = Tables<"custom_answers">;
export const customAnswerFromWire = (
  row: WireCustomAnswer,
): CustomAnswerRecord => ({
  userId: row.user_id,
  logicalDate: row.logical_date,
  itemId: row.item_id,
  generation: row.generation,
  value: row.value as unknown as ItemAnswer,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const changeFromWire = (row: Tables<"config_changes">): ConfigChange => ({
  id: row.operation_id,
  operationId: row.operation_id,
  userId: row.user_id,
  effectiveDate: row.effective_date,
  sequence: row.sequence,
  baseRevision: row.base_revision,
  patch: row.patch as unknown as ConfigurationPatch,
  createdAt: row.created_at,
  revision: row.sequence,
});
export async function reconcileCustomAnswer(
  row: WireCustomAnswer,
  pending?: PendingOperation[],
) {
  const record = customAnswerFromWire(row);
  const queue =
    pending ??
    (await db.outbox.where("userId").equals(record.userId).sortBy("id"));
  for (const op of queue) {
    if (op.logicalDate !== record.logicalDate) continue;
    if (
      op.kind === "custom-answer" &&
      op.customAnswer?.itemId === record.itemId &&
      op.customAnswer.generation === record.generation
    )
      record.value = mergeAnswer(record.value, op.customAnswer.patch);
    const link = op.taskCommand?.checklistLink;
    if (
      op.kind === "task" &&
      link?.itemId === record.itemId &&
      link.generation === record.generation &&
      op.customTaskChange
    ) {
      const before = record.value.selections;
      const change = op.customTaskChange;
      const selections = mergeTaskSelections(
        before,
        { topic: "school", ...change },
        op.operationId,
      );
      if (
        change.completed ||
        JSON.stringify(selections) !== JSON.stringify(before)
      )
        record.value = {
          ...record.value,
          selections,
          value: change.completed || selections.length ? true : null,
        };
    }
  }
  await db.customAnswers.put(record);
}
export async function pushCustomization(op: PendingOperation) {
  if (op.kind === "configuration") {
    const change = op.configurationChange!;
    const { data, error } = await supabase.rpc(
      "apply_customization_operation",
      {
        p_operation_id: op.operationId,
        p_effective_date: change.effectiveDate,
        p_base_revision: change.baseRevision,
        p_patch: change.patch as unknown as Json,
      },
    );
    if (error) {
      if (error.code === "40001") {
        const queued = await db.outbox
          .where("userId")
          .equals(op.userId)
          .sortBy("id");
        const combined: ConfigurationPatch = {};
        for (const operation of queued.filter(
          (value) => value.kind === "configuration",
        )) {
          const draft = operation.configurationChange!;
          for (const key of ["blocks", "items", "lists"] as const) {
            const map = new Map(
              (combined[key] ?? []).map((entity) => [entity.id, entity]),
            );
            for (const entity of draft.patch[key] ?? [])
              map.set(entity.id, { ...map.get(entity.id), ...entity });
            Object.assign(combined, { [key]: [...map.values()] });
          }
          const local = await db.configurations.get(operation.operationId);
          if (local)
            await db.configurations.put({ ...local, conflict: error.message });
        }
        await db.meta.put({
          key: `customization-conflict:${op.userId}`,
          value: JSON.stringify({
            operationId: op.operationId,
            message: error.message,
            patch: combined,
          }),
        });
        // Refresh server state for explicit review without discarding the queued draft.
        await pullCustomization(op.userId);
      }
      throw error;
    }
    const result = data as unknown as {
      change: Tables<"config_changes">;
      revision: number;
    };
    await db.transaction("rw", db.configurations, db.outbox, async () => {
      await db.configurations.put(changeFromWire(result.change));
      await db.outbox.delete(op.id!);
    });
  } else {
    const answer = op.customAnswer!;
    const { data, error } = await supabase.rpc(
      "apply_custom_answer_operation",
      {
        p_operation_id: op.operationId,
        p_logical_date: op.logicalDate,
        p_item_id: answer.itemId,
        p_generation: answer.generation,
        p_patch: answer.patch as unknown as Json,
      },
    );
    if (error) throw error;
    await db.transaction("rw", db.customAnswers, db.outbox, async () => {
      await db.outbox.delete(op.id!);
      await reconcileCustomAnswer(data as unknown as WireCustomAnswer);
    });
  }
}
export async function pullCustomization(userId: string) {
  const changes: Tables<"config_changes">[] = [],
    answers: WireCustomAnswer[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from("config_changes")
      .select("*")
      .eq("user_id", userId)
      .order("sequence")
      .range(offset, offset + 499);
    if (error) throw error;
    changes.push(...data);
    if (data.length < 500) break;
  }
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from("custom_answers")
      .select("*")
      .eq("user_id", userId)
      .order("logical_date")
      .order("item_id")
      .order("generation")
      .range(offset, offset + 499);
    if (error) throw error;
    answers.push(...data);
    if (data.length < 500) break;
  }
  await db.transaction(
    "rw",
    db.configurations,
    db.customAnswers,
    db.outbox,
    async () => {
      // Put immutable remote rows by operation identity; local pending revisions remain overlays.
      for (const change of changes)
        await db.configurations.put(changeFromWire(change));
      for (const answer of answers) await reconcileCustomAnswer(answer);
    },
  );
}
