import type {
  HandoffEntityType,
  HandoffPriority,
  HandoffSourceType,
  HandoffStatus,
} from "@/db/schema";

export type {
  HandoffEntityType,
  HandoffPriority,
  HandoffSourceType,
  HandoffStatus,
};

export interface HandoffRecord {
  id: string;
  studioId: string;
  entityType: HandoffEntityType;
  entityId: string;
  clientId: string | null;
  cycleId: string | null;
  conversationId: string | null;
  appointmentId: string | null;
  fromUserId: string | null;
  toUserId: string;
  sourceType: HandoffSourceType;
  reasonCode: string;
  reasonText: string | null;
  status: HandoffStatus;
  priority: HandoffPriority;
  dueAt: Date | null;
  requestKey: string | null;
  metadata: Record<string, unknown> | null;
  createdById: string;
  createdAt: Date;
  acceptedAt: Date | null;
  acceptedById: string | null;
  rejectedAt: Date | null;
  rejectedById: string | null;
  rejectionReason: string | null;
  completedAt: Date | null;
  completedById: string | null;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  updatedAt: Date;
}

export interface HandoffQueueItem extends HandoffRecord {
  clientName?: string | null;
  clientPhone?: string | null;
  fromUserName?: string | null;
  toUserName?: string | null;
  createdByName?: string | null;
  acceptedByName?: string | null;
  isOverdue?: boolean;
}

export interface HandoffFilters {
  assignedToMe?: boolean;
  createdByMe?: boolean;
  status?: HandoffStatus;
  priority?: HandoffPriority;
  overdueOnly?: boolean;
  entityType?: HandoffEntityType;
  clientId?: string;
  toUserId?: string;
  search?: string;
}

export interface HandoffSummaryCounts {
  pendingToMe: number;
  acceptedByMe: number;
  createdByMe: number;
  overdue: number;
  totalPending: number;
  totalCompleted: number;
}
