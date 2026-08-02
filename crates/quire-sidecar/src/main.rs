use std::io::{self, BufRead, Write};
use std::path::Path;

use quire_core::rpc::handlers;
use quire_core::CompileError;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

fn main() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("watch") {
        let Some(dir) = args.next() else {
            eprintln!("usage: quire-sidecar watch <dir>");
            std::process::exit(2);
        };
        return run_watch_mode(Path::new(&dir));
    }

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

        // the client can close its end of the pipe before this write lands; not worth a panic.
        if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
            break;
        }
    }
}

fn run_watch_mode(dir: &Path) {
    let watcher = match quire_core::project::FileWatcher::new(dir, std::time::Duration::from_millis(500)) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("failed to start watcher: {e}");
            std::process::exit(1);
        }
    };

    let mut stdout = io::stdout();
    loop {
        if let Some(batch) = watcher.recv_timeout(std::time::Duration::from_secs(3600)) {
            let paths: Vec<String> = batch.iter().map(|p| p.display().to_string()).collect();
            let notification = json!({ "event": "filesChanged", "paths": paths });
            if writeln!(stdout, "{notification}").is_err() || stdout.flush().is_err() {
                break; // the other end (main.js) is gone
            }
        }
    }
}

fn handle_request(req: Request) -> Value {
    match req.method.as_str() {
        "openProject" => dispatch(req.id, req.params, |p| handlers::open_project(&p)),
        "setRoot" => dispatch(req.id, req.params, |p| handlers::set_root(&p)),
        "closeProject" => dispatch(req.id, req.params, |p| handlers::close_project(&p)),
        "compile" => dispatch(req.id, req.params, |p| handlers::compile(&p)),
        "complete" => dispatch(req.id, req.params, |p| Ok(handlers::complete(&p))),
        "outline" => dispatch(req.id, req.params, |p| Ok(handlers::outline(&p))),
        "prefetchPackages" => dispatch(req.id, req.params, |p| Ok(handlers::prefetch_packages(&p))),
        "bundleStatus" => dispatch(req.id, Value::Null, |()| handlers::bundle_status()),
        "detectSystemTex" => dispatch(req.id, Value::Null, |()| Ok(handlers::detect_system_tex())),
        "listInstalledPackages" => dispatch(req.id, Value::Null, |()| Ok(handlers::list_installed_packages())),
        "installPackage" => dispatch(req.id, req.params, |p| handlers::install_package(&p)),
        "removePackage" => dispatch(req.id, req.params, |p| handlers::remove_package(&p)),
        "readFile" => dispatch(req.id, req.params, |p| handlers::read_file(&p)),
        "writeFile" => dispatch(req.id, req.params, |p| handlers::write_file(&p)),
        "searchProject" => dispatch(req.id, req.params, |p| handlers::search_project(&p)),
        "replaceInProject" => dispatch(req.id, req.params, |p| handlers::replace_in_project(&p)),
        other => json!({
            "jsonrpc": "2.0",
            "id": req.id,
            "error": { "code": -32601, "message": format!("unknown method: {other}") }
        }),
    }
}

fn invalid_params(id: &Value, e: impl std::fmt::Display) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": -32602, "message": format!("invalid params: {e}") }
    })
}

fn compile_error_response(id: &Value, e: CompileError) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": -32000, "message": e.message, "data": { "log": e.log } }
    })
}

fn dispatch<P, R, F>(id: Value, params: Value, f: F) -> Value
where
    P: DeserializeOwned,
    R: Serialize,
    F: FnOnce(P) -> Result<R, CompileError>,
{
    let parsed: P = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return invalid_params(&id, e),
    };

    match f(parsed) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(e) => compile_error_response(&id, e),
    }
}
