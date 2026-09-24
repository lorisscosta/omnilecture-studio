import Dexie, { type Table } from 'dexie';
import { Lecture } from './types';

export class OmniLectureDatabase extends Dexie {
  lectures!: Table<Lecture, string>;

  constructor() {
    super('OmniLectureDB');
    this.version(1).stores({
      lectures: 'id, title, course, date, status, createdAt, updatedAt',
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
}

export async function updateLectureStatus(
  id: string,
  status: Lecture['status'],
  errorMessage?: string,
  processingProgress?: string
): Promise<void> {
  await db.lectures.update(id, {
    status,
    errorMessage,
    processingProgress,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateLectureData(id: string, data: Lecture['data']): Promise<void> {
  await db.lectures.update(id, {
    data,
    status: 'completed',
    processingProgress: undefined,
    errorMessage: undefined,
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
