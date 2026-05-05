export interface StreamEvent {
  event: string;
  data: string;
}

export async function* streamChat(sessionId: string, content: string, token: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const response = await fetch(`/api/chat/sessions/${sessionId}/auto-round/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`SSE stream failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        yield { event: currentEvent, data: line.slice(6) };
        currentEvent = "";
      }
    }
  }
}
