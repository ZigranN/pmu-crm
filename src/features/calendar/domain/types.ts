export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday, 1=Monday, ..., 6=Saturday

export type CalendarExceptionType = "DAY_OFF" | "BLOCKED_TIME" | "STUDIO_CLOSURE";

export interface WorkingInterval {
  id?: string;
  weekday: number;
  startTime: string; // "HH:mm" e.g. "09:00"
  endTime: string;   // "HH:mm" e.g. "18:00"
  isActive?: boolean;
}

export interface CalendarException {
  id?: string;
  studioId?: string;
  masterId?: string | null; // null represents Studio-wide closure
  type: CalendarExceptionType;
  reason?: string | null;
  startAt: Date;
  endAt: Date;
}

export interface OccupiedInterval {
  id?: string;
  startAt: Date;
  endAt: Date;
  title?: string;
  source?: string;
  appointmentId?: string;
}

export interface TimeInterval {
  startAt: Date;
  endAt: Date;
}

export interface TimeSlot {
  startAt: Date;
  endAt: Date;
  localDate: string;      // "YYYY-MM-DD" in studio timezone
  localStartTime: string; // "HH:mm" in studio timezone
  localEndTime: string;   // "HH:mm" in studio timezone
}

export interface MasterDayAvailability {
  date: string;           // "YYYY-MM-DD"
  weekday: number;        // 0-6
  isWorkingDay: boolean;
  timezone: string;
  workingIntervals: TimeInterval[];
  blockedIntervals: TimeInterval[];
  occupiedIntervals: TimeInterval[];
  availableIntervals: TimeInterval[];
  availableSlots: TimeSlot[];
}

export interface CalendarResolutionInput {
  timezone: string;
  date: string; // "YYYY-MM-DD" in studio timezone
  workingHours: WorkingInterval[];
  exceptions?: CalendarException[];
  occupiedIntervals?: OccupiedInterval[];
  slotDurationMinutes?: number;
  slotStepMinutes?: number;
}

export interface CalendarRangeResolutionInput {
  timezone: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  workingHours: WorkingInterval[];
  exceptions?: CalendarException[];
  occupiedIntervals?: OccupiedInterval[];
  slotDurationMinutes?: number;
  slotStepMinutes?: number;
}
