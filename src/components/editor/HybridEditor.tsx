import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/app-store";
import { blockWidgetPlugin } from "./extensions/block-widgets";
import {
  hybridBaseTheme,
  inlinePreviewPlugin,
  mouseSelectingField,
  pasteImagePlugin,
  setMouseSelecting,
} from "./extensions/hybrid-preview";

type ThemeKey = "light" | "dark" | "sepia";

const sepiaHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "#3c2f20", fontWeight: "bold" },
  { tag: tags.keyword, color: "#8b5e3c" },
  { tag: tags.string, color: "#5d7a4a" },
  { tag: tags.comment, color: "#a09080", fontStyle: "italic" },
  { tag: tags.meta, color: "#b85c38" },
  { tag: tags.link, color: "#6e5a3f", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.atom, color: "#9b6b3c" },
  { tag: tags.bool, color: "#a0522d" },
  { tag: tags.number, color: "#8b5e3c" },
  { tag: tags.name, color: "#3c2f20" },
  { tag: tags.operator, color: "#7a6040" },
  { tag: tags.regexp, color: "#5d7a4a" },
  { tag: tags.url, color: "#6e5a3f", textDecoration: "underline" },
]);

interface HybridEditorProps {
  initialContent?: string;
  onContentChange?: (content: string) => void;
  onOpenFile?: () => void;
  onSaveFile?: () => void;
  onQuickOpen?: () => void;
  onGlobalSearch?: () => void;
  focusMode?: boolean;
  typewriterMode?: boolean;
  onEditorView?: (view: EditorView) => void;
  mdPath?: string | null;
}

const themeCompartment = new Compartment();

function themeExtension(key: ThemeKey): Extension {
  switch (key) {
    case "dark":
      return [oneDark];
    case "sepia":
      return [syntaxHighlighting(sepiaHighlightStyle)];
    default:
      return [syntaxHighlighting(defaultHighlightStyle)];
  }
}

export function HybridEditor({
  initialContent = "",
  onContentChange,
  onOpenFile,
  onSaveFile,
  onQuickOpen,
  onGlobalSearch,
  focusMode = false,
  typewriterMode = false,
  onEditorView,
  mdPath,
}: HybridEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const theme = useAppStore((s) => s.theme);
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
      {
        key: "Mod-p",
        run: () => {
          onQuickOpen?.();
          return true;
        },
      },
      {
        key: "Mod-Shift-f",
        run: () => {
          onGlobalSearch?.();
          return true;
        },
      },
    ]);

    const extensions: Extension[] = [
      history(),
      closeBrackets(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...closeBracketsKeymap]),
      editorKeymap,

      markdown({ base: markdownLanguage, codeLanguages: languages }),

      hybridBaseTheme,
      inlinePreviewPlugin,
      blockWidgetPlugin,
      mouseSelectingField,

      pasteImagePlugin(mdPath ?? null),

      themeCompartment.of(themeExtension(theme)),

      updateContent,

      EditorView.domEventHandlers({
        mousedown() {
          viewRef.current?.dispatch({ effects: setMouseSelecting.of(true) });
        },
        mouseup() {
          viewRef.current?.dispatch({ effects: setMouseSelecting.of(false) });
        },
      }),
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
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartment.reconfigure(themeExtension(theme)),
    });
  }, [theme]);

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
