import type { EditorState } from "@codemirror/state";

interface EditorSession {
  state: EditorState;
  scrollTop: number;
}

class EditorSessions {
  private sessions = new Map<string, EditorSession>();
  get(id: string) {
    return this.sessions.get(id);
  }
  set(id: string, session: EditorSession) {
    this.sessions.set(id, session);
  }
  prune(ids: string[]) {
    const live = new Set(ids);
    for (const id of this.sessions.keys()) if (!live.has(id)) this.sessions.delete(id);
  }
}

export const editorSessions = new EditorSessions();
