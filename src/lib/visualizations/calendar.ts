import { addDays, format, isValid, parse, parseISO, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { CalendarFieldValue, Field, Template, TreeNode } from "@/lib/types";
import { findFieldByName, getCardFields } from "@/lib/visualizations/shared";

export type CalendarBoardConfig = Pick<
    Required<CalendarFieldValue>,
    "dateFieldName" | "cardFieldNames" | "defaultView" | "weekStartsOn"
>;

export interface CalendarIssue {
    nodeId: string;
    reason: "missing-date-field";
}

export interface CalendarEvents {
    eventsByDay: Map<string, TreeNode[]>;
    unscheduled: TreeNode[];
    issues: CalendarIssue[];
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Reads a stored date the same way formatDate does, then keeps only the local calendar day. */
export function parseDateFieldValue(value: unknown): Date | null {
    if (typeof value !== "string" || value === "") return null;
    const parsed = DATE_ONLY_PATTERN.test(value)
        ? parse(value, "yyyy-MM-dd", new Date())
        : parseISO(value);
    return isValid(parsed) ? startOfDay(parsed) : null;
}

/** Writes a day exactly as the node editors do: the UTC instant of local midnight. */
export function dateToFieldValue(day: Date): string {
    return startOfDay(day).toISOString();
}

/** Bucket key for a local calendar day. Not written to nodes. */
export function dayKey(date: Date): string {
    return format(date, "yyyy-MM-dd");
}

export function dayFromKey(key: string): Date | null {
    const parsed = parse(key, "yyyy-MM-dd", new Date());
    return isValid(parsed) ? parsed : null;
}

/** Six weeks of seven days, so the grid height never changes between months. */
export function buildMonthGrid(visibleMonth: Date, weekStartsOn: 0 | 1): Date[][] {
    const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn });
    return Array.from({ length: 6 }, (_, week) =>
        Array.from({ length: 7 }, (_, dayOfWeek) => addDays(gridStart, week * 7 + dayOfWeek)),
    );
}

export function findCalendarDateField(template: Template | undefined, dateFieldName: string): Field | undefined {
    return findFieldByName(template, dateFieldName, "date");
}

export function getCalendarCardFields(template: Template | undefined, config: CalendarBoardConfig): Field[] {
    const dateField = findCalendarDateField(template, config.dateFieldName);
    return getCardFields(template, config.cardFieldNames, dateField ? [dateField.id] : []);
}

const byName = (a: TreeNode, b: TreeNode) =>
    String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" });

export function buildCalendarEvents(
    nodes: TreeNode[],
    templates: Template[],
    config: CalendarBoardConfig,
): CalendarEvents {
    const templateById = new Map(templates.map(t => [t.id, t]));
    const eventsByDay = new Map<string, TreeNode[]>();
    const unscheduled: TreeNode[] = [];
    const issues: CalendarIssue[] = [];

    for (const node of nodes) {
        const field = findCalendarDateField(templateById.get(node.templateId), config.dateFieldName);
        if (!field) {
            issues.push({ nodeId: node.id, reason: "missing-date-field" });
            continue;
        }
        const day = parseDateFieldValue(node.data?.[field.id]);
        if (!day) {
            unscheduled.push(node);
            continue;
        }
        const key = dayKey(day);
        const dayNodes = eventsByDay.get(key);
        if (dayNodes) dayNodes.push(node);
        else eventsByDay.set(key, [node]);
    }

    for (const dayNodes of eventsByDay.values()) dayNodes.sort(byName);
    unscheduled.sort(byName);
    return { eventsByDay, unscheduled, issues };
}

/** Days of the visible month that have events, in date order, for the agenda view. */
export function getAgendaDays(
    eventsByDay: Map<string, TreeNode[]>,
    visibleMonth: Date,
): { key: string; day: Date; events: TreeNode[] }[] {
    const monthPrefix = format(visibleMonth, "yyyy-MM");
    return Array.from(eventsByDay.keys())
        .filter(key => key.startsWith(monthPrefix))
        .sort()
        .flatMap(key => {
            const day = dayFromKey(key);
            const events = eventsByDay.get(key);
            return day && events ? [{ key, day, events }] : [];
        });
}

/**
 * Returns the data patch that moves a node to the target day, or null when nothing should
 * change. A null target clears the date.
 */
export function applyCalendarMove(
    node: TreeNode,
    template: Template | undefined,
    config: CalendarBoardConfig,
    targetDayKey: string | null,
): Record<string, string> | null {
    const field = findCalendarDateField(template, config.dateFieldName);
    if (!field) return null;

    const current = parseDateFieldValue(node.data?.[field.id]);
    const currentKey = current ? dayKey(current) : null;
    if (currentKey === targetDayKey) return null;

    if (targetDayKey === null) return { [field.id]: "" };
    const day = dayFromKey(targetDayKey);
    if (!day) return null;
    return { [field.id]: dateToFieldValue(day) };
}
