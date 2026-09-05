import fs from "node:fs/promises";
import path from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import type { Question } from "./types";

const PDF_PATH = path.resolve("questions.pdf");
const OUTPUT_PATH = path.resolve("questions.json");

const MAX_PAGES = 700;

interface ParsedPage {
  pageNumber: number;
  lines: string[];
}

interface QuestionDraft {
  number: number;
  page: number;
  topic: string;
  questionLines: string[];
  answers: string[];
}

async function extractPages(pdfPath: string): Promise<ParsedPage[]> {
  const buffer = await fs.readFile(pdfPath);

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  }).promise;

  const pages: ParsedPage[] = [];

  const pagesToParse = Math.min(pdf.numPages, MAX_PAGES);

  for (let pageNumber = 1; pageNumber <= pagesToParse; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const items = textContent.items
      .filter((item): item is typeof item & { str: string } => {
        return "str" in item && typeof item.str === "string";
      })
      .map((item) => item.str);

    const lines = buildLines(items);

    pages.push({
      pageNumber,
      lines,
    });
  }

  return pages;
}

/**
 * PDF.js часто повертає текст не зовсім так,
 * як він виглядає на сторінці.
 *
 * Тут збираємо text items назад у логічні рядки.
 */
function buildLines(items: string[]): string[] {
  const lines: string[] = [];
  let current = "";

  for (const item of items) {
    const value = item.replace(/\s+/g, " ").trim();

    if (!value) {
      continue;
    }

    /*
     * Для цього PDF більшість text items уже приходять
     * окремими рядками, тому не будемо агресивно їх склеювати.
     */
    if (
      /^\d+\.\s*/.test(value) ||
      /^\d+\)/.test(value) ||
      isLikelyHeading(value)
    ) {
      if (current) {
        lines.push(current.trim());
      }

      current = value;
      continue;
    }

    if (!current) {
      current = value;
    } else {
      current += ` ${value}`;
    }
  }

  if (current) {
    lines.push(current.trim());
  }

  return lines;
}

function isLikelyHeading(line: string): boolean {
  const match = line.match(/^\d+\.\s*(.+)$/);

  if (!match) {
    return false;
  }

  const text = match[1].trim();

  if (text.includes("?")) {
    return false;
  }

  /*
   * Розділи в цьому PDF написані великими літерами.
   */
  const letters = text.match(/[А-ЯІЇЄҐA-Z]/g);

  if (!letters || letters.length < 5) {
    return false;
  }

  const upperLetters = text.match(/[А-ЯІЇЄҐA-Z]/g) ?? [];

  return upperLetters.length / letters.length > 0.9;
}

function isQuestionStart(line: string): boolean {
  const match = line.match(/^(\d+)\.\s*(.+)$/);

  if (!match) {
    return false;
  }

  return !isLikelyHeading(line);
}

function getQuestionNumber(line: string): number | null {
  const match = line.match(/^(\d+)\.\s*(.+)$/);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function isAnswerStart(line: string): boolean {
  return /^\d+\)\s*/.test(line);
}

