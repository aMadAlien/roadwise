import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const inputPath = path.resolve(process.argv[2] || "questions.pdf");
const outputPath = path.resolve(process.argv[3] || "questions.parsed.json");
const imageDirectory = path.resolve(process.argv[4] || "question-images");
const QUESTION_START = /(?:^|\s)(\d{1,3})\.\s+/g;
const OPTION_START = /(?:^|\s)(\d{1,2})\)\s+/g;

function clean(value) {
  return value.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}

function isTopic(text) {
  const value = clean(text).replace(/^\d+\.\s*/, "");
  return value.length > 3 && value.length < 120 && !/[?.!]$/.test(value) && /^[А-ЯІЇЄҐA-Z0-9][А-ЯІЇЄҐA-Z0-9\s/()\-]+$/.test(value);
}

function createQuestion(number, text, topic, pageNumber, image, answers) {
  return {
    id: `PDF-${String(number).padStart(4, "0")}`,
    topic,
    question: clean(text),
    image,
    answers,
    correctAnswer: null,
    source: { file: path.basename(inputPath), page: pageNumber, number }
  };
}

function parseQuestion(number, body, topic, pageNumber, image) {
  const optionMatches = [...body.matchAll(OPTION_START)];
  const firstOptionStart = optionMatches[0]?.index ?? body.length;
  const questionText = body.slice(0, firstOptionStart);
  const answers = optionMatches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = optionMatches[index + 1]?.index ?? body.length;
    return clean(body.slice(start, end));
  }).filter(Boolean);
  return createQuestion(number, questionText, topic, pageNumber, image, answers);
}

function parsePage(text, topic, pageNumber, image) {
  let pageText = clean(text).replace(/^\d+\s+/, "");
  const topicMatch = pageText.match(/(?:^|\s)\d+\.\s+([А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Z0-9\s/()\-]{3,}?)(?=\s+\d{1,3}\.\s+)/);
  if (topicMatch) {
    topic = clean(topicMatch[1]);
    pageText = pageText.replace(topicMatch[0], " ");
  }
  const questionMatches = [...pageText.matchAll(QUESTION_START)];
  const parsed = [];
  let nextTopic = topic;
  const leading = questionMatches.length ? pageText.slice(0, questionMatches[0].index).trim() : pageText;
  for (let index = 0; index < questionMatches.length; index += 1) {
    const match = questionMatches[index];
    const start = (match.index ?? 0) + match[0].length;
    const end = questionMatches[index + 1]?.index ?? pageText.length;
    const body = pageText.slice(start, end);
    if (isTopic(body)) {
      nextTopic = clean(body);
      continue;
    }
    parsed.push(parseQuestion(Number(match[1]), body, nextTopic, pageNumber, image));
  }
  return { questions: parsed, topic: nextTopic, leading };
}

async function renderPage(page, outputFile) {
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  await fs.writeFile(outputFile, canvas.toBuffer("image/png"));
}

async function main() {
  await fs.mkdir(imageDirectory, { recursive: true });
  const document = await pdfjsLib.getDocument({
    data: new Uint8Array(await fs.readFile(inputPath)),
    standardFontDataUrl: `${pdfjsRoot}/standard_fonts/`
  }).promise;
  const questions = [];
  let currentTopic = "Без теми";
  let currentQuestion = null;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ");
    const imageName = `question-${String(pageNumber).padStart(4, "0")}.png`;
    const imageFile = path.join(imageDirectory, imageName);
    await renderPage(page, imageFile);
    const image = path.relative(path.dirname(outputPath), imageFile).replaceAll("\\", "/");

    const parsedPage = parsePage(text, currentTopic, pageNumber, image);
    if (parsedPage.leading && questions.length && /\d+\)\s+/.test(parsedPage.leading)) {
      const continuationOptions = [...parsedPage.leading.matchAll(OPTION_START)].map((match, index, matches) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = matches[index + 1]?.index ?? parsedPage.leading.length;
        return clean(parsedPage.leading.slice(start, end));
      }).filter(Boolean);
      questions[questions.length - 1].answers.push(...continuationOptions);
    }
    questions.push(...parsedPage.questions);
    currentTopic = parsedPage.topic;
  }
  await fs.writeFile(outputPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
  console.log(`Pages: ${document.numPages}`);
  console.log(`Questions: ${questions.length}`);
  console.log(`Topics: ${new Set(questions.map((question) => question.topic)).size}`);
  console.log(`Questions with images: ${questions.filter((question) => question.image).length}`);
  console.log(`Answers intentionally empty: ${questions.every((question) => question.answers.length === 0)}`);
  console.log(`JSON: ${outputPath}`);
}

main().catch((error) => {
  console.error("PDF parsing failed:", error);
  process.exitCode = 1;
});
