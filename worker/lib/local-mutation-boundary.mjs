function reject(code, statusCode) {
  const error = new Error(`EdgeOps local mutation rejected (${code}).`);
  error.name = "EdgeOpsLocalMutationError";
  error.code = code;
  error.statusCode = statusCode;
  throw Object.seal(error);
}

export function assertExactLocalMutation(request, { authorized = false } = {}) {
  const remote = String(request?.socket?.remoteAddress || "").toLowerCase();
  if (!new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(remote)) {
    reject("EDGEOPS_LOOPBACK_REQUIRED", 403);
  }
  const authority = String(request?.headers?.host || "").toLowerCase();
  if (!new Set(["127.0.0.1:3210", "localhost:3210"]).has(authority)) {
    reject("EDGEOPS_HOST_REJECTED", 403);
  }
  const origin = request?.headers?.origin;
  if (origin !== undefined && !new Set(["http://127.0.0.1:3210", "http://localhost:3210"]).has(String(origin).toLowerCase())) {
    reject("EDGEOPS_ORIGIN_REJECTED", 403);
  }
  if (!String(request?.headers?.["content-type"] || "").toLowerCase().startsWith("application/json")) {
    reject("EDGEOPS_JSON_REQUIRED", 415);
  }
  if (authorized !== true) reject("EDGEOPS_CONTROL_UNAUTHORIZED", 401);
}
