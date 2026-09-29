import Dexie, { type Table } from 'dexie';
import { Lecture, LectureProcessingChunk, ChunkStatus, SlideAlignment } from './types';

export class OmniLectureDatabase extends Dexie {
  lectures!: Table<Lecture, string>;
  processingChunks!: Table<LectureProcessingChunk, string>;

  constructor() {
    super('OmniLectureDB');
    this.version(1).stores({
      lectures: 'id, title, course, date, status, createdAt, updatedAt',
    });
    this.version(2).stores({
      lectures: 'id, title, course, date, status, createdAt, updatedAt',
      processingChunks: 'id, lectureId, status, index',
    });
  }
}

export const db = new OmniLectureDatabase();

// Helper database operations
export async function saveLecture(lecture: Lecture): Promise<void> {
  await db.lectures.put(lecture);
}

export async function getLectureById(id: string): Promise<Lecture | undefined> {
  return await db.lectures.get(id);
}

export async function getAllLectures(): Promise<Lecture[]> {
  return await db.lectures.orderBy('createdAt').reverse().toArray();
}

export async function deleteLectureById(id: string): Promise<void> {
  await db.lectures.delete(id);
  await db.processingChunks.where('lectureId').equals(id).delete();
}

export async function updateLectureStatus(
  id: string,
  status: Lecture['status'],
  errorMessage?: string,
  processingProgress?: string,
  processingPercentage?: number
): Promise<void> {
  await db.lectures.update(id, {
    status,
    errorMessage,
    processingProgress,
    processingPercentage,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateLectureProgress(
  id: string,
  processingPercentage: number,
  processingProgress: string,
  processingChunks?: LectureProcessingChunk[]
): Promise<void> {
  await db.lectures.update(id, {
    processingPercentage,
    processingProgress,
    processingChunks,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateLectureData(id: string, data: Lecture['data']): Promise<void> {
  await db.lectures.update(id, {
    data,
    status: 'completed',
    processingProgress: undefined,
    processingPercentage: 100,
    errorMessage: undefined,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateLectureSlides(
  id: string,
  slidesFileName: string,
  slidesMarkdown: string,
  updatedData: Lecture['data'],
  slidesAlignment?: SlideAlignment[]
): Promise<void> {
  const alignment = slidesAlignment || updatedData?.slides_alignment;
  await db.lectures.update(id, {
    slidesFileName,
    slidesMarkdown,
    slidesAlignment: alignment,
    hasSlides: true,
    data: updatedData,
    updatedAt: new Date().toISOString(),
  });
}

export async function appendChatMessage(id: string, message: Lecture['chatMessages'][0]): Promise<void> {
  const lecture = await db.lectures.get(id);
  if (lecture) {
    const updatedMessages = [...(lecture.chatMessages || []), message];
    await db.lectures.update(id, {
      chatMessages: updatedMessages,
      updatedAt: new Date().toISOString(),
    });
  }
}

// Processing Chunks Operations
export async function saveProcessingChunks(chunks: LectureProcessingChunk[]): Promise<void> {
  await db.processingChunks.bulkPut(chunks);
}

export async function getProcessingChunks(lectureId: string): Promise<LectureProcessingChunk[]> {
  return await db.processingChunks.where('lectureId').equals(lectureId).sortBy('index');
}

export async function updateProcessingChunkStatus(
  id: string,
  status: ChunkStatus,
  errorMessage?: string,
  data?: Partial<Lecture['data']>
): Promise<void> {
  await db.processingChunks.update(id, {
    status,
    errorMessage,
    data,
    updatedAt: new Date().toISOString(),
  });
}

// Bookmarks Operations
export function sortLectureBookmarks(
  bookmarks: NonNullable<Lecture['bookmarks']>
): NonNullable<Lecture['bookmarks']> {
  return [...bookmarks].sort((a, b) => {
    const partDiff = (a.partIndex ?? 0) - (b.partIndex ?? 0);
    if (partDiff !== 0) return partDiff;
    return a.timestampSeconds - b.timestampSeconds;
  });
}

export async function addLectureBookmark(
  id: string,
  bookmark: NonNullable<Lecture['bookmarks']>[0]
): Promise<void> {
  const lecture = await db.lectures.get(id);
  if (lecture) {
    const updatedBookmarks = sortLectureBookmarks([...(lecture.bookmarks || []), bookmark]);
    const updatedData = lecture.data ? { ...lecture.data, bookmarks: updatedBookmarks } : lecture.data;
    await db.lectures.update(id, {
      bookmarks: updatedBookmarks,
      data: updatedData,
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function removeLectureBookmark(id: string, bookmarkId: string): Promise<void> {
  const lecture = await db.lectures.get(id);
  if (lecture) {
    const updatedBookmarks = (lecture.bookmarks || []).filter((b) => b.id !== bookmarkId);
    const updatedData = lecture.data ? { ...lecture.data, bookmarks: updatedBookmarks } : lecture.data;
    await db.lectures.update(id, {
      bookmarks: updatedBookmarks,
      data: updatedData,
      updatedAt: new Date().toISOString(),
    });
  }
}
