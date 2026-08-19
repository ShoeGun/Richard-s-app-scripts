import http from "node:http";
import https from "node:https";

function requestModule(url) {
  return url.protocol === "https:" ? https : http;
}

export function streamJsonResponse(endpoint, payload, { signal, onMessage } = {}) {
  const url = new URL(endpoint);
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = requestModule(url).request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      },
      signal
    });

    request.once("error", (error) => {
      reject(new Error(`Ollama transport failed: ${error.message}`, { cause: error }));
    });
    request.once("response", (response) => {
      let buffer = "";
      let errorBody = "";
      let failed = false;

      const emitMessage = (line) => {
        if (!line.trim() || failed) return;
        try {
          onMessage?.(JSON.parse(line));
        } catch (error) {
          failed = true;
          response.destroy();
          reject(error);
        }
      };

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if ((response.statusCode || 500) >= 400) {
          errorBody = `${errorBody}${chunk}`.slice(-8000);
          return;
        }
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) emitMessage(line);
      });
      response.once("end", () => {
        if (failed) return;
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`Ollama returned ${response.statusCode}: ${errorBody}`));
          return;
        }
        emitMessage(buffer);
        if (failed) return;
        resolve();
      });
      response.once("error", (error) => {
        if (failed) return;
        reject(new Error(`Ollama response stream failed: ${error.message}`, { cause: error }));
      });
    });

    request.end(body);
  });
}
