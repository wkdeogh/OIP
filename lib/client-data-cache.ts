import type {
  CalendarDayBackground,
  CalendarColorDefaults,
  CalendarEvent,
  DayOff,
  FridgeItem,
  ParkingRecord,
  PublicHoliday,
  ShoppingItem,
  Todo,
  Trip,
  TripAccommodation,
  TripFlight,
  TripFood,
  TripPlace,
  TripTransportation,
  UserCode,
} from "@/app/oip-types";

const DATABASE_NAME = "oip-client-cache";
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = "user-snapshots";
const SNAPSHOT_SCHEMA_VERSION = 1;
const LOCAL_SNAPSHOT_PREFIX = "oip-client-snapshot-v1:";

export type OipDataSnapshot = {
  events: CalendarEvent[];
  calendarColorDefaults?: CalendarColorDefaults;
  daysOff: DayOff[];
  dayBackgrounds: CalendarDayBackground[];
  holidays: PublicHoliday[];
  todos: Todo[];
  shopping: ShoppingItem[];
  trips: Trip[];
  tripFlights: TripFlight[];
  tripAccommodations: TripAccommodation[];
  tripTransportations: TripTransportation[];
  tripFoods: TripFood[];
  tripPlaces: TripPlace[];
  fridge: FridgeItem[];
  parking: ParkingRecord | null;
};

export type CachedOipData = {
  savedAt: string;
  data: OipDataSnapshot;
};

type CacheRow = CachedOipData & {
  user: UserCode;
  schemaVersion: number;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("INDEXED_DB_UNAVAILABLE"));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "user" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("CACHE_OPEN_FAILED"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("CACHE_OPEN_BLOCKED"));
    };
  });

  return databasePromise;
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("CACHE_TRANSACTION_FAILED"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("CACHE_TRANSACTION_ABORTED"));
  });
}

function isCacheRow(value: unknown, user: UserCode): value is CacheRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CacheRow>;
  return (
    row.user === user &&
    row.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    typeof row.savedAt === "string" &&
    Boolean(row.data) &&
    typeof row.data === "object"
  );
}

function localSnapshotKey(user: UserCode) {
  return `${LOCAL_SNAPSHOT_PREFIX}${user}`;
}

export function readOipDataCacheSync(user: UserCode) {
  if (!("localStorage" in globalThis)) return null;
  try {
    const serialized = localStorage.getItem(localSnapshotKey(user));
    if (!serialized) return null;
    const result: unknown = JSON.parse(serialized);
    return isCacheRow(result, user)
      ? ({ savedAt: result.savedAt, data: result.data } satisfies CachedOipData)
      : null;
  } catch {
    return null;
  }
}

function writeOipDataCacheSync(row: CacheRow) {
  if (!("localStorage" in globalThis)) return;
  try {
    localStorage.setItem(localSnapshotKey(row.user), JSON.stringify(row));
  } catch {
    // IndexedDB remains the source of truth if the synchronous mirror is full.
  }
}

export async function readOipDataCache(user: UserCode) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
  const request = transaction.objectStore(SNAPSHOT_STORE).get(user);
  const result = await new Promise<unknown>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("CACHE_READ_FAILED"));
  });
  return isCacheRow(result, user)
    ? ({ savedAt: result.savedAt, data: result.data } satisfies CachedOipData)
    : null;
}

export async function writeOipDataCache(
  user: UserCode,
  data: OipDataSnapshot,
) {
  const row = {
    user,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    data,
  } satisfies CacheRow;
  writeOipDataCacheSync(row);
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
  transaction.objectStore(SNAPSHOT_STORE).put(row);
  await transactionComplete(transaction);
}

export async function clearOipDataCache() {
  if ("localStorage" in globalThis) {
    try {
      localStorage.removeItem(localSnapshotKey("daeho"));
      localStorage.removeItem(localSnapshotKey("sanghee"));
    } catch {}
  }
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
  transaction.objectStore(SNAPSHOT_STORE).clear();
  await transactionComplete(transaction);
}
