export type MeetingStatus =
  | "UPLOADING"
  | "TRANSCRIBING"
  | "SUMMARIZING"
  | "DONE"
  | "FAILED";

export interface ActionItem {
  /** The task to be done. */
  task: string;
  /** Who owns it, e.g. "You", a name, or "Unassigned". */
  owner: string;
  /** True when the item is assigned to the meeting owner ("your" actionables). */
  mine: boolean;
  /** Optional due date if one was mentioned. */
  due?: string;
}

export interface MeetingSummary {
  /** One or two sentence TL;DR. */
  tldr: string;
  /** Bullet-point key discussion points. */
  keyPoints: string[];
  /** Decisions made during the meeting. */
  decisions: string[];
  /** Extracted action items. */
  actionItems: ActionItem[];
}

export interface Meeting {
  userId: string;
  meetingId: string;
  /** Owner's email, used to attribute first-person action items. */
  ownerEmail?: string;
  title: string;
  /** True until the owner has renamed the meeting; lets us auto-title it. */
  autoTitle?: boolean;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
  durationSeconds?: number;
  audioKey: string;
  transcriptKey?: string;
  transcriptJobName?: string;
  /** Plain-text transcript once available. */
  transcript?: string;
  summary?: MeetingSummary;
  error?: string;
}
