import type { TestCase, TestRunResult, Env } from './types'

const testCases = new Map<string, TestCase>()

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const { pathname } = url

    if (pathname === '/api/test-cases' && request.method === 'GET') {
      return Response.json([...testCases.values()])
    }

    if (pathname === '/api/test-cases' && request.method === 'POST') {
      const data = (await request.json()) as Partial<TestCase>
      const id = crypto.randomUUID()
      const tc: TestCase = {
        id,
        name: data.name || 'untitled',
        userRequest: data.userRequest || '',
        expectedResult: data.expectedResult || '',
        customCriteria: data.customCriteria,
        history: [],
      }
      testCases.set(id, tc)
      return new Response(JSON.stringify(tc), { status: 201 })
    }

    if (pathname.startsWith('/api/test-cases/') ) {
      const id = pathname.split('/')[3]
      const existing = testCases.get(id)
      if (!existing) return new Response('Not found', { status: 404 })
      if (request.method === 'PUT') {
        const data = (await request.json()) as Partial<TestCase>
        const updated: TestCase = { ...existing, ...data, id }
        testCases.set(id, updated)
        return Response.json(updated)
      }
      if (request.method === 'DELETE') {
        testCases.delete(id)
        return new Response(null, { status: 204 })
      }
    }

    if (pathname.startsWith('/api/run-test/')) {
      const id = pathname.split('/')[3]
      const tc = testCases.get(id)
      if (!tc) return new Response('Not found', { status: 404 })
      const result = await runTestCase(tc, env)
      tc.lastRun = result
      tc.history?.push(result)
      return Response.json(result)
    }

    if (pathname === '/api/run-tests' && request.method === 'POST') {
      let ids: string[] | undefined
      try {
        const body = (await request.json()) as Record<string, unknown>
        if (Array.isArray(body.ids)) ids = body.ids as string[]
      } catch {
        ids = undefined
      }
      const cases = ids ? ids.map((i) => testCases.get(i)).filter(Boolean) as TestCase[] : [...testCases.values()]
      const results: Record<string, TestRunResult> = {}
      for (const tc of cases) {
        const res = await runTestCase(tc, env)
        tc.lastRun = res
        tc.history?.push(res)
        results[tc.id] = res
      }
      return Response.json(results)
    }

    if (pathname.startsWith('/api/test-results/')) {
      const id = pathname.split('/')[3]
      const tc = testCases.get(id)
      if (!tc) return new Response('Not found', { status: 404 })
      return Response.json(tc.history || [])
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>

async function runTestCase(tc: TestCase, env: Env): Promise<TestRunResult> {
  const runId = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const actual = await fetchAiAgent(tc.userRequest, env)
  const validation = await validateWithLLM(tc.expectedResult, actual.script, env)
  return {
    runId,
    timestamp,
    actualResponse: actual.json,
    actualScript: actual.script,
    pass: validation.pass,
    explanation: validation.explanation,
    diffSummary: validation.diffSummary,
  }
}

async function fetchAiAgent(requestText: string, env: Env): Promise<{ json: unknown; script: string }> {
  if (env.AI_SCRIPT_URL) {
    try {
      const res = await fetch(env.AI_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: requestText }),
      })
      const json = (await res.json()) as Record<string, unknown>
      const script = (json as Record<string, unknown>).script as string || ''
      return { json, script }
    } catch {
      // ignore errors in demo
    }
  }
  // Fallback demo
  return { json: { echo: requestText }, script: `// script for: ${requestText}` }
}

async function validateWithLLM(expected: string, actualScript: string, env: Env): Promise<{ pass: boolean; explanation: string; diffSummary?: string }> {
  if (env.OPENAI_API_KEY) {
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a testing assistant.' },
        {
          role: 'user',
          content: `User expected: "${expected}"\nAI produced: "${actualScript}"\nDoes the output satisfy the expectation? Answer YES or NO and explain.`,
        },
      ],
      temperature: 0,
    }
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as Record<string, unknown>
      const choices = (data.choices as Record<string, unknown>[] | undefined) ?? []
      const text = (choices[0]?.message as Record<string, unknown> | undefined)?.content as string || ''
      const [firstLine, ...rest] = text.trim().split('\n')
      const pass = /YES/i.test(firstLine)
      return { pass, explanation: rest.join('\n') || text }
    } catch {
      // network or API error
    }
  }
  // naive fallback
  const pass = actualScript.includes(expected)
  return { pass, explanation: pass ? 'simple match' : 'expected text not found' }
}

