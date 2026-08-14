import { extensionOf } from "./panels/explorerTree";

// A dedicated MIME type, not "text/plain" - same reasoning as snippetLibrary.ts's own
// SNIPPET_DRAG_MIME, so a stray drag from elsewhere can't be misread as a file uri or vice versa.
export const FILE_DRAG_MIME = "application/x-quire-file-uri";

// Matches project::GRAPHIC_EXTENSIONS on the Rust side (crates/quire-core/src/project/mod.rs) --
// what \includegraphics can actually embed, not the broader "looks like an image" set the
// Explorer's own icon picker uses for display purposes only.
const INCLUDEGRAPHICS_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "eps"]);

/** Strips the project root prefix (and its trailing separator) from an absolute uri; returns `uri` unchanged if it isn't under `projectId`. */
export function toProjectRelativePath(uri: string, projectId: string): string {
  if (!uri.startsWith(projectId)) return uri;
  return uri.slice(projectId.length).replace(/^[/\\]/, "");
}

function stripExtension(relativePath: string, extension: string): string {
  return relativePath.slice(0, relativePath.length - extension.length - 1);
}

/**
 * What to insert when a file dragged from the Explorer is dropped into the editor, keyed off its
 * extension - the contextually-right LaTeX reference where one exists, otherwise the bare
 * relative path as plain text (better than nothing for a file type this has no special case for).
 */
export function insertionForDraggedFile(relativePath: string, documentText: string): string {
  const ext = extensionOf(relativePath);

  if (INCLUDEGRAPHICS_EXTENSIONS.has(ext)) {
    return `\\includegraphics[width=0.8\\linewidth]{${relativePath}}`;
  }

  if (ext === "bib") {
    // A document already citing a bibliography gets the bare path - inserting a second
    // \bibliography{} would either be ignored or conflict, and reliably detecting "the right
    // place to add another resource" isn't worth the machinery for this one case.
    const alreadyHasBibliography = /\\(bibliography|addbibresource)\{/.test(documentText);
    return alreadyHasBibliography ? relativePath : `\\bibliography{${stripExtension(relativePath, "bib")}}`;
  }

  if (ext === "tex") {
    return `\\input{${stripExtension(relativePath, "tex")}}`;
  }

  return relativePath;
}
