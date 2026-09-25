import { Lecture } from './types';

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function safeFormatDate(d?: string): string {
  if (!d) return new Date().toISOString().split('T')[0];
  try {
    const parsed = new Date(d);
    if (isNaN(parsed.getTime())) return d;
    return parsed.toISOString().split('T')[0];
  } catch {
    return d;
  }
}

export function generateObsidianMarkdown(lecture: Lecture): string {
  const { title, course, date, duration, data } = lecture;
  const formattedDate = safeFormatDate(date);
  const durationStr = formatTimestamp(duration);
  const courseSlug = course.toLowerCase().replace(/[^a-z0-9]/g, '-');

  let md = '';

  // 1. YAML Frontmatter
  md += `---\n`;
  md += `title: "${title.replace(/"/g, '\\"')}"\n`;
  md += `course: "${course.replace(/"/g, '\\"')}"\n`;
  md += `date: ${formattedDate}\n`;
  md += `duration: "${durationStr}"\n`;
  md += `source: "OmniLecture Studio"\n`;
  md += `tags:\n`;
  md += `  - university\n`;
  md += `  - stem\n`;
  md += `  - ${courseSlug}\n`;
  md += `  - lecture-notes\n`;
  md += `---\n\n`;

  // Header
  md += `# ${title}\n\n`;
  md += `**Corso:** ${course} | **Data:** ${formattedDate} | **Durata:** ${durationStr}\n\n`;
  md += `---\n\n`;

  if (!data) {
    md += `*Nessun dato analizzato disponibile per questa lezione.*\n`;
    return md;
  }

  // 2. Study Guide (Italian with Math & Proofs)
  md += `## 📖 Guida allo Studio (Appunti Accademici)\n\n`;
  md += `${data.study_guide_it.trim()}\n\n`;
  md += `---\n\n`;

  // 3. Potential Exam Questions
  if (data.potential_exam_questions && data.potential_exam_questions.length > 0) {
    md += `## 🎯 Domande Tipiche d'Esame\n\n`;
    data.potential_exam_questions.forEach((q, index) => {
      const importanceTag = q.importance_level === 'Crucial' ? 'danger' : q.importance_level === 'High' ? 'warning' : 'tip';
      md += `> [!${importanceTag}] Domanda d'Esame #${index + 1} (${q.importance_level})\n`;
      md += `> **${q.question}**\n>\n`;
      md += `> **Soluzione / Risposta con Dimostrazione:**\n`;
      const answerLines = q.answer_latex.split('\n');
      answerLines.forEach(line => {
        md += `> ${line}\n`;
      });
      md += `\n`;
    });
    md += `---\n\n`;
  }

  // 4. Mermaid Mindmap
  if (data.mermaid_mindmap && data.mermaid_mindmap.trim().length > 0) {
    md += `## 🧠 Mappa Concettuale della Lezione\n\n`;
    md += `\`\`\`mermaid\n`;
    md += `${data.mermaid_mindmap.trim()}\n`;
    md += `\`\`\`\n\n`;
    md += `---\n\n`;
  }

  // 5. Technical Glossary (EN -> IT)
  if (data.glossary && data.glossary.length > 0) {
    md += `## 📚 Glossario Tecnico (Inglese ➔ Italiano)\n\n`;
    md += `| Termine Inglese | Traduzione Italiana | Definizione Accademica |\n`;
    md += `| :--- | :--- | :--- |\n`;
    data.glossary.forEach(item => {
      const termEn = item.term_en.replace(/\|/g, '\\|');
      const termIt = item.translation_it.replace(/\|/g, '\\|');
      const def = item.academic_definition.replace(/\|/g, '\\|');
      md += `| **${termEn}** | ${termIt} | ${def} |\n`;
    });
    md += `\n---\n\n`;
  }

  // 6. Timestamped Bilingual Transcript
  if (data.timestamped_transcript && data.timestamped_transcript.length > 0) {
    md += `## 🎙️ Trascrizione Sincronizzata Bilingue\n\n`;
    data.timestamped_transcript.forEach(seg => {
      const startFormatted = formatTimestamp(seg.start);
      md += `> [!note] \`[${startFormatted}]\` **${seg.speaker || 'Docente'}**\n`;
      md += `> 🇬🇧 ${seg.text_en}\n>\n`;
      md += `> 🇮🇹 *${seg.text_it}*\n\n`;
    });
  }

  return md;
}