function cleanAnswer(line: string): string {
  return line
    .replace(/^\d+\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanQuestion(lines: string[]): string {
  return lines
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTopic(line: string): string {
  return line
    .replace(/^\d+\.\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPageNumber(line: string, pageNumber: number): boolean {
  return line.trim() === String(pageNumber);
}

/**
 * Визначаємо, чи рядок є продовженням заголовка розділу.
 *
 * Наприклад:
 *
 * 2. ОБОВ'ЯЗКИ І ПРАВА ВОДІЇВ
 * МЕХАНІЧНИХ ТРАНСПОРТНИХ
 * ЗАСОБІВ
 */
function isHeadingContinuation(line: string): boolean {
  const cleaned = line.trim();

  if (!cleaned) {
    return false;
  }

  if (isQuestionStart(cleaned)) {
    return false;
  }

  if (isAnswerStart(cleaned)) {
    return false;
  }

  if (cleaned.includes("?")) {
    return false;
  }

  const letters = cleaned.match(/[А-ЯІЇЄҐA-Z]/g);

  if (!letters || letters.length < 3) {
    return false;
  }

  const lowercase = cleaned.match(/[а-яіїєґa-z]/g);

  return !lowercase || lowercase.length === 0;
}

function parsePages(pages: ParsedPage[]): Question[] {
  const questions: Question[] = [];

  let currentTopic = "";
  let currentQuestion: QuestionDraft | null = null;

  for (const page of pages) {
    let i = 0;

    while (i < page.lines.length) {
      const rawLine = page.lines[i];
      const line = rawLine.trim();

      if (!line) {
        i++;
        continue;
      }

      // Прибираємо номер сторінки
      if (isPageNumber(line, page.pageNumber)) {
        i++;
        continue;
      }

      // ----------------------------------------
      // НОВИЙ РОЗДІЛ
      // ----------------------------------------

      if (isLikelyHeading(line)) {
        const topicLines = [cleanTopic(line)];

        let j = i + 1;

        while (
          j < page.lines.length &&
          isHeadingContinuation(page.lines[j])
        ) {
          topicLines.push(page.lines[j].trim());
          j++;
        }

        currentTopic = topicLines.join(" ");

        i = j;
        continue;
      }

      // ----------------------------------------
      // НОВЕ ПИТАННЯ
      // ----------------------------------------

      if (isQuestionStart(line)) {
        if (currentQuestion) {
          questions.push(finalizeQuestion(currentQuestion));
        }

        const number = getQuestionNumber(line);

        if (number === null) {
          i++;
          continue;
        }

        const questionText = line.replace(/^\d+\.\s*/, "").trim();

        currentQuestion = {
          number,
          page: page.pageNumber,
          topic: currentTopic,
          questionLines: [questionText],
          answers: [],
        };

        i++;
        continue;
      }

      // Якщо питання ще не почалось — ігноруємо текст
      if (!currentQuestion) {
        i++;
        continue;
      }

      // ----------------------------------------
      // ВАРІАНТ ВІДПОВІДІ
      // ----------------------------------------

      if (isAnswerStart(line)) {
        currentQuestion.answers.push(cleanAnswer(line));
        i++;
        continue;
      }

      // ----------------------------------------
      // ПРОДОВЖЕННЯ ВІДПОВІДІ
      // ----------------------------------------

      if (currentQuestion.answers.length > 0) {
        const lastAnswerIndex = currentQuestion.answers.length - 1;

        currentQuestion.answers[lastAnswerIndex] = cleanText(
          `${currentQuestion.answers[lastAnswerIndex]} ${line}`,
        );

        i++;
        continue;
      }

      // ----------------------------------------
      // ПРОДОВЖЕННЯ ПИТАННЯ
      // ----------------------------------------

      currentQuestion.questionLines.push(line);

      i++;
    }
  }

  // Останнє питання
  if (currentQuestion) {
    questions.push(finalizeQuestion(currentQuestion));
  }

  return questions;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

function finalizeQuestion(draft: QuestionDraft): Question {
  return {
    id: `PDF-${String(getGlobalQuestionId(draft)).padStart(4, "0")}`,
    topic: draft.topic,
    question: cleanQuestion(draft.questionLines),
    image: null,
    answers: draft.answers.map(cleanText),
    correctAnswer: null,
    source: {
      file: path.basename(PDF_PATH),
      page: draft.page,
      number: draft.number,
    },
  };
}

/**
 * Тимчасово використовуємо глобальний номер.
 *
 * Пізніше краще передавати sequence counter безпосередньо
 * через parsePages(), щоб не залежати від цього методу.
 */
let globalQuestionCounter = 0;

function getGlobalQuestionId(_draft: QuestionDraft): number {
  globalQuestionCounter++;

  return globalQuestionCounter;
}

async function main() {
  console.log(`Parsing first ${MAX_PAGES} pages...`);

  const pages = await extractPages(PDF_PATH);

  console.log(`Pages extracted: ${pages.length}`);

  const questions = parsePages(pages);

  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(questions, null, 2),
    "utf-8",
  );

  console.log(`Questions parsed: ${questions.length}`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});