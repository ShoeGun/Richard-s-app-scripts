import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { streamJsonResponse } from "../lib/ollama-stream.mjs";

test("streams newline-delimited Ollama messages without a fetch body timeout", async (t) => {
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.write(`${JSON.stringify({ response: "hello", done: false })}\n`);
    response.end(`${JSON.stringify({ response: " world", done: true, eval_count: 2 })}\n`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const messages = [];
  const address = server.address();
  await streamJsonResponse(
    `http://127.0.0.1:${address.port}/api/generate`,
    { model: "test", stream: true },
    { onMessage: (message) => messages.push(message) }
  );

  assert.equal(messages.map((message) => message.response).join(""), "hello world");
  assert.equal(messages.at(-1).done, true);
});

test("surfaces the Ollama status and response body", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end('{"error":"model unavailable"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address();
  await assert.rejects(
    streamJsonResponse(`http://127.0.0.1:${address.port}/api/generate`, {}),
    /503.*model unavailable/
  );
});
