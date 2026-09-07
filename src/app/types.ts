export type LocationStatus = "Đang dọn dẹp" | "Cần viện trợ" | "Hoàn thành" | "Sắp ra quân";

export interface CleanupLocation {
  id: number;
  title: string;
  status: LocationStatus;
  district: string;
  volunteers: number;
  trashCollected: string;
  updatedAt: string;
  coordinator: string;
  coords: { top: string; left: string };
  image: string;
  eventId?: string;
}

export interface CampaignEvent {
  id: string;
  locationId: number;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  capacity: number;
  status: string;
}

export interface VolunteerRegistration {
  id: string;
  eventId: string;
  fullName: string;
  phone: string;
  email: string;
  note: string;
  createdAt: string;
}

export interface PollutionReport {
  id: string;
  address: string;
  description: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
}

export interface BeforeAfterItem {
  id: number;
  locationId: number;
  location: string;
  date: string;
  trash: string;
  beforeImg: string;
  afterImg: string;
}
