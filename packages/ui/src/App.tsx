import { Editor } from "./Editor";
import { PdfViewer } from "./PdfViewer";

const paneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  overflow: "auto",
};

export function App() {
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh" }}>
      <div style={paneStyle}>
        <Editor />
      </div>
      <div style={{ width: 1, background: "#888" }} />
      <div style={paneStyle}>
        <PdfViewer src="/sample.pdf" />
      </div>
    </div>
  );
}
