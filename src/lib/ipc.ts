export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export interface Heading {
  text: string;
  level: number;
  line: number;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function readMarkdownFile(path: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("File I/O requires Tauri runtime");
  return invoke<string>("read_markdown_file", { path });
}

export async function takePendingOpenFiles(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("take_pending_open_files");
}

export async function writeMarkdownFile(path: string, content: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error("File I/O requires Tauri runtime");
  return invoke<void>("write_markdown_file", { path, content });
}

export async function getFileMtime(path: string): Promise<number> {
  if (!isTauriRuntime()) throw new Error("File metadata requires Tauri runtime");
  return Number(await invoke<number | string>("get_file_mtime", { path }));
}

export async function getHeadingOutline(content: string): Promise<Heading[]> {
  if (!isTauriRuntime()) return fallbackParseHeadings(content);
  return invoke<Heading[]>("get_heading_outline", { content });
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  if (!isTauriRuntime()) return [];
  return invoke<FileEntry[]>("list_directory", { path });
}

export async function listMarkdownFiles(path: string): Promise<FileEntry[]> {
  if (!isTauriRuntime()) return [];
  return invoke<FileEntry[]>("list_markdown_files", { path });
}

export async function exportDocument(
  content: string,
  inputPath: string,
  format: string,
): Promise<string> {
  if (!isTauriRuntime()) throw new Error("Export requires Tauri runtime");
  return invoke<string>("export_document", { content, inputPath, format });
}

function fallbackParseHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ text: match[2].trim(), level: match[1].length, line: i });
    }
  }
  return headings;
}

export interface SearchResult {
  path: string;
  snippet: string;
}

export async function searchFulltext(folderPath: string, query: string): Promise<SearchResult[]> {
  if (!isTauriRuntime()) return [];
  return invoke<SearchResult[]>("search_fulltext", { folderPath, queryStr: query });
}

export async function pasteImage(imageData: number[], mdPath: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("Paste requires Tauri runtime");
  return invoke<string>("paste_image", { imageData, mdPath });
}

export async function revealInFinder(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("reveal_in_finder", { path });
}
