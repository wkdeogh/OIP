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
  calendar_day_backgrounds: {
    table: "calendar_day_backgrounds",
    fields: ["date", "background_color", "updated_by"],
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
      "country_code",
      "start_date",
      "end_date",
      "memo",
      "author_id",
    ],
    order: "start_date.asc",
  },
  trip_flights: {
    table: "trip_flights",
    fields: [
      "trip_id",
      "direction",
      "departure_city",
      "departure_airport",
      "departure_at",
      "arrival_city",
      "arrival_airport",
      "arrival_at",
      "airline",
      "flight_number",
      "reservation_number",
      "seat_info",
      "baggage_info",
      "price",
      "memo",
    ],
    order: "departure_at.asc.nullslast,created_at.asc",
  },
  trip_accommodations: {
    table: "trip_accommodations",
    fields: [
      "trip_id",
      "name",
      "address",
      "map_url",
      "check_in_at",
      "check_out_at",
      "reservation_number",
      "price",
      "contact",
      "memo",
    ],
    order: "check_in_at.asc.nullslast,created_at.asc",
  },
  trip_transportations: {
    table: "trip_transportations",
    fields: [
      "trip_id",
      "transport_type",
      "title",
      "departure_location",
      "departure_at",
      "arrival_location",
      "arrival_at",
      "reservation_info",
      "price",
      "link",
      "memo",
    ],
    order: "departure_at.asc.nullslast,created_at.asc",
  },
  trip_foods: {
    table: "trip_foods",
    fields: [
      "trip_id",
      "name",
      "item_type",
      "location",
      "link",
      "price_range",
      "is_visited",
      "memo",
    ],
    order: "is_visited.asc,created_at.asc",
  },
  trip_places: {
    table: "trip_places",
    fields: [
      "trip_id",
      "name",
      "category",
      "location",
      "link",
      "desired_date",
      "is_visited",
      "memo",
    ],
    order: "is_visited.asc,desired_date.asc.nullslast,created_at.asc",
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
} as const satisfies Record<string, ResourceConfig>;

export type ResourceName = keyof typeof resourceConfigs;
export type InternalTableName =
  | ResourceName
  | "push_subscriptions"
  | "push_delivery_log";

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
  return supabaseTableRest(resourceConfigs[resource].table, search, init);
}

export async function supabaseTableRest(
  table: InternalTableName,
  search: URLSearchParams,
  init?: RequestInit,
) {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }

  const url = new URL(`${baseUrl}/rest/v1/${table}`);
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
