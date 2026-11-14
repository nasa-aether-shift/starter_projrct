import { problemSchema, type Problem } from "@/lib/schemas";

/** Error carrying the API's problem object so views can show its title/detail. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;

  constructor(status: number, problem: Problem) {
    super(problem.detail ? `${problem.title}: ${problem.detail}` : problem.title);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

/**
 * Reads a problem object from an error body. Accepts the contract shape ({type,title,detail})
 * and FastAPI's wrapping of HTTPException ({detail: {type,title,detail}}) or validation errors
 * ({detail: [...]}).
 */
export function toProblem(status: number, body: unknown): Problem {
  const top = problemSchema.safeParse(body);
  if (top.success) return top.data;
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    const nested = problemSchema.safeParse(detail);
    if (nested.success) return nested.data;
    if (Array.isArray(detail))
      return {
        title: "Invalid request",
        detail: "The server could not accept these settings. Check the place and period.",
      };
    if (typeof detail === "string") return { title: `Request failed (${status})`, detail };
  }
  return { title: `Request failed (${status})`, detail: "The server returned an unexpected error." };
}
