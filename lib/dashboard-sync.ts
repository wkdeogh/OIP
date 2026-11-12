export const DASHBOARD_RESOURCES = [
  "calendar_events",
  "calendar_days_off",
  "todos",
  "shopping_items",
  "trips",
  "travel_wishlist",
  "fridge_items",
  "parking_records",
] as const;

export type DashboardResource = (typeof DASHBOARD_RESOURCES)[number];
export type DashboardPayload = {
  records: Partial<Record<DashboardResource, unknown[]>>;
  failedResources: DashboardResource[];
};
export type DashboardSyncState = "connecting" | "live" | "delayed";
