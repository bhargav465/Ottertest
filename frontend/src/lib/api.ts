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
  folder?: string;
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
  speakerNames?: Record<string, string>;
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
  folder?: string;
}): Promise<UploadTicket> {
  return request<UploadTicket>("/uploads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Update a meeting's folder, title, and/or speaker names. `folder: ""` unfiles. */
export async function updateMeeting(
  meetingId: string,
  input: {
    folder?: string;
    title?: string;
    speakerNames?: Record<string, string>;
  }
): Promise<Meeting> {
  const data = await request<{ meeting: Meeting }>(`/meetings/${meetingId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.meeting;
}

/**
 * PUT the recorded blob straight to S3 via the presigned URL, retrying a few
 * times on transient network / 5xx errors (mobile connections drop often).
 */
export async function uploadAudio(
  ticket: UploadTicket,
  blob: Blob,
  attempts = 3
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": ticket.contentType },
        body: blob,
      });
      if (res.ok) return;
      // 4xx (other than throttling) won't succeed on retry — fail fast.
      if (res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new Error(`Upload failed: ${res.status}`);
      }
      lastErr = new Error(`Upload failed: ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 600 * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Upload failed");
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
