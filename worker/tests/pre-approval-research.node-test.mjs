import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreApprovalResearchPrompt,
  parsePreApprovalResearch,
  shouldRunPreApprovalResearch
} from "../lib/pre-approval-research.mjs";
import { buildResearchQuery, parseDuckDuckGoResults } from "../lib/research-agent.mjs";

test("runs one local research pass while manual approval is pending", () => {
  assert.equal(shouldRunPreApprovalResearch(
    { status: "awaiting_escalation", preApprovalResearchAttempts: 0 },
    { id: "gpt-5.4", autoInvoke: false },
    { escalation: { preApprovalResearch: { enabled: true, maxPasses: 1 } } }
  ), true);
  assert.equal(shouldRunPreApprovalResearch(
    { status: "awaiting_escalation", preApprovalResearchChannel: "gpt-5.4", preApprovalResearchAttempts: 1 },
    { id: "gpt-5.4", autoInvoke: false },
    { escalation: { preApprovalResearch: { enabled: true, maxPasses: 1 } } }
  ), false);
  assert.equal(shouldRunPreApprovalResearch(
    { status: "awaiting_escalation", preApprovalResearchAttempts: 0 },
    { id: "groq", autoInvoke: true },
    { escalation: { preApprovalResearch: { enabled: true, maxPasses: 1 } } }
  ), false);
});

test("a manual route gets at most one context recovery pass", () => {
  assert.equal(shouldRunPreApprovalResearch(
    { status: "awaiting_escalation", preApprovalResearchChannel: "gpt-5.6", preApprovalResearchAttempts: 1 },
    { id: "gpt-5.6", autoInvoke: false },
    { escalation: { preApprovalResearch: { enabled: true, maxPasses: 1 } } }
  ), false);
});

test("parses and bounds a local context delta", () => {
  const result = parsePreApprovalResearch(`
    {"diagnosis":"read the live test first","contextDelta":"exact evidence","nextAction":"repair one file","retryWorthwhile":true,"evidence":["src/App.test.tsx:31"]}
  `);
  assert.deepEqual(result, {
    diagnosis: "read the live test first",
    contextDelta: "exact evidence",
    nextAction: "repair one file",
    retryWorthwhile: true,
    evidence: ["src/App.test.tsx:31"]
  });
});

test("research prompt identifies the approval boundary", () => {
  const prompt = buildPreApprovalResearchPrompt({
    task: { id: "T011", title: "Security tests" },
    taskState: { lastError: "typecheck failed" },
    tree: "src/App.test.tsx",
    focusFiles: "file contents",
    operatorContext: { activePlan: "repair tests", escalationAnswer: "use exact files" }
  });
  assert.match(prompt, /waiting for human approval/i);
  assert.match(prompt, /Do not edit files/i);
  assert.match(prompt, /T011/);
});

test("research remains eligible for a newer manual route after older guidance", () => {
  const config = { escalation: { preApprovalResearch: { enabled: true, maxPasses: 1 } } };
  assert.equal(shouldRunPreApprovalResearch({
    status: "awaiting_escalation",
    escalationAnswerChannel: "gpt-5.4"
  }, { id: "gpt-5.6", autoInvoke: false }, config), true);
  assert.equal(shouldRunPreApprovalResearch({
    status: "awaiting_escalation",
    escalationAnswerChannel: "gpt-5.6"
  }, { id: "gpt-5.6", autoInvoke: false }, config), false);
});

test("research query removes local paths and stays bounded", () => {
  const query = buildResearchQuery(
    { title: "Security tests", objective: "Repair C:\\Users\\Richard\\Projects\\ShoeGun.github.io\\src\\App.test.tsx" },
    { lastError: "typecheck failed at C:\\tmp\\worker.log" }
  );
  assert.doesNotMatch(query, /C:\\Users|C:\\tmp/i);
  assert.ok(query.length <= 220);
});

test("web research parser bounds and extracts result links", () => {
  const html = `
    <a class="result__a" href="https://example.com/one">One <b>result</b></a>
    <a class="result__a" href="https://example.com/two?x=1&amp;y=2">Two result</a>
    <a class="result__a" href="https://example.com/three">Three result</a>
  `;
  assert.deepEqual(parseDuckDuckGoResults(html, 2), [
    { title: "One result", url: "https://example.com/one" },
    { title: "Two result", url: "https://example.com/two?x=1&y=2" }
  ]);
});
