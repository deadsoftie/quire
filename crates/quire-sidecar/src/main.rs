use std::io::{self, BufRead, Write};
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine};
use quire_core::synctex::{Confidence, SyncTex};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
struct CompileRequestParams {
    source: String,
}

// `tag` (legacy) is used when there's no open project, matching Tectonic's
// always-tag-1-for-the-primary-buffer behavior (see the 0.6 investigation).
// `path`+`searchDir` is used once a real project is open, since a
// project's actual content almost always lives in \input/\subfile'd
// files with their own tags, not the root document -- confirmed during
// the 0.9 gate test against a real multi-file paper.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardSyncParams {
    synctex_base64: String,
    line: u32,
    tag: Option<u32>,
    path: Option<String>,
    search_dir: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InverseSyncParams {
    synctex_base64: String,
    page: u32,
    x: f64,
    y: f64,
    /// When given, the response includes the resolved file path (via
    /// quire_core::synctex::resolve_path) so the caller can tell whether
    /// the click landed in the currently-open file or a different one.
    search_dir: Option<String>,
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) if l.trim().is_empty() => continue,
            Ok(l) => l,
            Err(_) => break,
        };

        let response = match serde_json::from_str::<Request>(&line) {
            Ok(req) => handle_request(req),
            Err(e) => json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": { "code": -32700, "message": format!("parse error: {e}") }
            }),
        };

        writeln!(stdout, "{}", response).expect("write to stdout");
        stdout.flush().expect("flush stdout");
    }
}

fn handle_request(req: Request) -> Value {
    match req.method.as_str() {
        "compile" => handle_compile(req.id, req.params),
        "forwardSync" => handle_forward_sync(req.id, req.params),
        "inverseSync" => handle_inverse_sync(req.id, req.params),
        other => json!({
            "jsonrpc": "2.0",
            "id": req.id,
            "error": { "code": -32601, "message": format!("unknown method: {other}") }
        }),
    }
}

fn invalid_params(id: Value, e: impl std::fmt::Display) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": -32602, "message": format!("invalid params: {e}") }
    })
}

fn confidence_str(c: Confidence) -> &'static str {
    match c {
        Confidence::High => "high",
        Confidence::Low => "low",
    }
}

fn decode_synctex(id: &Value, synctex_base64: &str) -> Result<SyncTex, Value> {
    let gz = STANDARD.decode(synctex_base64).map_err(|_| {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32602, "message": "invalid params: synctexBase64 is not valid base64" }
        })
    })?;

    SyncTex::parse_gz(&gz).map_err(|e| {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32001, "message": format!("bad synctex data: {e:?}") }
        })
    })
}

fn handle_compile(id: Value, params: Value) -> Value {
    let params: CompileRequestParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return invalid_params(id, e),
    };

    match quire_core::compile_latex(&params.source) {
        Ok(output) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "pdfBase64": STANDARD.encode(output.pdf),
                "synctexBase64": output.synctex_gz.map(|s| STANDARD.encode(s)),
            }
        }),
        Err(e) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32000,
                "message": e.message,
                "data": { "log": e.log },
            }
        }),
    }
}

fn handle_forward_sync(id: Value, params: Value) -> Value {
    let params: ForwardSyncParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return invalid_params(id, e),
    };

    let parsed = match decode_synctex(&id, &params.synctex_base64) {
        Ok(p) => p,
        Err(err_response) => return err_response,
    };

    let tag = match (params.tag, params.path, params.search_dir) {
        (Some(tag), ..) => Some(tag),
        (None, Some(path), Some(search_dir)) => {
            parsed.tag_for_path(Path::new(&path), Path::new(&search_dir))
        }
        _ => None,
    };

    let Some(tag) = tag else {
        // No matching tag (e.g. the open file isn't part of this compile,
        // or no path/tag was resolvable) -- no highlight, not an error.
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "rects": [], "confidence": "high" }
        });
    };

    let (rects, confidence) = parsed.forward_sync(tag, params.line);
    let rects_json: Vec<Value> = rects
        .iter()
        .map(|r| json!({ "page": r.page, "x": r.x, "y": r.y, "w": r.w, "h": r.h }))
        .collect();

    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "rects": rects_json, "confidence": confidence_str(confidence) }
    })
}

fn handle_inverse_sync(id: Value, params: Value) -> Value {
    let params: InverseSyncParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return invalid_params(id, e),
    };

    let parsed = match decode_synctex(&id, &params.synctex_base64) {
        Ok(p) => p,
        Err(err_response) => return err_response,
    };

    let result = parsed
        .inverse_sync(params.page, params.x, params.y)
        .map(|(tag, line, confidence)| {
            let path = params
                .search_dir
                .as_ref()
                .and_then(|sd| parsed.resolve_path(tag, Path::new(sd)))
                .map(|p| p.display().to_string());
            json!({ "tag": tag, "path": path, "line": line, "confidence": confidence_str(confidence) })
        });

    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}
