import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import { blockWidgetPlugin } from "./extensions/block-widgets";
import {
  clickRevealPlugin,
  editorFocusedField,
  editorFocusPlugin,
  hybridBaseTheme,
  inlinePreviewPlugin,
  pasteImagePlugin,
  previewRevealRangeField,
} from "./extensions/hybrid-preview";

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, class: "md-heading-1" },
  { tag: tags.heading2, class: "md-heading-2" },
  { tag: tags.heading3, class: "md-heading-3" },
  { tag: tags.heading, class: "md-heading" },
  { tag: tags.strong, class: "md-strong" },
  { tag: tags.emphasis, class: "md-emphasis" },
  { tag: tags.link, class: "md-link" },
  { tag: tags.url, class: "md-url" },
  { tag: tags.monospace, class: "md-code" },
  { tag: tags.quote, class: "md-quote" },
  { tag: tags.list, class: "md-list" },
  { tag: tags.contentSeparator, class: "md-separator" },
  { tag: tags.processingInstruction, class: "md-mark" },
  { tag: tags.meta, class: "md-mark" },
  { tag: tags.labelName, class: "md-mark" },
]);

interface HybridEditorProps {
  initialContent?: string;
  onContentChange?: (content: string) => void;
  onOpenFile?: () => void;
  onNewDocument?: () => void;
  onSaveFile?: () => void;
  focusMode?: boolean;
  typewriterMode?: boolean;
  onEditorView?: (view: EditorView) => void;
  mdPath?: string | null;
}

export function HybridEditor({
  initialContent = "",
  onContentChange,
  onOpenFile,
  onNewDocument,
  onSaveFile,
  focusMode = false,
  typewriterMode = false,
  onEditorView,
  mdPath,
}: HybridEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const updateContent = EditorView.updateListener.of((update) => {
      if (update.docChanged && onContentChange) {
        onContentChange(update.state.doc.toString());
      }
    });

    const editorKeymap = keymap.of([
      {
        key: "Mod-n",
        run: () => {
          onNewDocument?.();
          return true;
        },
      },
      {
        key: "Mod-o",
        run: () => {
          onOpenFile?.();
          return true;
        },
      },
      {
        key: "Mod-s",
        run: () => {
          onSaveFile?.();
          return true;
        },
        preventDefault: true,
      },
    ]);

    const extensions: Extension[] = [
      markdown({ base: markdownLanguage }),
      history(),
      closeBrackets(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...closeBracketsKeymap]),
      editorKeymap,

      hybridBaseTheme,
      editorFocusPlugin,
      editorFocusedField,
      previewRevealRangeField,
      inlinePreviewPlugin,
      clickRevealPlugin,
      blockWidgetPlugin(mdPath ?? null),

      pasteImagePlugin(mdPath ?? null),

      syntaxHighlighting(markdownHighlightStyle),

      updateContent,
    ];

    const state = EditorState.create({ doc: initialContent, extensions });
    const view = new EditorView({ state, parent: containerRef.current });

    viewRef.current = view;
    setIsReady(true);
    onEditorView?.(view);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dom = viewRef.current?.dom;
    if (!dom) return;
    dom.classList.toggle("cm-focus-mode", focusMode);
  }, [focusMode]);

  useEffect(() => {
    const dom = viewRef.current?.dom;
    if (!dom) return;
    dom.classList.toggle("cm-typewriter-mode", typewriterMode);
  }, [typewriterMode]);

  useEffect(() => {
    if (!viewRef.current || !isReady) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (initialContent !== currentContent) {
      viewRef.current.dispatch({
        changes: { from: 0, to: currentContent.length, insert: initialContent },
      });
    }
  }, [initialContent, isReady]);

  return <div ref={containerRef} className="h-full w-full" style={{ background: "var(--bg)" }} />;
}
