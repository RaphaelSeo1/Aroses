export type MCQuestion = {
  question: string;
  choices: [string, string, string, string];
  correctIndex: number;
  explanation: string;
};

export type StudyPayload = {
  summary: string;
  keyConcepts: string[];
  questions: MCQuestion[];
};
