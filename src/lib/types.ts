export interface GlossaryTerm {
  term_en: string;
  translation_it: string;
  academic_definition: string;
}

export interface TranscriptSegment {
  start: number; // in seconds
  end: number;   // in seconds
  speaker: string;
  text_en: string;
  text_it: string;
}

export interface ExamQuestion {
  question: string;
  answer_latex: string;
  importance_level: 'High' | 'Medium' | 'Crucial';
}

export interface LectureData {
  glossary: GlossaryTerm[];
  timestamped_transcript: TranscriptSegment[];
  study_guide_it: string;
  potential_exam_questions: ExamQuestion[];
  mermaid_mindmap: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Lecture {
  id: string;
  title: string;
  course: string;
  date: string;
  duration: number; // in seconds
  fileSize: number; // in bytes
  fileName: string;
  audioBlob?: Blob;
  status: 'ready' | 'processing' | 'completed' | 'error';
  errorMessage?: string;
  processingProgress?: string;
  data?: LectureData;
  chatMessages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
