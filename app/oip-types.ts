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

export type FridgeItem = {
  id: string;
  name: string;
  quantity: number;
  unit?: string | null;
  expiration_date: string;
  storage_type: string;
  category?: string | null;
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
