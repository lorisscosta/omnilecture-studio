export interface GlossaryTerm {
  term_en: string;
  translation_it: string;
  academic_definition: string;
}

export interface TranscriptSegment {
  start: number; // in seconds (continuous from 0)
  end: number;   // in seconds
  speaker: string;
  text_en: string;
  text_it: string;
  partIndex?: number; // 0-indexed audio part this segment belongs to
}

export interface AudioPart {
  id: string;
  fileName: string;
  fileSize: number;
  duration: number; // in seconds
  audioBlob?: Blob;
  startOffset: number; // cumulative start time in seconds in the continuous lecture
}

export interface ExamQuestion {
  question: string;
  answer_latex: string;
  importance_level: 'High' | 'Medium' | 'Crucial';
}

export interface SlideAlignment {
  slide_number: number;
  title: string;
  part: number;
  start_time_seconds: number;
  end_time_seconds: number;
  summary: string;
}

export interface LectureBookmark {
  id: string;
  partIndex: number;
  timestampSeconds: number;
  label: string;
  note?: string;
  createdAt: string;
}

export interface LectureData {
  glossary: GlossaryTerm[];
  timestamped_transcript: TranscriptSegment[];
  study_guide_it: string;
  potential_exam_questions: ExamQuestion[];
  slides_alignment?: SlideAlignment[];
  bookmarks?: LectureBookmark[];
  mermaid_mindmap?: string;
  slides_markdown?: string;
  slides_filename?: string;
  has_slides?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export type ChunkStatus = 'pending' | 'running' | 'done' | 'error';

export interface LectureProcessingChunk {
  id: string;
  lectureId: string;
  index: number;
  partIndex: number;
  startSeconds: number;
  endSeconds: number;
  duration: number;
  status: ChunkStatus;
  retryCount: number;
  errorMessage?: string;
  data?: Partial<LectureData>;
  updatedAt: string;
}

export interface Lecture {
  id: string;
  title: string;
  course: string;
  date: string;
  duration: number; // in seconds (total sum of all audio parts)
  fileSize: number; // in bytes (total sum)
  fileName: string;
  audioBlob?: Blob; // for backward compatibility, part 0 blob
  audioParts?: AudioPart[]; // ordered list of recordings in this lecture
  slidesBlob?: Blob; // Raw PDF blob for native PowerPoint presentation mode
  slidesFileName?: string;
  slidesMarkdown?: string;
  slidesAlignment?: SlideAlignment[];
  hasSlides?: boolean;
  status: 'ready' | 'processing' | 'completed' | 'error';
  errorMessage?: string;
  processingProgress?: string;
  processingPercentage?: number;
  processingChunks?: LectureProcessingChunk[];
  data?: LectureData;
  bookmarks?: LectureBookmark[];
  chatMessages: ChatMessage[];
  userId?: string;
  isCloudSynced?: boolean;
  cloudSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}
