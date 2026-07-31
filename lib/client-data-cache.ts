import type {
  CalendarDayBackground,
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

export type OipDataSnapshot = {
  events: CalendarEvent[];
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
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
  transaction.objectStore(SNAPSHOT_STORE).put({
    user,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    data,
  } satisfies CacheRow);
  await transactionComplete(transaction);
}

export async function clearOipDataCache() {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
  transaction.objectStore(SNAPSHOT_STORE).clear();
  await transactionComplete(transaction);
}
