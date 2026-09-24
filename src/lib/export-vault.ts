import { Lecture } from './types';
import { generateObsidianMarkdown } from './obsidian-formatter';

export type ExportResult = {
  success: boolean;
  method: 'directory-picker' | 'web-share' | 'download';
  message: string;
};

export async function exportToObsidian(lecture: Lecture): Promise<ExportResult> {
  const markdown = generateObsidianMarkdown(lecture);
  const cleanTitle = lecture.title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Lezione';
  const cleanCourse = lecture.course.replace(/[\\/:*?"<>|]/g, '_').trim() || 'STEM';
  const fileName = `${cleanCourse} - ${cleanTitle}.md`;

  // 1. Check if window.showDirectoryPicker is available (Desktop Chrome/Edge/Opera)
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });

      const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(markdown);
      await writable.close();

      return {
        success: true,
        method: 'directory-picker',
        message: `File "${fileName}" salvato con successo nel tuo Obsidian Vault!`,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return {
          success: false,
          method: 'directory-picker',
          message: 'Selezione della cartella annullata.',
        };
      }
      console.warn('showDirectoryPicker failed, falling back to Web Share / Download:', err);
      // If permission or error occurs, fall through to fallback
    }
  }

  // 2. Mobile (Android / iOS): Web Share API
  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const mdFile = new File([blob], fileName, { type: 'text/markdown' });

      if (navigator.canShare && navigator.canShare({ files: [mdFile] })) {
        await navigator.share({
          files: [mdFile],
          title: lecture.title,
          text: `Appunti per ${lecture.course}: ${lecture.title}`,
        });

        return {
          success: true,
          method: 'web-share',
          message: 'Condivisione completata! Seleziona Obsidian dalla lista delle app.',
        };
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return {
          success: false,
          method: 'web-share',
          message: 'Condivisione annullata.',
        };
      }
      console.warn('navigator.share failed, falling back to classic download:', err);
    }
  }

  // 3. Ultimate Fallback: Classic <a> download tag
  try {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return {
      success: true,
      method: 'download',
      message: `File scaricato: "${fileName}". Puoi spostarlo direttamente nel tuo Vault Obsidian.`,
    };
  } catch (err: any) {
    return {
      success: false,
      method: 'download',
      message: `Errore durante il download del file: ${err.message || err}`,
    };
  }
}
