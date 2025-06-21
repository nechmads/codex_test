export interface TestRunResult {
  runId: string;
  timestamp: string;
  actualResponse: unknown;
  actualScript: string;
  pass: boolean;
  explanation: string;
  diffSummary?: string;
}

export interface TestCase {
  id: string;
  name: string;
  userRequest: string;
  expectedResult: string;
  customCriteria?: string;
  lastRun?: TestRunResult;
  history?: TestRunResult[];
}

export interface Env {
  OPENAI_API_KEY?: string;
  AI_SCRIPT_URL?: string;
}
