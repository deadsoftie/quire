use std::io::{self, BufRead, Write};

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardSyncParams {
    synctex_base64: String,
    tag: u32,
    line: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InverseSyncParams {
    synctex_base64: String,
    page: u32,
    x: f64,
    y: f64,
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

    let Ok(gz) = STANDARD.decode(&params.synctex_base64) else {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32602, "message": "invalid params: synctexBase64 is not valid base64" }
        });
    };

    let parsed = match SyncTex::parse_gz(&gz) {
        Ok(p) => p,
        Err(e) => {
            return json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32001, "message": format!("bad synctex data: {e:?}") }
            })
        }
    };

    let (rects, confidence) = parsed.forward_sync(params.tag, params.line);
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

    let Ok(gz) = STANDARD.decode(&params.synctex_base64) else {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32602, "message": "invalid params: synctexBase64 is not valid base64" }
        });
    };

    let parsed = match SyncTex::parse_gz(&gz) {
        Ok(p) => p,
        Err(e) => {
            return json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32001, "message": format!("bad synctex data: {e:?}") }
            })
        }
    };

    let result = parsed
        .inverse_sync(params.page, params.x, params.y)
        .map(|(tag, line, confidence)| {
            json!({ "tag": tag, "line": line, "confidence": confidence_str(confidence) })
        });

    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}
