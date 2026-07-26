type ResourceConfig = {
  table: string;
  fields: readonly string[];
  order?: string;
};

export const resourceConfigs = {
  calendar_events: {
    table: "calendar_events",
    fields: [
      "title",
      "start_at",
      "end_at",
      "is_all_day",
      "memo",
      "visibility",
      "author_id",
      "event_type",
      "color_mode",
      "custom_color",
      "recurrence_rule",
    ],
    order: "start_at.asc",
  },
  calendar_days_off: {
    table: "calendar_days_off",
    fields: [
      "date",
      "owner_id",
      "day_off_type",
      "half_day_period",
      "memo",
    ],
    order: "date.asc",
  },
  public_holidays: {
    table: "public_holidays",
    fields: ["date", "name", "is_holiday", "source", "synced_at"],
    order: "date.asc",
  },
  todos: {
    table: "todos",
    fields: [
      "title",
      "memo",
      "due_at",
      "is_completed",
      "completed_at",
      "visibility",
      "author_id",
    ],
    order: "is_completed.asc,due_at.asc.nullslast,created_at.desc",
  },
  shopping_items: {
    table: "shopping_items",
    fields: [
      "name",
      "quantity",
      "unit",
      "category",
      "memo",
      "is_purchased",
      "added_by",
      "purchased_by",
      "purchased_at",
    ],
    order: "is_purchased.asc,created_at.desc",
  },
  trips: {
    table: "trips",
    fields: [
      "title",
      "destination",
      "start_date",
      "end_date",
      "memo",
      "author_id",
    ],
    order: "start_date.asc",
  },
  fridge_items: {
    table: "fridge_items",
    fields: [
      "name",
      "quantity",
      "unit",
      "expiration_date",
      "storage_type",
      "category",
      "purchased_at",
      "memo",
      "author_id",
      "consumed_at",
    ],
    order: "expiration_date.asc,created_at.desc",
  },
  parking_records: {
    table: "parking_records",
    fields: [
      "floor",
      "pillar_letter",
      "pillar_number",
      "author_id",
      "memo",
    ],
    order: "created_at.desc",
  },
  random_candidates: {
    table: "random_candidates",
    fields: [
      "type",
      "name",
      "category",
      "is_active",
      "memo",
      "author_id",
    ],
    order: "created_at.desc",
  },
} as const satisfies Record<string, ResourceConfig>;

export type ResourceName = keyof typeof resourceConfigs;

export function isResourceName(value: string): value is ResourceName {
  return value in resourceConfigs;
}

export function pickAllowedFields(
  resource: ResourceName,
  input: Record<string, unknown>,
) {
  const allowed =
    resource === "public_holidays"
      ? resourceConfigs[resource].fields
      : (["id", ...resourceConfigs[resource].fields] as readonly string[]);
  return Object.fromEntries(
    Object.entries(input).filter(([key]) =>
      (allowed as readonly string[]).includes(key),
    ),
  );
}

export async function supabaseRest(
  resource: ResourceName,
  search: URLSearchParams,
  init?: RequestInit,
) {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }

  const config = resourceConfigs[resource];
  const url = new URL(`${baseUrl}/rest/v1/${config.table}`);
  search.forEach((value, key) => url.searchParams.set(key, value));

  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers ?? {}),
    },
  });
}
