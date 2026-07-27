export type UserCode = "daeho" | "sanghee";
export type Visibility = "shared" | "private";

export type CalendarEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at?: string | null;
  is_all_day: boolean;
  memo?: string | null;
  visibility: Visibility;
  author_id: UserCode | "system";
  event_type: "normal" | "anniversary" | "holiday";
  custom_color?: string | null;
};

export type PublicHoliday = {
  date: string;
  name: string;
  is_holiday: boolean;
  source: string;
  synced_at?: string;
};

export type DayOff = {
  id: string;
  date: string;
  owner_id: UserCode;
  day_off_type: string;
  half_day_period?: "am" | "pm" | null;
  memo?: string | null;
};

export type Todo = {
  id: string;
  title: string;
  memo?: string | null;
  due_at?: string | null;
  is_completed: boolean;
  completed_at?: string | null;
  visibility: Visibility;
  author_id: UserCode;
  created_at?: string;
};

export type ShoppingItem = {
  id: string;
  name: string;
  quantity: number;
  unit?: string | null;
  category: string;
  memo?: string | null;
  is_purchased: boolean;
  added_by: UserCode;
  purchased_by?: UserCode | null;
  purchased_at?: string | null;
  created_at?: string;
};

export type Trip = {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  memo?: string | null;
  author_id: UserCode;
};

export type TripFlight = {
  id: string;
  trip_id: string;
  direction: "가는 편" | "오는 편" | "기타";
  departure_city?: string | null;
  departure_airport?: string | null;
  departure_at?: string | null;
  arrival_city?: string | null;
  arrival_airport?: string | null;
  arrival_at?: string | null;
  airline?: string | null;
  flight_number?: string | null;
  reservation_number?: string | null;
  seat_info?: string | null;
  baggage_info?: string | null;
  price?: number | null;
  memo?: string | null;
};

export type TripAccommodation = {
  id: string;
  trip_id: string;
  name: string;
  address?: string | null;
  map_url?: string | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
  reservation_number?: string | null;
  price?: number | null;
  contact?: string | null;
  memo?: string | null;
};

export type TripTransportation = {
  id: string;
  trip_id: string;
  transport_type: string;
  title: string;
  departure_location?: string | null;
  departure_at?: string | null;
  arrival_location?: string | null;
  arrival_at?: string | null;
  reservation_info?: string | null;
  price?: number | null;
  link?: string | null;
  memo?: string | null;
};

export type TripFood = {
  id: string;
  trip_id: string;
  name: string;
  item_type: "음식" | "식당";
  location?: string | null;
  link?: string | null;
  price_range?: string | null;
  is_visited: boolean;
  memo?: string | null;
};

export type TripPlace = {
  id: string;
  trip_id: string;
  name: string;
  category: string;
  location?: string | null;
  link?: string | null;
  desired_date?: string | null;
  is_visited: boolean;
  memo?: string | null;
};

export type FridgeItem = {
  id: string;
  name: string;
  quantity: number;
  unit?: string | null;
  expiration_date: string;
  storage_type: string;
  category?: string | null;
  purchased_at?: string | null;
  memo?: string | null;
  author_id: UserCode;
  consumed_at?: string | null;
};

export type ParkingRecord = {
  id: string;
  floor: "B4" | "B5" | "B6";
  pillar_letter: "A" | "B" | "C" | "D";
  pillar_number: 1 | 2 | 3 | 4;
  author_id: UserCode;
  created_at: string;
};

export type RandomCandidate = {
  id: string;
  type: "destination" | "meal";
  name: string;
  category?: string | null;
  is_active: boolean;
  author_id: UserCode;
};
