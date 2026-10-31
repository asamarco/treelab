import { Field } from "@/lib/types";
import { getColumnMergeKey } from "@/components/tree/query-field/merge-templates";

/** Field names across templates, de-duplicated by Query's merge key. */
export function uniqueFieldOptions(fields: Field[]) {
  const seen = new Map<string, { value: string; label: string }>();
  for (const f of fields) {
    const key = getColumnMergeKey(f.name, f.type);
    if (!seen.has(key)) seen.set(key, { value: f.name, label: f.name });
  }
  return Array.from(seen.values());
}
