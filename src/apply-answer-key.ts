import fs from "node:fs/promises";
import path from "node:path";

const ANSWERS_DIR = path.resolve("answers.by-topic");
const QUESTIONS_DIR = path.resolve("questions.by-topic");
const ANSWER_PAIR_PATTERN = /^(\d+)\s*[-–—]\s*(\d+)$/;

interface Question {
  answers?: unknown[];
  source?: {
    number?: number;
  };
  correctAnswer?: number | null;
}

interface AnswerPair {
  number: number;
  correctAnswer: number;
}

async function getFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

async function findQuestionPath(answerFile: string): Promise<string | null> {
  const exactPath = path.join(QUESTIONS_DIR, answerFile);

  try {
    await fs.access(exactPath);
    return exactPath;
  } catch {
    const answerBaseName = path.parse(answerFile).name;
    const questionFiles = await getFiles(QUESTIONS_DIR);
    const matchingFile = questionFiles.find(
      (questionFile) => path.parse(questionFile).name === answerBaseName,
    );

    return matchingFile ? path.join(QUESTIONS_DIR, matchingFile) : null;
  }
}

function parseAnswerPairs(content: string, fileName: string): AnswerPair[] {
  const pairs: AnswerPair[] = [];

  for (const [lineIndex, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match = line.match(ANSWER_PAIR_PATTERN);

    if (!match) {
      throw new Error(
        `${fileName}:${lineIndex + 1}: очікувалася пара у форматі "число - число"`,
      );
    }

    pairs.push({
      number: Number(match[1]),
      correctAnswer: Number(match[2]),
    });
  }

  return pairs;
}

function applyAnswerPairs(
  questions: Question[],
  pairs: AnswerPair[],
  fileName: string,
): void {
  const questionsByNumber = new Map<number, Question>();

  for (const question of questions) {
    const number = question.source?.number;

    if (number !== undefined) {
      questionsByNumber.set(number, question);
    }
  }

  for (const pair of pairs) {
    const question = questionsByNumber.get(pair.number);

    if (!question) {
      throw new Error(
        `${fileName}: питання з номером ${pair.number} не знайдено у файлі питань`,
      );
    }

    if (
      pair.correctAnswer < 0 ||
      pair.correctAnswer >= (question.answers?.length ?? 0)
    ) {
      throw new Error(
        `${fileName}: для питання ${pair.number} індекс відповіді ${pair.correctAnswer} виходить за межі списку відповідей`,
      );
    }

    question.source = {
      ...question.source,
      number: pair.number,
    };
    question.correctAnswer = pair.correctAnswer;
  }
}

async function main(): Promise<void> {
  const answerFiles = await getFiles(ANSWERS_DIR);
  let updatedFiles = 0;
  let updatedQuestions = 0;

  for (const answerFile of answerFiles) {
    const questionPath = await findQuestionPath(answerFile);

    if (!questionPath) {
      console.warn(`Пропущено ${answerFile}: відповідний файл питань не знайдено`);
      continue;
    }

    const answerContent = await fs.readFile(
      path.join(ANSWERS_DIR, answerFile),
      "utf-8",
    );
    const pairs = parseAnswerPairs(answerContent, answerFile);
    const questions = JSON.parse(await fs.readFile(questionPath, "utf-8")) as Question[];

    applyAnswerPairs(questions, pairs, answerFile);

    await fs.writeFile(
      questionPath,
      `${JSON.stringify(questions, null, 2)}\n`,
      "utf-8",
    );

    updatedFiles++;
    updatedQuestions += pairs.length;
    console.log(`Оновлено ${answerFile}: ${pairs.length} питань`);
  }

  console.log(`Готово. Файлів: ${updatedFiles}, питань: ${updatedQuestions}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});