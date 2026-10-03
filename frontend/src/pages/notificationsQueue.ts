export interface QueueNotice {
  id: string;
  title: string;
  content: string;
  durationMs: number;
}

export interface NoticeQueueState {
  active: QueueNotice | null;
  queue: QueueNotice[];
}

export const enqueueNotice = (
  state: NoticeQueueState,
  notice: QueueNotice,
): NoticeQueueState => {
  if (!state.active) {
    return { active: notice, queue: [] };
  }
  return { active: state.active, queue: [...state.queue, notice] };
};

export const closeActiveNotice = (
  state: NoticeQueueState,
): NoticeQueueState => {
  if (state.queue.length === 0) {
    return { active: null, queue: [] };
  }
  const [next, ...rest] = state.queue;
  return { active: next, queue: rest };
};
