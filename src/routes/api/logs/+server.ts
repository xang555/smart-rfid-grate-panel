import type { RequestHandler } from './$types';
import { recentLogs, subscribeLogs, clearLogs, type LogEntry } from '$lib/server/services/logbus';

// The client's Clear button wipes the buffer, not just its own view — a
// refresh opens a new SSE stream that replays recentLogs(), so a view-only
// clear would resurrect the lines.
export const DELETE: RequestHandler = async () => {
  clearLogs();
  return new Response(null, { status: 204 });
};

export const GET: RequestHandler = async () => {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: LogEntry) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      for (const e of recentLogs(200)) send(e);
      unsub = subscribeLogs(send);
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch { /* closed */ }
      }, 15_000);
    },
    cancel() {
      unsub?.();
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
};
