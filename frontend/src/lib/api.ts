import { config } from "./config";
import { getCurrentUser } from "./auth";

export interface ActionItem {
  task: string;
  owner: string;
  mine: boolean;
  due?: string;
}

export interface MeetingSummary {
  tldr: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
}

export type MeetingStatus =
  | "UPLOADING"
  | "TRANSCRIBING"
  | "SUMMARIZING"
  | "DONE"
  | "FAILED";

export interface MeetingListItem {
  meetingId: string;
  title: string;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
  durationSeconds?: number;
  tldr?: string;
  actionItemCount: number;
  myActionItemCount: number;
}

export interface Meeting extends MeetingListItem {
  audioKey: string;
  transcript?: string;
  summary?: MeetingSummary;
  error?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  return {
    Authorization: `Bearer ${user.idToken}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface UploadTicket {
  meetingId: string;
  uploadUrl: string;
  audioKey: string;
  contentType: string;
}

export function createUpload(input: {
  title?: string;
  contentType: string;
  durationSeconds?: number;
}): Promise<UploadTicket> {
  return request<UploadTicket>("/uploads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PUT the recorded blob straight to S3 via the presigned URL. */
export async function uploadAudio(
  ticket: UploadTicket,
  blob: Blob
): Promise<void> {
  const res = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": ticket.contentType },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const data = await request<{ meetings: MeetingListItem[] }>("/meetings");
  return data.meetings;
}

export async function getMeeting(meetingId: string): Promise<Meeting> {
  const data = await request<{ meeting: Meeting }>(`/meetings/${meetingId}`);
  return data.meeting;
}

export function deleteMeeting(meetingId: string): Promise<void> {
  return request<void>(`/meetings/${meetingId}`, { method: "DELETE" });
}
