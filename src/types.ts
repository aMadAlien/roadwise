export interface Question {
  id: string;
  topic: string;
  question: string;
  image: null;
  answers: string[];
  correctAnswer: null;
  source: {
    file: string;
    page: number;
    number: number;
  };
}